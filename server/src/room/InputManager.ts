import path from 'node:path';
import { pathExists, readdir } from 'fs-extra';
import { SmelterInstance, type RegisterSmelterInputOptions } from '../smelter';
import { hlsUrlForKickChannel, hlsUrlForTwitchChannel } from '../streamlink';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';
import { sleep } from '../utils';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../pictures/pictureSuggestionMonitor';
import {
  getMp4DurationMs,
  getMp4VideoDimensions,
} from '../routing/mp4Duration';
import { logTimelineEvent } from '../dashboard';
import { createDefaultSnakeGameInputState } from '../snakeGame/snakeGameState';
import { createHandsStore } from '../hands/handStore';
import type { ShaderConfig, ActiveTransition } from '../types';
import { DATA_DIR } from '../dataDir';
import { isSmelterTransportError } from '../smelterTransportError';
import type {
  RoomInputState,
  RegisterInputOptions,
  UpdateInputOptions,
} from './types';
import type { PlaceholderManager } from './PlaceholderManager';
import type { MotionController } from './MotionController';
import { InputOrientation } from '@smelter-editor/types';

const VIDEO_INPUT_TYPES: RoomInputState['type'][] = [
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
];
const MP4_RESTART_DEDUPE_WINDOW_MS = 1200;
const MP4_RESTART_PLAYFROM_EPSILON_MS = 75;

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|svg)$/i;

export class InputManager {
  private inputs: RoomInputState[] = [];
  private transitionTimers = new Map<string, NodeJS.Timeout>();
  private readonly mp4Files: string[];
  private mp4RestartDedupedCount = 0;
  private mp4RestartRequests = new Map<
    string,
    { playFromMs: number; loop: boolean; atMs: number }
  >();

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
    _skipDefaultInputs: boolean,
  ): Promise<void> {
    if (initInputs.length > 0) {
      for (const input of initInputs) {
        await this.addNewInput(input);
      }
    }
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
    const isScreenshare = /\bscreenshare\b/i.test(username);
    const cleanUsername = username
      .replace(/\[(camera|screenshare|live)\]\s*/gi, '')
      .trim();
    const liveTitle = isScreenshare ? '[Live] Screenshare' : '[Live] Camera';
    const monitor = await WhipInputMonitor.startMonitor(cleanUsername);
    monitor.touch();
    this.inputs.push({
      inputId,
      type: 'whip',
      status: 'disconnected',
      showTitle: false,
      shaders: [],
      orientation: 'horizontal',
      nativeWidth: 1920,
      nativeHeight: 1080,
      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      monitor,
      metadata: {
        title: liveTitle,
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
      orientation: 'horizontal' as InputOrientation,
      nativeWidth: 1920,
      nativeHeight: 1080,
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
    const resolvedFileName =
      opts.source?.audioFileName ?? opts.source?.fileName;

    if (!resolvedFileName) {
      throw new Error(
        'local-mp4 requires source.fileName or source.audioFileName.',
      );
    }

    const baseDir = isAudio ? 'audios' : 'mp4s';
    const mp4Path = path.join(DATA_DIR, baseDir, resolvedFileName);
    const mp4Name = resolvedFileName;
    const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;

    if (!(await pathExists(mp4Path))) {
      const titlePrefix = isAudio ? 'AUDIO' : 'MP4';
      return this.pushMissingLocalMp4Placeholder({
        mp4Path,
        isAudio,
        title: `[Missing ${titlePrefix}] ${formatMp4Name(mp4Name)}`,
        description: isAudio
          ? 'Audio file not found on server. Attach a file from the list below.'
          : 'MP4 not found on server. Attach a file from the list below.',
      });
    }

    const dims = await getMp4VideoDimensions(mp4Path);
    const titlePrefix = isAudio ? 'AUDIO' : 'MP4';

    this.inputs.push({
      inputId,
      type: 'local-mp4',
      status: 'disconnected',
      showTitle: false,
      shaders: [],
      orientation: 'horizontal',
      nativeWidth: 1920,
      nativeHeight: 1080,
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

  /**
   * When an MP4/audio file from config is missing, keep a disconnected local-mp4
   * slot so the client can attach a real file later without losing inputId.
   */
  private pushMissingLocalMp4Placeholder(params: {
    mp4Path: string;
    isAudio: boolean;
    title: string;
    description: string;
  }): string {
    const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;
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
        title: params.title,
        description: params.description,
      },
      mp4FilePath: params.mp4Path,
      mp4AssetMissing: true,
      missingAssetIsAudio: params.isAudio,
      volume: 0,
    });
    this.onStateChange();
    return inputId;
  }

  /** Wire a real file from mp4s/ or audios/ into a missing-asset placeholder, then connect. */
  async resolveMissingLocalMp4Asset(
    inputId: string,
    opts: { fileName?: string; audioFileName?: string },
  ): Promise<void> {
    const input = this.getInput(inputId);
    if (input.type !== 'local-mp4' || !input.mp4AssetMissing) {
      throw new Error('Input is not a missing-asset MP4 placeholder');
    }
    const hasAudio = opts.audioFileName !== undefined;
    const hasVideo = opts.fileName !== undefined;
    if (hasAudio === hasVideo) {
      throw new Error('Provide exactly one of fileName or audioFileName');
    }
    const isAudio = hasAudio;
    const resolvedFileName = (isAudio ? opts.audioFileName : opts.fileName)!;
    const baseDir = isAudio ? 'audios' : 'mp4s';
    const mp4Path = path.join(DATA_DIR, baseDir, resolvedFileName);
    if (!(await pathExists(mp4Path))) {
      throw new Error(`File not found in ${baseDir}/: ${resolvedFileName}`);
    }

    const dims = await getMp4VideoDimensions(mp4Path);
    const mp4Name = resolvedFileName;
    const titlePrefix = isAudio ? 'AUDIO' : 'MP4';

    input.mp4FilePath = mp4Path;
    input.mp4AssetMissing = false;
    input.missingAssetIsAudio = undefined;
    input.mp4VideoWidth = dims?.width;
    input.mp4VideoHeight = dims?.height;
    input.metadata.title = `[${titlePrefix}] ${formatMp4Name(mp4Name)}`;
    input.metadata.description = isAudio
      ? '[Audio source] Converted from audio file'
      : '[Static source] AI Generated';

    this.onStateChange();
    await this.connectInput(inputId);
  }

  async resolveMissingImageAsset(
    inputId: string,
    opts: { fileName: string },
  ): Promise<void> {
    const input = this.getInput(inputId);
    if (input.type !== 'image' || !input.imageAssetMissing) {
      throw new Error('Input is not a missing image placeholder');
    }

    const imageId = await this.registerImageAsset(opts.fileName);
    input.imageId = imageId;
    input.imageFileName = opts.fileName;
    input.imageAssetMissing = false;
    input.metadata.title = formatImageName(opts.fileName);
    input.metadata.description = '';
    input.status = 'connected';

    this.onStateChange();
  }

  private async registerImageAsset(fileName: string): Promise<string> {
    const imagePath = path.join(DATA_DIR, 'pictures', fileName);
    if (!(await pathExists(imagePath))) {
      throw new Error(`Image not found in pictures/: ${fileName}`);
    }

    const lower = fileName.toLowerCase();
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
    const ext = exts.find((x) => lower.endsWith(x));
    if (!ext) {
      throw new Error(`Unsupported image format: ${fileName}`);
    }

    const imageId = imageIdFromFileName(fileName);
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
        assetType,
      });
    } catch {
      // ignore if already registered
    }

    return imageId;
  }

  private async addImageInput(
    opts: Extract<RegisterInputOptions, { type: 'image' }>,
  ): Promise<string> {
    console.log('Adding image');
    const picturesDir = path.join(DATA_DIR, 'pictures');
    const inputId = `${this.idPrefix}::image::${Date.now()}`;

    let fileName = opts.fileName;
    let imageId = opts.imageId;

    if (imageId && !fileName) {
      const found = pictureSuggestionsMonitor.pictureFiles.find(
        (candidate) => imageIdFromFileName(candidate) === imageId,
      );
      if (found) {
        fileName = found;
      } else {
        const missingImageName = formatImageName(
          path.basename(imageId.replace(/^pictures::/, '')),
        );
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
          metadata: {
            title: `[Missing image] ${missingImageName}`,
            description:
              'Image not found on server. This slot is reserved; attach an image file below to use it.',
          },
          volume: 0,
          imageId,
          imageFileName: fileName,
          imageAssetMissing: true,
        });
        this.onStateChange();
        return inputId;
      }
    }

    if (!fileName) {
      throw new Error(
        'Either fileName or imageId must be provided for image input',
      );
    }

    const imagePath = path.join(picturesDir, fileName);

    if (await pathExists(imagePath)) {
      imageId = await this.registerImageAsset(fileName);

      this.inputs.push({
        inputId,
        type: 'image',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        nativeWidth: 1920,
        nativeHeight: 1080,
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        motionEnabled: false,
        metadata: { title: formatImageName(fileName), description: '' },
        volume: 0,
        imageId,
        imageFileName: fileName,
      });
      this.onStateChange();
    } else {
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
        metadata: {
          title: `[Missing image] ${formatImageName(path.basename(fileName))}`,
          description:
            'Image not found on server. This slot is reserved; attach an image file below to use it.',
        },
        volume: 0,
        imageId: imageId ?? imageIdFromFileName(fileName),
        imageFileName: fileName,
        imageAssetMissing: true,
      });
      this.onStateChange();
      return inputId;
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
      orientation: 'horizontal',
      nativeWidth: 1920,
      nativeHeight: 1080,
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
      textScrollEnabled: opts.textScrollEnabled ?? true,
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
      orientation: 'horizontal',
      nativeWidth: 1920,
      nativeHeight: 1080,
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
      metadata: {
        title: 'Hand Tracking',
        description: 'Cyberpunk hand overlay',
      },
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

    if (input.type === 'local-mp4' && input.mp4AssetMissing) {
      return '';
    }

    if (
      input.type === 'image' ||
      input.type === 'game' ||
      input.type === 'hands'
    ) {
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
    input.orientation = options.orientation ?? input.orientation;
    // Update native resolution heuristic when orientation changes
    if (options.orientation !== undefined) {
      input.nativeWidth = options.orientation === 'vertical' ? 1080 : 1920;
      input.nativeHeight = options.orientation === 'vertical' ? 1920 : 1080;
    }
    input.borderColor = options.borderColor ?? input.borderColor;
    input.borderWidth = options.borderWidth ?? input.borderWidth;

    if (input.type === 'text-input') {
      if (options.text !== undefined) input.text = options.text;
      if (options.textAlign !== undefined) input.textAlign = options.textAlign;
      if (options.textColor !== undefined) input.textColor = options.textColor;
      if (options.textMaxLines !== undefined)
        input.textMaxLines = options.textMaxLines;
      if (options.textScrollEnabled !== undefined)
        input.textScrollEnabled = options.textScrollEnabled;
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
      input.absoluteTransitionDurationMs = options.absoluteTransitionDurationMs;
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
    const { previousAckTimestamp, currentAckTimestamp } = input.monitor.touch();
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
    if (input.mp4AssetMissing) {
      throw new Error(
        `Input ${inputId} has no file on disk yet; attach an MP4 first`,
      );
    }
    if (input.status !== 'connected') {
      throw new Error(`Input ${inputId} is not connected`);
    }

    const name = input.metadata.title;
    const requestedPlayFromMs = Number.isFinite(playFromMs) ? playFromMs : 0;
    let normalizedPlayFromMs = Math.max(0, requestedPlayFromMs);
    const durationMs = input.mp4DurationMs;
    if (durationMs && durationMs > 0) {
      if (loop) {
        normalizedPlayFromMs = normalizedPlayFromMs % durationMs;
      } else {
        // Prevent seeking past the tail of finite clips.
        normalizedPlayFromMs = Math.min(
          normalizedPlayFromMs,
          Math.max(0, durationMs - 1),
        );
      }
    }
    const now = Date.now();
    const previous = this.mp4RestartRequests.get(inputId);
    if (
      previous &&
      previous.loop === loop &&
      now - previous.atMs <= MP4_RESTART_DEDUPE_WINDOW_MS &&
      Math.abs(previous.playFromMs - normalizedPlayFromMs) <=
        MP4_RESTART_PLAYFROM_EPSILON_MS
    ) {
      this.mp4RestartDedupedCount += 1;
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] DEDUPE skip "${name}" from=${normalizedPlayFromMs}ms prev=${previous.playFromMs}ms windowMs=${MP4_RESTART_DEDUPE_WINDOW_MS} dropped=${this.mp4RestartDedupedCount}`,
      );
      return;
    }
    this.mp4RestartRequests.set(inputId, {
      playFromMs: normalizedPlayFromMs,
      loop,
      atMs: now,
    });
    const t0 = now;
    logTimelineEvent(
      this.idPrefix,
      `[mp4-restart] BEGIN "${name}" from=${normalizedPlayFromMs}ms loop=${loop}`,
    );

    input.restartFading = true;
    this.onStateChange();

    try {
      logTimelineEvent(this.idPrefix, `[mp4-restart] unregister "${name}"`);
      await SmelterInstance.unregisterInput(inputId);
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] unregister OK "${name}" ${Date.now() - t0}ms`,
      );
      if (normalizedPlayFromMs !== requestedPlayFromMs) {
        logTimelineEvent(
          this.idPrefix,
          `[mp4-restart] normalize-playhead "${name}" requested=${requestedPlayFromMs}ms normalized=${normalizedPlayFromMs}ms loop=${loop}`,
        );
      }

      let offsetMs = SmelterInstance.getPipelineTimeMs() - normalizedPlayFromMs;
      if (offsetMs < 0) {
        logTimelineEvent(
          this.idPrefix,
          `[mp4-restart] clamp-offset "${name}" requestedOffsetMs=${offsetMs} clampedOffsetMs=0`,
        );
        offsetMs = 0;
      }
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
      input.playFromMs = normalizedPlayFromMs;
    } catch (err) {
      logTimelineEvent(
        this.idPrefix,
        `[mp4-restart] FAILED "${name}" ${Date.now() - t0}ms ${err}`,
      );
      this.mp4RestartRequests.delete(inputId);
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
        const errorCode = err?.body?.error_code;
        if (
          errorCode === 'INPUT_STREAM_NOT_FOUND' ||
          isSmelterTransportError(err)
        ) {
          // Input teardown can race with room stop / Smelter recovery.
          console.warn(
            `[room] Skipping input unregister during room teardown inputId=${input.inputId} code=${errorCode ?? 'transport'}`,
          );
          continue;
        }
        console.error(
          `[room] Failed to remove input during room teardown inputId=${input.inputId}`,
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

function inputIdForKickInput(idPrefix: string, kickChannelId: string): string {
  return `${idPrefix}::kick::${kickChannelId}`;
}

function formatMp4Name(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.mp4$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatImageName(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(IMAGE_EXT_RE, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function imageIdFromFileName(fileName: string): string {
  const baseName = fileName.replace(IMAGE_EXT_RE, '');
  return `pictures::${baseName}`;
}

function isBlockedDefaultMp4(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.startsWith('logo_') || lower.startsWith('wrapped_');
}
