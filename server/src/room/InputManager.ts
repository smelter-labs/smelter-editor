import path from 'node:path';
import { pathExists, readdir } from 'fs-extra';
import {
  SmelterInstance,
  type RegisterSmelterInputOptions,
} from '../smelter';
import { hlsUrlForKickChannel, hlsUrlForTwitchChannel } from '../streamlink';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';
import { sleep } from '../utils';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import {
  getMp4DurationMs,
  getMp4VideoDimensions,
} from '../server/mp4Duration';
import { logTimelineEvent } from '../dashboard';
import { createDefaultSnakeGameInputState } from '../snakeGame/snakeGameState';
import { createHandsStore } from '../hands/handStore';
import type { ShaderConfig, ActiveTransition } from '../types';
import type {
  RoomInputState,
  RegisterInputOptions,
  UpdateInputOptions,
} from './types';
import type { PlaceholderManager } from './PlaceholderManager';
import {
  cloneDefaultLogoShaders,
  PLACEHOLDER_LOGO_FILE,
} from './PlaceholderManager';
import type { MotionController } from './MotionController';

const VIDEO_INPUT_TYPES: RoomInputState['type'][] = [
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
];

export class InputManager {
  private inputs: RoomInputState[] = [];
  private transitionTimers = new Map<string, NodeJS.Timeout>();
  private readonly mp4Files: string[];

  constructor(
    private readonly idPrefix: string,
    private readonly placeholderManager: PlaceholderManager,
    private readonly motionController: MotionController,
    private readonly onStateChange: () => void,
  ) {
    this.mp4Files = mp4SuggestionsMonitor.mp4Files;
  }

  getInput(inputId: string): RoomInputState {
    const input = this.inputs.find((i) => i.inputId === inputId);
    if (!input) throw new Error(`Input ${inputId} not found`);
    return input;
  }

  getInputs(): RoomInputState[] {
    return this.inputs;
  }

  // ── Initialization ────────────────────────────────────────

  async initializeInputs(
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean,
  ): Promise<void> {
    if (initInputs.length > 0) {
      for (const input of initInputs) {
        await this.addNewInput(input);
      }
    } else if (!skipDefaultInputs) {
      const preferredMp4 =
        this.mp4Files.find((f) => f.toLowerCase().startsWith('eclipse')) ??
        this.mp4Files.find((file) => !isBlockedDefaultMp4(file));
      if (preferredMp4) {
        await this.addNewInput({
          type: 'local-mp4',
          source: { fileName: preferredMp4 },
        });
      }

      const logoPath = path.join(
        process.cwd(),
        'pictures',
        PLACEHOLDER_LOGO_FILE,
      );
      if (await pathExists(logoPath)) {
        const logoInputId = await this.addNewInput({
          type: 'image',
          fileName: PLACEHOLDER_LOGO_FILE,
        });
        const logoInput = this.inputs.find(
          (inp) => inp.inputId === logoInputId,
        );
        if (logoInput) {
          logoInput.shaders = cloneDefaultLogoShaders();
          this.onStateChange();
        }
      }
    }

    const added = await this.placeholderManager.ensurePlaceholder(this.inputs);
    if (added) this.onStateChange();
  }

  // ── Add ───────────────────────────────────────────────────

  async addNewInput(opts: RegisterInputOptions): Promise<string | undefined> {
    if (this.placeholderManager.removePlaceholder(this.inputs)) {
      this.onStateChange();
    }

    if (opts.type === 'whip') {
      return this.addNewWhipInput(opts.username);
    } else if (opts.type === 'twitch-channel' || opts.type === 'kick-channel') {
      return this.addHlsChannelInput(opts.type, opts.channelId);
    } else if (opts.type === 'hls') {
      return this.addDirectHlsInput(opts.url);
    } else if (opts.type === 'local-mp4') {
      return this.addMp4Input(opts);
    } else if (opts.type === 'image') {
      return this.addImageInput(opts);
    } else if (opts.type === 'text-input') {
      return this.addTextInput(opts);
    } else if (opts.type === 'game') {
      return this.addGameInput(opts);
    } else if (opts.type === 'hands') {
      return this.addHandsInput(opts);
    }
  }

  private async addNewWhipInput(username: string): Promise<string> {
    const inputId = `${this.idPrefix}::whip::${Date.now()}`;
    const cleanUsername = username.replace(/\[Camera\]\s*/g, '').trim();
    const monitor = await WhipInputMonitor.startMonitor(cleanUsername);
    monitor.touch();
    this.inputs.push({
      inputId,
      type: 'whip',
      status: 'disconnected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      monitor,
      metadata: {
        title: `[Camera] ${cleanUsername}`,
        description: `Whip Input for ${username}`,
      },
      volume: 0,
      whipUrl: '',
    });
    return inputId;
  }

  private async addHlsChannelInput(
    platform: 'twitch-channel' | 'kick-channel',
    channelId: string,
  ): Promise<string> {
    const inputId =
      platform === 'twitch-channel'
        ? inputIdForTwitchInput(this.idPrefix, channelId)
        : inputIdForKickInput(this.idPrefix, channelId);
    const platformLabel = platform === 'twitch-channel' ? 'Twitch' : 'Kick';
    if (this.inputs.find((input) => input.inputId === inputId)) {
      throw new Error(
        `Input for ${platformLabel} channel ${channelId} already exists.`,
      );
    }

    const hlsUrl =
      platform === 'twitch-channel'
        ? await hlsUrlForTwitchChannel(channelId)
        : await hlsUrlForKickChannel(channelId);

    const baseState = {
      inputId,
      status: 'disconnected' as const,
      showTitle: false,
      shaders: [] as ShaderConfig[],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: { title: '', description: '' },
      volume: 0,
      channelId,
      hlsUrl,
    };

    let inputState: RoomInputState;
    let monitor: TwitchChannelMonitor | KickChannelMonitor;
    if (platform === 'twitch-channel') {
      const twitchMonitor = await TwitchChannelMonitor.startMonitor(channelId);
      monitor = twitchMonitor;
      inputState = {
        ...baseState,
        type: 'twitch-channel',
        monitor: twitchMonitor,
      };
    } else {
      const kickMonitor = await KickChannelMonitor.startMonitor(channelId);
      monitor = kickMonitor;
      inputState = {
        ...baseState,
        type: 'kick-channel',
        monitor: kickMonitor,
      };
    }
    monitor.onUpdate((streamInfo: TwitchStreamInfo, _isLive: boolean) => {
      inputState.metadata.title =
        platform === 'twitch-channel'
          ? `[Twitch.tv/${streamInfo.category}] ${streamInfo.displayName}`
          : `[Kick.com] ${streamInfo.displayName}`;
      inputState.metadata.description = streamInfo.title;
      this.onStateChange();
    });
    this.inputs.push(inputState);
    return inputId;
  }

  private async addDirectHlsInput(url: string): Promise<string> {
    const inputId = `${this.idPrefix}::hls::${Date.now()}`;
    let label = url;
    try {
      const parsed = new URL(url);
      label = parsed.hostname + parsed.pathname.split('/').pop();
    } catch {
      // keep raw url as label
    }
    this.inputs.push({
      inputId,
      type: 'hls',
      status: 'disconnected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: {
        title: `[HLS] ${label}`,
        description: `Direct HLS stream`,
      },
      volume: 0,
      hlsUrl: url,
    });
    return inputId;
  }

  private async addMp4Input(
    opts: Extract<RegisterInputOptions, { type: 'local-mp4' }>,
  ): Promise<string> {
    const isAudio = !!opts.source?.audioFileName;
    const resolvedFileName = opts.source?.audioFileName ?? opts.source?.fileName;

    if (!resolvedFileName) {
      throw new Error(
        'local-mp4 requires source.fileName or source.audioFileName.',
      );
    }

    const baseDir = isAudio ? 'audios' : 'mp4s';
    const mp4Path = path.join(process.cwd(), baseDir, resolvedFileName);
    const mp4Name = resolvedFileName;
    const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;

    if (!(await pathExists(mp4Path))) {
      throw new Error(`File not found in ${baseDir}/: ${resolvedFileName}`);
    }

    const dims = await getMp4VideoDimensions(mp4Path);
    const titlePrefix = isAudio ? 'AUDIO' : 'MP4';

    this.inputs.push({
      inputId,
      type: 'local-mp4',
      status: 'disconnected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: {
        title: `[${titlePrefix}] ${formatMp4Name(mp4Name)}`,
        description: isAudio
          ? '[Audio source] Converted from audio file'
          : '[Static source] AI Generated',
      },
      mp4FilePath: mp4Path,
      mp4VideoWidth: dims?.width,
      mp4VideoHeight: dims?.height,
      volume: 0,
    });
    return inputId;
  }

  private async addImageInput(
    opts: Extract<RegisterInputOptions, { type: 'image' }>,
  ): Promise<string> {
    console.log('Adding image');
    const picturesDir = path.join(process.cwd(), 'pictures');
    const inputId = `${this.idPrefix}::image::${Date.now()}`;
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];

    let fileName = opts.fileName;
    let imageId = opts.imageId;

    if (imageId && !fileName) {
      const baseName = imageId.replace(/^pictures::/, '');
      const files = await readdir(picturesDir).catch(() => [] as string[]);
      const found = files.find((f) => {
        const fBase = f.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
        return fBase === baseName;
      });
      if (found) {
        fileName = found;
      } else {
        throw new Error(`Image file not found for imageId: ${imageId}`);
      }
    }

    if (!fileName) {
      throw new Error(
        'Either fileName or imageId must be provided for image input',
      );
    }

    const imagePath = path.join(picturesDir, fileName);

    if (await pathExists(imagePath)) {
      const lower = fileName.toLowerCase();
      const ext = exts.find((x) => lower.endsWith(x));
      if (!ext) throw new Error(`Unsupported image format: ${fileName}`);

      const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
      imageId = `pictures::${baseName}`;
      const assetType =
        ext === '.png'
          ? 'png'
          : ext === '.gif'
            ? 'gif'
            : ext === '.svg'
              ? 'svg'
              : 'jpeg';

      try {
        await SmelterInstance.registerImage(imageId, {
          serverPath: imagePath,
          assetType: assetType as any,
        });
      } catch {
        // ignore if already registered
      }

      this.inputs.push({
        inputId,
        type: 'image',
        status: 'connected',
        showTitle: false,
        shaders: [],
  
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        motionEnabled: false,
        metadata: { title: formatImageName(fileName), description: '' },
        volume: 0,
        imageId,
      });
      this.onStateChange();
    } else {
      throw new Error(`Image file not found: ${fileName}`);
    }

    return inputId;
  }

  private addTextInput(
    opts: Extract<RegisterInputOptions, { type: 'text-input' }>,
  ): string {
    console.log('Adding text input');
    const inputId = `${this.idPrefix}::text::${Date.now()}`;

    this.inputs.push({
      inputId,
      type: 'text-input',
      status: 'connected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: { title: 'Text', description: '' },
      volume: 0,
      text: opts.text,
      textAlign: opts.textAlign ?? 'left',
      textColor: opts.textColor ?? '#ffffff',
      textMaxLines: opts.textMaxLines ?? 10,
      textScrollSpeed: opts.textScrollSpeed ?? 80,
      textScrollLoop: opts.textScrollLoop ?? true,
      textScrollNudge: 0,
      textFontSize: opts.textFontSize ?? 80,
    });
    this.onStateChange();
    return inputId;
  }

  private addGameInput(
    opts: Extract<RegisterInputOptions, { type: 'game' }>,
  ): string {
    console.log('Adding game input');
    const inputId = `${this.idPrefix}::game::${Date.now()}`;
    const defaults = createDefaultSnakeGameInputState(opts.title);

    this.inputs.push({
      inputId,
      type: 'game',
      status: 'connected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      volume: 0,
      ...defaults,
    });
    this.onStateChange();
    return inputId;
  }

  private async addHandsInput(
    opts: Extract<RegisterInputOptions, { type: 'hands' }>,
  ): Promise<string> {
    console.log('Adding hands input');
    const inputId = `${this.idPrefix}::hands::${Date.now()}`;
    const handsStore = createHandsStore();

    this.inputs.push({
      inputId,
      type: 'hands',
      status: 'connected',
      showTitle: false,
      shaders: [],

      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: { title: 'Hand Tracking', description: 'Cyberpunk hand overlay' },
      volume: 0,
      sourceInputId: opts.sourceInputId,
      handsStore,
    });

    this.motionController
      .startHandTracking(opts.sourceInputId, handsStore)
      .catch((err) =>
        console.error(
          `[hands] Failed to start hand tracking for ${opts.sourceInputId}`,
          err,
        ),
      );

    this.onStateChange();
    return inputId;
  }

  // ── Remove ────────────────────────────────────────────────

  async removeInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);

    const nonPlaceholderInputs = this.inputs.filter(
      (inp) => !this.placeholderManager.isPlaceholder(inp.inputId),
    );
    const willBeEmpty =
      nonPlaceholderInputs.length === 1 &&
      nonPlaceholderInputs[0].inputId === inputId;

    if (willBeEmpty) {
      const added = await this.placeholderManager.ensurePlaceholder(
        this.inputs,
      );
      if (added) this.onStateChange();
    }

    this.inputs = this.inputs.filter((i) => i.inputId !== inputId);
    for (const other of this.inputs) {
      if (other.attachedInputIds) {
        other.attachedInputIds = other.attachedInputIds.filter(
          (id) => id !== inputId,
        );
      }
    }
    this.onStateChange();

    if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
      input.monitor.stop();
    }

    if (input.type === 'hands') {
      this.motionController.stopHandTracking(input.sourceInputId);
    }

    const PENDING_WAIT_TIMEOUT_MS = 30_000;
    const waitStart = Date.now();
    while (input.status === 'pending') {
      if (Date.now() - waitStart > PENDING_WAIT_TIMEOUT_MS) {
        console.warn(
          `[roomState] Timed out waiting for pending input ${inputId}, forcing disconnected`,
        );
        input.status = 'disconnected';
        break;
      }
      await sleep(500);
    }

    if (input.status === 'connected') {
      await this.motionController.stopMotionDetection(inputId);
      try {
        await SmelterInstance.unregisterInput(inputId);
      } catch (err: any) {
        console.log(err, 'Failed to unregister when removing input.');
      }
      input.status = 'disconnected';
    }
  }

  // ── Connect / Disconnect ──────────────────────────────────

  async connectInput(inputId: string): Promise<string> {
    const input = this.getInput(inputId);
    if (input.status !== 'disconnected') return '';

    if (input.type === 'image' || input.type === 'game' || input.type === 'hands') {
      input.status = 'connected';
      this.onStateChange();
      return '';
    }

    input.status = 'pending';
    const options = registerOptionsFromInput(input);
    let response = '';
    try {
      const CONNECT_TIMEOUT_MS = 30_000;
      const res = await Promise.race([
        SmelterInstance.registerInput(inputId, options),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout connecting input ${inputId}`)),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);
      response = res;
    } catch (err: any) {
      response = err.body?.url;
      input.status = 'disconnected';
      this.onStateChange();
      throw err;
    }

    input.status = 'connected';
    if (input.type === 'local-mp4') {
      input.registeredAtPipelineMs = SmelterInstance.getPipelineTimeMs();
      input.playFromMs = 0;
      getMp4DurationMs(input.mp4FilePath)
        .then((ms) => {
          input.mp4DurationMs = ms;
        })
        .catch((err) =>
          console.warn(`[mp4] Failed to probe duration for ${inputId}`, err),
        );
    }

    if (input.motionEnabled && VIDEO_INPUT_TYPES.includes(input.type)) {
      this.motionController
        .startMotionDetection(inputId, (score) => {
          if (score === -1) {
            input.motionScore = undefined;
          } else {
            input.motionScore = score;
          }
          this.motionController.emitMotionScores();
        })
        .catch((err) =>
          console.error(`[motion] Failed to start for ${inputId}`, err),
        );
    }

    this.onStateChange();
    return response;
  }

  async disconnectInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);
    if (input.status === 'disconnected') return;

    await this.motionController.stopMotionDetection(inputId);
    input.status = 'pending';
    this.onStateChange();
    try {
      await SmelterInstance.unregisterInput(inputId);
    } finally {
      input.status = 'disconnected';
      this.onStateChange();
    }
  }

  // ── Update ────────────────────────────────────────────────

  updateInput(inputId: string, options: Partial<UpdateInputOptions>): void {
    const input = this.getInput(inputId);
    if (options.title !== undefined) input.metadata.title = options.title;
    input.volume = options.volume ?? input.volume;
    input.shaders = options.shaders ?? input.shaders;
    input.showTitle = options.showTitle ?? input.showTitle;
    input.borderColor = options.borderColor ?? input.borderColor;
    input.borderWidth = options.borderWidth ?? input.borderWidth;

    if (input.type === 'text-input') {
      if (options.text !== undefined) input.text = options.text;
      if (options.textAlign !== undefined) input.textAlign = options.textAlign;
      if (options.textColor !== undefined) input.textColor = options.textColor;
      if (options.textMaxLines !== undefined)
        input.textMaxLines = options.textMaxLines;
      if (options.textScrollSpeed !== undefined)
        input.textScrollSpeed = options.textScrollSpeed;
      if (options.textScrollLoop !== undefined)
        input.textScrollLoop = options.textScrollLoop;
      if (options.textScrollNudge !== undefined)
        input.textScrollNudge = options.textScrollNudge;
      if (options.textFontSize !== undefined)
        input.textFontSize = options.textFontSize;
    }

    if (input.type === 'game') {
      if (options.gameBackgroundColor !== undefined)
        input.snakeGameState.backgroundColor = options.gameBackgroundColor;
      if (options.gameCellGap !== undefined)
        input.snakeGameState.cellGap = options.gameCellGap;
      if (options.gameBoardBorderColor !== undefined)
        input.snakeGameState.boardBorderColor = options.gameBoardBorderColor;
      if (options.gameBoardBorderWidth !== undefined)
        input.snakeGameState.boardBorderWidth = options.gameBoardBorderWidth;
      if (options.gameGridLineColor !== undefined)
        input.snakeGameState.gridLineColor = options.gameGridLineColor;
      if (options.gameGridLineAlpha !== undefined)
        input.snakeGameState.gridLineAlpha = options.gameGridLineAlpha;
      if (options.snakeEventShaders !== undefined)
        input.snakeEventShaders = options.snakeEventShaders;
      if (options.snake1Shaders !== undefined)
        input.snake1Shaders = options.snake1Shaders;
      if (options.snake2Shaders !== undefined)
        input.snake2Shaders = options.snake2Shaders;
    }

    if (options.attachedInputIds !== undefined)
      input.attachedInputIds = options.attachedInputIds;
    if (options.absolutePosition !== undefined)
      input.absolutePosition = options.absolutePosition;
    if (options.absoluteTop !== undefined)
      input.absoluteTop = options.absoluteTop;
    if (options.absoluteLeft !== undefined)
      input.absoluteLeft = options.absoluteLeft;
    if (options.absoluteWidth !== undefined)
      input.absoluteWidth = options.absoluteWidth;
    if (options.absoluteHeight !== undefined)
      input.absoluteHeight = options.absoluteHeight;
    if (options.absoluteTransitionDurationMs !== undefined)
      input.absoluteTransitionDurationMs =
        options.absoluteTransitionDurationMs;
    if (options.absoluteTransitionEasing !== undefined)
      input.absoluteTransitionEasing = options.absoluteTransitionEasing;
    if (options.cropTop !== undefined) input.cropTop = options.cropTop;
    if (options.cropLeft !== undefined) input.cropLeft = options.cropLeft;
    if (options.cropRight !== undefined) input.cropRight = options.cropRight;
    if (options.cropBottom !== undefined) input.cropBottom = options.cropBottom;

    if (options.activeTransition !== undefined) {
      const existingTimer = this.transitionTimers.get(inputId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.transitionTimers.delete(inputId);
      }

      const { type, durationMs, direction } = options.activeTransition;
      input.activeTransition = {
        type: type as ActiveTransition['type'],
        durationMs,
        direction,
        startedAtMs: Date.now(),
      };

      const timer = setTimeout(() => {
        input.activeTransition = undefined;
        this.transitionTimers.delete(inputId);
        this.onStateChange();
      }, durationMs);
      this.transitionTimers.set(inputId, timer);
    }

    this.onStateChange();
  }

  // ── Reorder ───────────────────────────────────────────────

  reorderInputs(inputOrder: string[]): void {
    const inputIdSet = new Set(this.inputs.map((input) => input.inputId));
    const inputs: RoomInputState[] = [];
    for (const inputId of inputOrder) {
      const input = this.inputs.find((i) => i.inputId === inputId);
      if (input) {
        inputs.push(input);
        inputIdSet.delete(inputId);
      }
    }
    for (const inputId of inputIdSet) {
      const input = this.inputs.find((i) => i.inputId === inputId);
      if (input) inputs.push(input);
    }
    this.inputs = inputs;
    this.onStateChange();
  }

  // ── Hide / Show ───────────────────────────────────────────

  hideInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ): void {
    const input = this.getInput(inputId);

    if (activeTransition) {
      const existingTimer = this.transitionTimers.get(inputId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.transitionTimers.delete(inputId);
      }

      const { type, durationMs, direction } = activeTransition;
      input.activeTransition = {
        type: type as ActiveTransition['type'],
        durationMs,
        direction,
        startedAtMs: Date.now(),
      };
      this.onStateChange();

      const timer = setTimeout(() => {
        input.hidden = true;
        input.activeTransition = undefined;
        this.transitionTimers.delete(inputId);
        this.onStateChange();
      }, durationMs);
      this.transitionTimers.set(inputId, timer);
    } else {
      input.hidden = true;
      this.onStateChange();
    }
  }

  showInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ): void {
    const input = this.getInput(inputId);
    input.hidden = false;

    if (activeTransition) {
      const existingTimer = this.transitionTimers.get(inputId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.transitionTimers.delete(inputId);
      }

      const { type, durationMs, direction } = activeTransition;
      input.activeTransition = {
        type: type as ActiveTransition['type'],
        durationMs,
        direction,
        startedAtMs: Date.now(),
      };

      const timer = setTimeout(() => {
        input.activeTransition = undefined;
        this.transitionTimers.delete(inputId);
        this.onStateChange();
      }, durationMs);
      this.transitionTimers.set(inputId, timer);
    }

    this.onStateChange();
  }

  // ── WHIP ──────────────────────────────────────────────────

  ackWhipInput(inputId: string): void {
    const input = this.getInput(inputId);
    if (input.type !== 'whip') throw new Error('Input is not a Whip input');
    const { previousAckTimestamp, currentAckTimestamp } =
      input.monitor.touch();
    const ageBeforeAckMs = currentAckTimestamp - previousAckTimestamp;
    console.log('[whip][ack]', {
      roomId: this.idPrefix,
      inputId,
      username: input.monitor.getUsername(),
      ageBeforeAckMs,
      inputStatus: input.status,
    });
  }

  async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
    const now = Date.now();
    for (const input of this.getInputs()) {
      if (input.type === 'whip') {
        const last = input.monitor.getLastAckTimestamp() || 0;
        const ageMs = now - last;
        if (ageMs > staleTtlMs * 0.7 && ageMs <= staleTtlMs) {
          console.log('[whip][health] ACK delayed', {
            roomId: this.idPrefix,
            inputId: input.inputId,
            username: input.monitor.getUsername(),
            ageMs,
            staleTtlMs,
            remainingMs: staleTtlMs - ageMs,
            inputStatus: input.status,
          });
        }
        if (ageMs > staleTtlMs) {
          if (input.status === 'connected') {
            console.log(
              '[whip][stale] Skipping removal — input still connected',
              {
                roomId: this.idPrefix,
                inputId: input.inputId,
                username: input.monitor.getUsername(),
                ageMs,
                staleTtlMs,
                inputStatus: input.status,
              },
            );
            continue;
          }
          try {
            console.log('[whip][stale] Removing stale WHIP input', {
              roomId: this.idPrefix,
              inputId: input.inputId,
              username: input.monitor.getUsername(),
              ageMs,
              staleTtlMs,
              overdueMs: ageMs - staleTtlMs,
              inputStatus: input.status,
            });
            await this.removeInput(input.inputId);
          } catch (err: any) {
            console.log(err, 'Failed to remove stale WHIP input');
          }
        }
      }
    }
  }

  // ── MP4 Restart ───────────────────────────────────────────

  async restartMp4Input(
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void> {
    const input = this.getInput(inputId);
    if (input.type !== 'local-mp4') {
      throw new Error(`Input ${inputId} is not a local-mp4 input`);
    }
    if (input.status !== 'connected') {
      throw new Error(`Input ${inputId} is not connected`);
    }

    const name = input.metadata.title;
    const t0 = Date.now();
    logTimelineEvent(
      this.idPrefix,
      `[mp4-restart] BEGIN "${name}" from=${playFromMs}ms loop=${loop}`,
    );

    input.restartFading = true;
    this.onStateChange();

    try {
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] unregister "${name}"`,
      );
      await SmelterInstance.unregisterInput(inputId);
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] unregister OK "${name}" ${Date.now() - t0}ms`,
      );

      const offsetMs = SmelterInstance.getPipelineTimeMs() - playFromMs;
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] register "${name}" loop=${loop} offsetMs=${offsetMs}`,
      );
      await SmelterInstance.registerInput(inputId, {
        type: 'mp4',
        filePath: input.mp4FilePath,
        loop,
        offsetMs,
      });
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] register OK "${name}" ${Date.now() - t0}ms`,
      );

      input.registeredAtPipelineMs = SmelterInstance.getPipelineTimeMs();
      if (loop && input.mp4DurationMs && input.mp4DurationMs > 0) {
        input.playFromMs = playFromMs % input.mp4DurationMs;
      } else {
        input.playFromMs = playFromMs;
      }
    } catch (err) {
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] FAILED "${name}" ${Date.now() - t0}ms ${err}`,
      );
      throw err;
    } finally {
      input.restartFading = false;
      this.onStateChange();
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] END "${name}" ${Date.now() - t0}ms`,
      );
    }
  }

  // ── Cleanup ───────────────────────────────────────────────

  async destroyAll(): Promise<void> {
    for (const timer of this.transitionTimers.values()) {
      clearTimeout(timer);
    }
    this.transitionTimers.clear();

    for (const input of this.inputs) {
      if (input.type === 'game') {
        for (const t of input.effectTimers) clearTimeout(t);
        input.effectTimers = [];
      }
    }

    const inputs = this.inputs;
    this.inputs = [];
    for (const input of inputs) {
      if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
        input.monitor.stop();
      }
      try {
        await SmelterInstance.unregisterInput(input.inputId);
      } catch (err: any) {
        console.error(
          'Failed to remove input when removing the room.',
          err?.body ?? err,
        );
      }
    }
  }
}

// ── Helper functions ──────────────────────────────────────────

function registerOptionsFromInput(
  input: RoomInputState,
): RegisterSmelterInputOptions {
  if (input.type === 'local-mp4') {
    return { type: 'mp4', filePath: input.mp4FilePath };
  } else if (
    input.type === 'twitch-channel' ||
    input.type === 'kick-channel' ||
    input.type === 'hls'
  ) {
    return { type: 'hls', url: input.hlsUrl };
  } else if (input.type === 'whip') {
    return { type: 'whip', url: input.whipUrl };
  } else if (input.type === 'image') {
    throw Error('Images cannot be connected as stream inputs');
  } else if (input.type === 'game') {
    throw Error('Snake game inputs do not need stream registration');
  } else if (input.type === 'hands') {
    throw Error('Hands inputs do not need stream registration');
  } else {
    throw Error('Unknown type');
  }
}

function inputIdForTwitchInput(
  idPrefix: string,
  twitchChannelId: string,
): string {
  return `${idPrefix}::twitch::${twitchChannelId}`;
}

function inputIdForKickInput(
  idPrefix: string,
  kickChannelId: string,
): string {
  return `${idPrefix}::kick::${kickChannelId}`;
}

export function formatMp4Name(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.mp4$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatImageName(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(
    /\.(jpg|jpeg|png|gif|svg)$/i,
    '',
  );
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isBlockedDefaultMp4(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.startsWith('logo_') || lower.startsWith('wrapped_');
}
