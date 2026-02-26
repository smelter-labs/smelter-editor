import { ensureDir, pathExists, readdir, remove } from 'fs-extra';
import path from 'node:path';
import { SmelterInstance, type RegisterSmelterInputOptions, type SmelterOutput } from '../smelter';
import { hlsUrlForKickChannel, hlsUrlForTwitchChannel } from '../streamlink';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import { sleep } from '../utils';
import type { GameState, InputConfig, Layout, SnakeEventShaderConfig, SnakeEventShaderMapping, ActiveSnakeEffect, SnakeEventType } from '../app/store';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import type { ShaderConfig } from '../shaders/shaders';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';
import type { RoomNameEntry } from './roomNames';

export type InputOrientation = 'horizontal' | 'vertical';

export type RoomInputState = {
  inputId: string;
  type: 'local-mp4' | 'twitch-channel' | 'kick-channel' | 'whip' | 'image' | 'text-input' | 'game';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  borderColor: string;
  borderWidth: number;
  hidden: boolean;
  attachedInputIds?: string[];
  metadata: {
    title: string;
    description: string;
  };
} & TypeSpecificState;

type TypeSpecificState =
  | { type: 'local-mp4'; mp4FilePath: string }
  | { type: 'twitch-channel'; channelId: string; hlsUrl: string; monitor: TwitchChannelMonitor }
  | { type: 'kick-channel'; channelId: string; hlsUrl: string; monitor: KickChannelMonitor }
  | { type: 'whip'; whipUrl: string; monitor: WhipInputMonitor }
  | { type: 'image'; imageId: string }
  | { type: 'text-input'; text: string; textAlign: 'left' | 'center' | 'right'; textColor: string; textMaxLines: number; textScrollSpeed: number; textScrollLoop: boolean; textScrollNudge: number; textFontSize: number }
  | { type: 'game'; gameState: GameState; snakeEventShaders?: SnakeEventShaderConfig; snake1Shaders?: ShaderConfig[]; snake2Shaders?: ShaderConfig[]; activeEffects: ActiveSnakeEffect[]; effectTimers: NodeJS.Timeout[] };

export type PendingWhipInputData = {
  id: string;
  title: string;
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  position: number;
};

type UpdateInputOptions = {
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  attachedInputIds: string[];
  text: string;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  textMaxLines: number;
  textScrollSpeed: number;
  textScrollLoop: boolean;
  textScrollNudge: number;
  textFontSize: number;
  borderColor: string;
  borderWidth: number;
  gameBackgroundColor: string;
  gameCellGap: number;
  gameBoardBorderColor: string;
  gameBoardBorderWidth: number;
  gameGridLineColor: string;
  gameGridLineAlpha: number;
  snakeEventShaders: SnakeEventShaderConfig;
  snake1Shaders: ShaderConfig[];
  snake2Shaders: ShaderConfig[];
};

export type RegisterInputOptions =
  | {
      type: 'twitch-channel';
      channelId: string;
    }
  | {
      type: 'kick-channel';
      channelId: string;
    }
  | {
      type: 'whip';
      username: string;
    }
  | {
      type: 'local-mp4';
      source: {
        fileName?: string;
        url?: string;
      };
    }
  | {
      type: 'image';
      fileName?: string;
      imageId?: string;
    }
  | {
      type: 'text-input';
      text: string;
      textAlign?: 'left' | 'center' | 'right';
      textColor?: string;
      textMaxLines?: number;
      textScrollSpeed?: number;
      textScrollLoop?: boolean;
      textFontSize?: number;
    }
  | {
      type: 'game';
      title?: string;
    };

const PLACEHOLDER_LOGO_FILE = 'logo_Smelter.png';

function makeSnakeEffectMapping(
  effectType: number,
  color: string,
  intensity: number,
  durationMs: number,
  application: SnakeEventShaderMapping['application'] = { mode: 'all' },
): SnakeEventShaderMapping {
  return {
    enabled: true,
    shaderId: 'snake-event-highlight',
    params: [
      { paramName: 'effect_type', paramValue: effectType },
      { paramName: 'intensity', paramValue: intensity },
      { paramName: 'effect_color', paramValue: color },
      { paramName: 'progress', paramValue: 0 },
    ],
    application,
    effectDurationMs: durationMs,
  };
}

const DEFAULT_SNAKE_EVENT_SHADERS: SnakeEventShaderConfig = {
  // speed_up: quick shake to convey acceleration
  speed_up: makeSnakeEffectMapping(3, '#00ccff', 0.5, 400),
  // cut_opponent: dramatic chromatic burst in red-orange
  cut_opponent: makeSnakeEffectMapping(7, '#ff4400', 0.8, 500),
  // got_cut: bright red flash — you got hit
  got_cut: makeSnakeEffectMapping(2, '#ff0000', 0.9, 600),
  // cut_self: dark vignette pulse in purple — self-harm
  cut_self: makeSnakeEffectMapping(6, '#8800ff', 0.7, 700),
  // eat_block: green pulse glow — reward feedback
  eat_block: makeSnakeEffectMapping(1, '#00ff66', 0.6, 350),
  // bounce_block: ripple distortion in yellow
  bounce_block: makeSnakeEffectMapping(5, '#ffcc00', 0.5, 400),
  // no_moves: slow pixelation fade in gray
  no_moves: makeSnakeEffectMapping(8, '#888888', 0.6, 800),
  // game_over: heavy dark vignette in deep red, long duration
  game_over: makeSnakeEffectMapping(6, '#cc0000', 1.0, 1500),
};

export class RoomState {
  private inputs: RoomInputState[];
  private layout: Layout = 'picture-in-picture';
  private swapDurationMs: number = 500;
  private swapOutgoingEnabled: boolean = true;
  private swapFadeInDurationMs: number = 500;
  private swapFadeOutDurationMs: number = 500;
  private newsStripFadeDuringSwap: boolean = true;
  private newsStripEnabled: boolean = false;
  public idPrefix: string;

  private mp4sDir: string;
  private mp4Files: string[];
  private output: SmelterOutput;

  private recording?: {
    outputId: string;
    filePath: string;
    fileName: string;
    startedAt: number;
    stoppedAt?: number;
  };

  public lastReadTimestamp: number;
  public creationTimestamp: number;

  public pendingDelete?: boolean;
  public isPublic: boolean = true;
  public pendingWhipInputs: PendingWhipInputData[] = [];
  public roomName: RoomNameEntry;

  public constructor(idPrefix: string, output: SmelterOutput, initInputs: RegisterInputOptions[], skipDefaultInputs: boolean = false, roomName?: RoomNameEntry) {
    this.mp4sDir = path.join(process.cwd(), 'mp4s');
    this.mp4Files = mp4SuggestionsMonitor.mp4Files;
    this.inputs = [];
    this.idPrefix = idPrefix;
    this.output = output;
    this.roomName = roomName ?? { pl: `Pokój ${idPrefix.slice(0, 6)}`, en: `Room ${idPrefix.slice(0, 6)}` };

    this.lastReadTimestamp = Date.now();
    this.creationTimestamp = Date.now();

    void (async () => {
      await this.getInitialInputState(idPrefix, initInputs, skipDefaultInputs);
      const realThis = this;
      for (let i = 0; i < realThis.inputs.length; i++) {
        const maybeInput = realThis.inputs[i];
        if (maybeInput) {
          await this.connectInput(maybeInput.inputId);
        }
      }
    })();
  }

  private async getInitialInputState(
    idPrefix: string,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false
  ): Promise<void> {
    if (initInputs.length > 0) {
      for (const input of initInputs) {
        await this.addNewInput(input);
      }
    } else if (!skipDefaultInputs) {
      // Filter out files starting with "logo_" or "wrapped_" for default auto-add
      const eligibleMp4Files = this.mp4Files.filter(file => !isBlockedDefaultMp4(file));

      if (eligibleMp4Files.length > 0) {
        const randomIndex = Math.floor(Math.random() * eligibleMp4Files.length);
        for (let i = 0; i < 2; i++) {
          const randomMp4 = eligibleMp4Files[(randomIndex + i) % eligibleMp4Files.length];
          const mp4FilePath = path.join(this.mp4sDir, randomMp4);

          this.inputs.push({
            inputId: `${idPrefix}::local::sample_streamer::${i}`,
            type: 'local-mp4',
            status: 'disconnected',
            showTitle: false,
            shaders: [],
            orientation: 'horizontal',
            borderColor: '#ff0000',
            borderWidth: 0,
            hidden: false,
            metadata: {
              title: `[MP4] ${formatMp4Name(randomMp4)}`,
              description: '[Static source] AI Generated',
            },
            mp4FilePath,
            volume: 0,
          });
        }
      }
    }

    // Ensure placeholder is added if no inputs exist
    await this.ensurePlaceholder();
  }

  public getWhepUrl(): string {
    return this.output.url;
  }

  public getResolution(): { width: number; height: number } {
    return this.output.resolution;
  }

  public hasActiveRecording(): boolean {
    return !!this.recording && !this.recording.stoppedAt;
  }

  public async startRecording(): Promise<{ fileName: string }> {
    if (this.hasActiveRecording()) {
      throw new Error('Recording is already in progress for this room');
    }

    const recordingsDir = path.join(process.cwd(), 'recordings');
    await ensureDir(recordingsDir);

    const timestamp = Date.now();
    const recordingId = `${this.idPrefix}::recording::${timestamp}`;
    const safeRoomId = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `recording-${safeRoomId}-${timestamp}.mp4`;
    const filePath = path.join(recordingsDir, fileName);

    await SmelterInstance.registerMp4Output(recordingId, this.output, filePath);

    this.recording = {
      outputId: recordingId,
      filePath,
      fileName,
      startedAt: timestamp,
    };

    return { fileName };
  }

  public async stopRecording(): Promise<{ fileName: string }> {
    if (!this.recording || this.recording.stoppedAt) {
      throw new Error('No active recording to stop for this room');
    }

    try {
      await SmelterInstance.unregisterOutput(this.recording.outputId);
    } finally {
      this.recording.stoppedAt = Date.now();
    }

    // Enforce a global cap on stored recordings to avoid unbounded growth.
    // Keep only the newest N recordings on disk and remove older ones.
    try {
      await pruneOldRecordings(10);
    } catch (err) {
      // Best-effort cleanup – log but don't fail the API if pruning fails.
      console.error('Failed to prune old recordings', err);
    }

    return { fileName: this.recording.fileName };
  }

  public getState(): [RoomInputState[], Layout, number, boolean, number, boolean, number, boolean] {
    this.lastReadTimestamp = Date.now();
    return [this.inputs, this.layout, this.swapDurationMs, this.swapOutgoingEnabled, this.swapFadeInDurationMs, this.newsStripFadeDuringSwap, this.swapFadeOutDurationMs, this.newsStripEnabled];
  }

  public getSwapDurationMs(): number {
    return this.swapDurationMs;
  }

  public setSwapDurationMs(value: number) {
    this.swapDurationMs = value;
    this.updateStoreWithState();
  }

  public getSwapOutgoingEnabled(): boolean {
    return this.swapOutgoingEnabled;
  }

  public setSwapOutgoingEnabled(value: boolean) {
    this.swapOutgoingEnabled = value;
    this.updateStoreWithState();
  }

  public getSwapFadeInDurationMs(): number {
    return this.swapFadeInDurationMs;
  }

  public setSwapFadeInDurationMs(value: number) {
    this.swapFadeInDurationMs = value;
    this.updateStoreWithState();
  }

  public getSwapFadeOutDurationMs(): number {
    return this.swapFadeOutDurationMs;
  }

  public setSwapFadeOutDurationMs(value: number) {
    this.swapFadeOutDurationMs = value;
    this.updateStoreWithState();
  }

  public getNewsStripFadeDuringSwap(): boolean {
    return this.newsStripFadeDuringSwap;
  }

  public setNewsStripFadeDuringSwap(value: boolean) {
    this.newsStripFadeDuringSwap = value;
    this.updateStoreWithState();
  }

  public getNewsStripEnabled(): boolean {
    return this.newsStripEnabled;
  }

  public setNewsStripEnabled(value: boolean) {
    this.newsStripEnabled = value;
    this.updateStoreWithState();
  }

  public getInputs(): RoomInputState[] {
    return this.inputs;
  }

  private getPlaceholderId(): string {
    return `${this.idPrefix}::placeholder::smelter-logo`;
  }

  private isPlaceholder(inputId: string): boolean {
    return inputId === this.getPlaceholderId();
  }

  private async ensurePlaceholder(): Promise<void> {
    // Check if there are any non-placeholder inputs
    const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
    if (nonPlaceholderInputs.length > 0) {
      return; // Don't add placeholder if there are real inputs
    }

    // Check if placeholder already exists
    if (this.inputs.find(inp => this.isPlaceholder(inp.inputId))) {
      return; // Placeholder already exists
    }

    // Add placeholder
    const inputId = this.getPlaceholderId();
    const picturesDir = path.join(process.cwd(), 'pictures');
    const imagePath = path.join(picturesDir, PLACEHOLDER_LOGO_FILE);

    if (await pathExists(imagePath)) {
      const imageId = `placeholder::smelter-logo`;
      const assetType = 'png';

      // Register image resource
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
        orientation: 'horizontal',
            borderColor: '#ff0000',
            borderWidth: 0,
        hidden: false,
        metadata: {
          title: 'Smelter',
          description: '',
        },
        volume: 0,
        imageId,
      });
      this.updateStoreWithState();
    }
  }

  private async removePlaceholder(): Promise<void> {
    const placeholder = this.inputs.find(inp => this.isPlaceholder(inp.inputId));
    if (placeholder) {
      this.inputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
      this.updateStoreWithState();
    }
  }

  public async addNewWhipInput(username: string) {
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
      orientation: 'horizontal',
      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      monitor: monitor,
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
    channelId: string
  ): Promise<string> {
    const inputId =
      platform === 'twitch-channel'
        ? inputIdForTwitchInput(this.idPrefix, channelId)
        : inputIdForKickInput(this.idPrefix, channelId);
    const platformLabel = platform === 'twitch-channel' ? 'Twitch' : 'Kick';
    if (this.inputs.find(input => input.inputId === inputId)) {
      throw new Error(`Input for ${platformLabel} channel ${channelId} already exists.`);
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
      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
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
      inputState = { ...baseState, type: 'twitch-channel', monitor: twitchMonitor };
    } else {
      const kickMonitor = await KickChannelMonitor.startMonitor(channelId);
      monitor = kickMonitor;
      inputState = { ...baseState, type: 'kick-channel', monitor: kickMonitor };
    }
    monitor.onUpdate((streamInfo: TwitchStreamInfo, _isLive: boolean) => {
      inputState.metadata.title = platform === 'twitch-channel'
        ? `[Twitch.tv/${streamInfo.category}] ${streamInfo.displayName}`
        : `[Kick.com] ${streamInfo.displayName}`;
      inputState.metadata.description = streamInfo.title;
      this.updateStoreWithState();
    });
    this.inputs.push(inputState);
    return inputId;
  }

  public async addNewInput(opts: RegisterInputOptions) {
    // Remove placeholder if it exists
    await this.removePlaceholder();

    if (opts.type === 'whip') {
      const inputId = await this.addNewWhipInput(opts.username);
      return inputId;
    } else if (opts.type === 'twitch-channel' || opts.type === 'kick-channel') {
      return this.addHlsChannelInput(opts.type, opts.channelId);
    } else if (opts.type === 'local-mp4') {
      if (!opts.source?.fileName) {
        throw new Error(
          'local-mp4 requires source.fileName. Only URL is not supported; provide a file name from the mp4s directory.'
        );
      }
      console.log('Adding local mp4');
      const mp4Path = path.join(process.cwd(), 'mp4s', opts.source.fileName);
      const mp4Name = opts.source.fileName;
      const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;

      if (!(await pathExists(mp4Path))) {
        throw new Error(`MP4 file not found: ${opts.source.fileName}`);
      }

      this.inputs.push({
        inputId,
        type: 'local-mp4',
        status: 'disconnected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        metadata: {
          title: `[MP4] ${formatMp4Name(mp4Name)}`,
          description: '[Static source] AI Generated',
        },
        mp4FilePath: mp4Path,
        volume: 0,
      });
      return inputId;
    } else if (opts.type === 'image') {
      console.log('Adding image');
      const picturesDir = path.join(process.cwd(), 'pictures');
      const inputId = `${this.idPrefix}::image::${Date.now()}`;
      const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];

      let fileName = opts.fileName;
      let imageId = opts.imageId;

      // If imageId is provided but not fileName, find the file
      if (imageId && !fileName) {
        const baseName = imageId.replace(/^pictures::/, '');
        const files = await readdir(picturesDir).catch(() => [] as string[]);
        const found = files.find(f => {
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
        throw new Error('Either fileName or imageId must be provided for image input');
      }

      const imagePath = path.join(picturesDir, fileName);

      if (await pathExists(imagePath)) {
        const lower = fileName.toLowerCase();
        const ext = exts.find(x => lower.endsWith(x));
        if (!ext) {
          throw new Error(`Unsupported image format: ${fileName}`);
        }
        const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
        imageId = `pictures::${baseName}`;
        const assetType =
          ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';

        // Register image resource
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
          orientation: 'horizontal',
          borderColor: '#ff0000',
          borderWidth: 0,
          hidden: false,
          metadata: {
            title: formatImageName(fileName),
            description: '',
          },
          volume: 0,
          imageId,
        });
        this.updateStoreWithState();
      } else {
        throw new Error(`Image file not found: ${fileName}`);
      }

      return inputId;
    } else if (opts.type === 'text-input') {
      console.log('Adding text input');
      const inputId = `${this.idPrefix}::text::${Date.now()}`;

      this.inputs.push({
        inputId,
        type: 'text-input',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 8,
        hidden: false,
        metadata: {
          title: 'Text',
          description: '',
        },
        volume: 0,
        text: opts.text,
        textAlign: opts.textAlign ?? 'left',
        textColor: opts.textColor ?? '#ffffff',
        textMaxLines: opts.textMaxLines ?? 10,
        textScrollSpeed: opts.textScrollSpeed ?? 40,
        textScrollLoop: opts.textScrollLoop ?? true,
        textScrollNudge: 0,
        textFontSize: opts.textFontSize ?? 80,
      });
      this.updateStoreWithState();

      return inputId;
    } else if (opts.type === 'game') {
      console.log('Adding game input');
      const inputId = `${this.idPrefix}::game::${Date.now()}`;

      this.inputs.push({
        inputId,
        type: 'game',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        metadata: {
          title: opts.title ?? 'Game',
          description: '',
        },
        volume: 0,
        gameState: {
          boardWidth: 20,
          boardHeight: 20,
          cellSize: 1,
          cells: [],
          smoothMove: false,
          smoothMoveSpeed: 1,
          backgroundColor: '#1e222c',
          cellGap: 2,
          boardBorderColor: '#ffffff',
          boardBorderWidth: 4,
          gridLineColor: '#000000',
          gridLineAlpha: 1.0,
        },
        snakeEventShaders: { ...DEFAULT_SNAKE_EVENT_SHADERS },
        activeEffects: [],
        effectTimers: [],
      });
      this.updateStoreWithState();
      return inputId;
    }
  }

  public async removeInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);

    // Check if this is the last non-placeholder input
    const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
    const willBeEmpty =
      nonPlaceholderInputs.length === 1 && nonPlaceholderInputs[0].inputId === inputId;

    // If removing the last input, add placeholder first
    if (willBeEmpty) {
      await this.ensurePlaceholder();
    }

    this.inputs = this.inputs.filter(input => input.inputId !== inputId);
    for (const other of this.inputs) {
      if (other.attachedInputIds) {
        other.attachedInputIds = other.attachedInputIds.filter(id => id !== inputId);
      }
    }
    this.updateStoreWithState();
    if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
      input.monitor.stop();
    }

    const PENDING_WAIT_TIMEOUT_MS = 30_000;
    const waitStart = Date.now();
    while (input.status === 'pending') {
      if (Date.now() - waitStart > PENDING_WAIT_TIMEOUT_MS) {
        console.warn(`[roomState] Timed out waiting for pending input ${inputId}, forcing disconnected`);
        input.status = 'disconnected';
        break;
      }
      await sleep(500);
    }
    if (input.status === 'connected') {
      try {
        await SmelterInstance.unregisterInput(inputId);
      } catch (err: any) {
        console.log(err, 'Failed to unregister when removing input.');
      }
      input.status = 'disconnected';
    }
  }

  public async connectInput(inputId: string): Promise<string> {
    const input = this.getInput(inputId);
    if (input.status !== 'disconnected') {
      return '';
    }
    // Images, text-inputs, and games are static resources, they don't need to be connected as stream inputs
    if (input.type === 'image' || input.type === 'game') {
      input.status = 'connected';
      this.updateStoreWithState();
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
          setTimeout(() => reject(new Error(`Timeout connecting input ${inputId}`)), CONNECT_TIMEOUT_MS)
        ),
      ]);
      response = res;
    } catch (err: any) {
      response = err.body?.url;
      input.status = 'disconnected';
      this.updateStoreWithState();
      throw err;
    }
    input.status = 'connected';
    this.updateStoreWithState();
    return response;
  }

  public async ackWhipInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);
    if (input.type !== 'whip') {
      throw new Error('Input is not a Whip input');
    }
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

  public async disconnectInput(inputId: string) {
    const input = this.getInput(inputId);
    if (input.status === 'disconnected') {
      return;
    }
    input.status = 'pending';
    this.updateStoreWithState();
    try {
      await SmelterInstance.unregisterInput(inputId);
    } finally {
      input.status = 'disconnected';
      this.updateStoreWithState();
    }
  }

  public async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
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
          // If the input is still connected (WebRTC media flowing), don't
          // remove it — the client heartbeat may be paused (mobile browser
          // backgrounded / screen off) but the connection is alive.
          if (input.status === 'connected') {
            console.log('[whip][stale] Skipping removal — input still connected', {
              roomId: this.idPrefix,
              inputId: input.inputId,
              username: input.monitor.getUsername(),
              ageMs,
              staleTtlMs,
              inputStatus: input.status,
            });
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

  public async updateInput(inputId: string, options: Partial<UpdateInputOptions>) {
    const input = this.getInput(inputId);
    input.volume = options.volume ?? input.volume;
    input.shaders = options.shaders ?? input.shaders;
    input.showTitle = options.showTitle ?? input.showTitle;
    input.orientation = options.orientation ?? input.orientation;
    input.borderColor = options.borderColor ?? input.borderColor;
    input.borderWidth = options.borderWidth ?? input.borderWidth;
    if (input.type === 'text-input') {
      if (options.text !== undefined) {
        input.text = options.text;
      }
      if (options.textAlign !== undefined) {
        input.textAlign = options.textAlign;
      }
      if (options.textColor !== undefined) {
        input.textColor = options.textColor;
      }
      if (options.textMaxLines !== undefined) {
        input.textMaxLines = options.textMaxLines;
      }
      if (options.textScrollSpeed !== undefined) {
        input.textScrollSpeed = options.textScrollSpeed;
      }
      if (options.textScrollLoop !== undefined) {
        input.textScrollLoop = options.textScrollLoop;
      }
      if (options.textScrollNudge !== undefined) {
        input.textScrollNudge = options.textScrollNudge;
      }
      if (options.textFontSize !== undefined) {
        input.textFontSize = options.textFontSize;
      }
    }
    if (input.type === 'game') {
      if (options.gameBackgroundColor !== undefined) {
        input.gameState.backgroundColor = options.gameBackgroundColor;
      }
      if (options.gameCellGap !== undefined) {
        input.gameState.cellGap = options.gameCellGap;
      }
      if (options.gameBoardBorderColor !== undefined) {
        input.gameState.boardBorderColor = options.gameBoardBorderColor;
      }
      if (options.gameBoardBorderWidth !== undefined) {
        input.gameState.boardBorderWidth = options.gameBoardBorderWidth;
      }
      if (options.gameGridLineColor !== undefined) {
        input.gameState.gridLineColor = options.gameGridLineColor;
      }
      if (options.gameGridLineAlpha !== undefined) {
        input.gameState.gridLineAlpha = options.gameGridLineAlpha;
      }
      if (options.snakeEventShaders !== undefined) {
        input.snakeEventShaders = options.snakeEventShaders;
      }
      if (options.snake1Shaders !== undefined) {
        input.snake1Shaders = options.snake1Shaders;
      }
      if (options.snake2Shaders !== undefined) {
        input.snake2Shaders = options.snake2Shaders;
      }
    }
    if (options.attachedInputIds !== undefined) {
      input.attachedInputIds = options.attachedInputIds;
    }
    this.updateStoreWithState();
  }

  public reorderInputs(inputOrder: string[]) {
    const inputIdSet = new Set(this.inputs.map(input => input.inputId));
    const inputs: RoomInputState[] = [];
    for (const inputId of inputOrder) {
      const input = this.inputs.find(input => input.inputId === inputId);
      if (input) {
        inputs.push(input);
        inputIdSet.delete(inputId);
      }
    }
    for (const inputId of inputIdSet) {
      const input = this.inputs.find(input => input.inputId === inputId);
      if (input) {
        inputs.push(input);
      }
    }

    this.inputs = inputs;
    this.updateStoreWithState();
  }

  public async updateLayout(layout: Layout) {
    this.layout = layout;
    // When switching to wrapped layout, remove wrapped-static image inputs and add wrapped MP4s
    if (layout === 'wrapped') {
      await this.removeWrappedStaticInputs();
      void this.ensureWrappedMp4Inputs();
    }
    // When switching to wrapped-static layout, remove wrapped MP4 inputs and add wrapped images
    if (layout === 'wrapped-static') {
      await this.removeWrappedMp4Inputs();
      await this.ensureWrappedImageInputs();
    }
    this.updateStoreWithState();
  }

  public async deleteRoom() {
    const inputs = this.inputs;
    this.inputs = [];
    for (const input of inputs) {
      if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
        input.monitor.stop();
      }
      try {
        await SmelterInstance.unregisterInput(input.inputId);
      } catch (err: any) {
        console.error('Failed to remove input when removing the room.', err?.body ?? err);
      }
    }

    try {
      await SmelterInstance.unregisterOutput(this.output.id);
    } catch (err: any) {
      console.error('Failed to remove output', err?.body ?? err);
    }

    if (this.recording && !this.recording.stoppedAt) {
      try {
        await SmelterInstance.unregisterOutput(this.recording.outputId);
      } catch (err: any) {
        console.error('Failed to remove recording output', err?.body ?? err);
      }
    }
  }

  private updateStoreWithState() {
    const toInputConfig = (input: RoomInputState): InputConfig => ({
      inputId: input.inputId,
      title: input.metadata.title,
      description: input.metadata.description,
      showTitle: input.showTitle,
      volume: input.volume,
      shaders: input.shaders,
      orientation: input.orientation,
      borderColor: input.borderColor,
      borderWidth: input.borderWidth,
      imageId: input.type === 'image' ? input.imageId : undefined,
      text: input.type === 'text-input' ? input.text : undefined,
      textAlign: input.type === 'text-input' ? input.textAlign : undefined,
      textColor: input.type === 'text-input' ? input.textColor : undefined,
      textMaxLines: input.type === 'text-input' ? input.textMaxLines : undefined,
      textScrollSpeed: input.type === 'text-input' ? input.textScrollSpeed : undefined,
      textScrollLoop: input.type === 'text-input' ? input.textScrollLoop : undefined,
      textScrollNudge: input.type === 'text-input' ? input.textScrollNudge : undefined,
      textFontSize: input.type === 'text-input' ? input.textFontSize : undefined,
      gameState: input.type === 'game' ? input.gameState : undefined,
      snakeEventShaders: input.type === 'game' ? input.snakeEventShaders : undefined,
      snake1Shaders: input.type === 'game' ? input.snake1Shaders : undefined,
      snake2Shaders: input.type === 'game' ? input.snake2Shaders : undefined,
    });

    const connectedInputs = this.inputs.filter(input => input.status === 'connected' && !input.hidden);
    const connectedMap = new Map<string, RoomInputState>();
    for (const input of connectedInputs) {
      connectedMap.set(input.inputId, input);
    }

    const attachedIds = new Set<string>();
    for (const input of connectedInputs) {
      if (input.attachedInputIds) {
        for (const id of input.attachedInputIds) {
          attachedIds.add(id);
        }
      }
    }

    const inputs: InputConfig[] = connectedInputs
      .filter(input => !attachedIds.has(input.inputId))
      .map(input => {
        const config = toInputConfig(input);
        if (input.attachedInputIds && input.attachedInputIds.length > 0) {
          config.attachedInputs = input.attachedInputIds
            .map(id => connectedMap.get(id))
            .filter((i): i is RoomInputState => !!i)
            .map(toInputConfig);
        }
        return config;
      });

    this.output.store.getState().updateState(inputs, this.layout, this.swapDurationMs, this.swapOutgoingEnabled, this.swapFadeInDurationMs, this.newsStripFadeDuringSwap, this.swapFadeOutDurationMs, this.newsStripEnabled);
  }

  public hideInput(inputId: string) {
    const input = this.getInput(inputId);
    input.hidden = true;
    this.updateStoreWithState();
  }

  public showInput(inputId: string) {
    const input = this.getInput(inputId);
    input.hidden = false;
    this.updateStoreWithState();
  }

  public updateGameState(inputId: string, gameState: { board: { width: number; height: number; cellSize: number; cellGap?: number }; cells: { x: number; y: number; color: string; size?: number; isHead?: boolean; direction?: 'up' | 'down' | 'left' | 'right'; progress?: number }[]; smoothMove?: boolean; smoothMoveSpeed?: number; backgroundColor: string; gameOverData?: { winnerName: string; reason: string; players: { name: string; score: number; eaten: number; cuts: number; color: string }[] } }) {
    const input = this.getInput(inputId);
    if (input.type !== 'game') {
      throw new Error(`Input ${inputId} is not a game input`);
    }
    input.gameState = {
      boardWidth: gameState.board.width,
      boardHeight: gameState.board.height,
      cellSize: gameState.board.cellSize,
      cells: gameState.cells,
      smoothMove: gameState.smoothMove === true,
      smoothMoveSpeed:
        typeof gameState.smoothMoveSpeed === 'number' &&
        Number.isFinite(gameState.smoothMoveSpeed) &&
        gameState.smoothMoveSpeed > 0
          ? gameState.smoothMoveSpeed
          : 1,
      backgroundColor: input.gameState.backgroundColor || gameState.backgroundColor,
      cellGap: input.gameState.cellGap || gameState.board.cellGap || 0,
      boardBorderColor: input.gameState.boardBorderColor ?? '#ffffff',
      boardBorderWidth: input.gameState.boardBorderWidth ?? 4,
      gridLineColor: input.gameState.gridLineColor ?? '#000000',
      gridLineAlpha: input.gameState.gridLineAlpha ?? 1.0,
      gameOverData: gameState.gameOverData,
    };
    console.log(`[game] Updated snake board: ${gameState.cells.length} cells on ${gameState.board.width}x${gameState.board.height}`);
    this.updateStoreWithState();
  }

  public ingestGameEvents(inputId: string, events: { type: SnakeEventType }[]) {
    const input = this.getInput(inputId);
    if (input.type !== 'game') return;
    if (!events || events.length === 0) return;

    const config = input.snakeEventShaders;
    if (!config) return;

    const now = Date.now();

    for (const event of events) {
      const mapping = config[event.type];
      if (!mapping || !mapping.enabled) continue;

      const effectDurationMs = mapping.effectDurationMs || 600;

      let affectedCellIndices: number[] = [];
      const cells = input.gameState.cells;
      const totalCells = cells.length;

      // Build snake cell indices (cells belonging to a snake, identified by sharing color with a head)
      const snakeColorsSet = new Set<string>();
      for (const cell of cells) {
        if (cell.isHead) snakeColorsSet.add(cell.color);
      }
      const snakeCellIndices = cells
        .map((cell, i) => (cell.isHead || snakeColorsSet.has(cell.color)) ? i : -1)
        .filter(i => i !== -1);

      if (mapping.application.mode === 'all') {
        affectedCellIndices = Array.from({ length: totalCells }, (_, i) => i);
      } else if (mapping.application.mode === 'snake_cells') {
        affectedCellIndices = snakeCellIndices;
      } else if (mapping.application.mode === 'first_n') {
        const n = Math.min(mapping.application.n, snakeCellIndices.length);
        affectedCellIndices = snakeCellIndices.slice(0, n);
      } else if (mapping.application.mode === 'sequential') {
        affectedCellIndices = snakeCellIndices.length > 0 ? [snakeCellIndices[0]] : [];
      }

      const effect: ActiveSnakeEffect = {
        eventType: event.type,
        shaderId: mapping.shaderId,
        params: mapping.params,
        affectedCellIndices,
        startedAtMs: now,
        endsAtMs: now + effectDurationMs,
      };

      // Remove any existing effect of the same type
      input.activeEffects = input.activeEffects.filter(e => e.eventType !== event.type);
      input.activeEffects.push(effect);

      // Set cleanup timer
      const cleanupTimer = setTimeout(() => {
        input.activeEffects = input.activeEffects.filter(e => e !== effect);
        input.gameState.activeEffects = input.activeEffects.length > 0 ? [...input.activeEffects] : undefined;
        this.updateStoreWithState();
      }, effectDurationMs);
      input.effectTimers.push(cleanupTimer);

      // For sequential mode, set up progression timers through snake cells
      if (mapping.application.mode === 'sequential') {
        const { durationMs, delayMs } = mapping.application;
        const stepMs = durationMs + delayMs;
        for (let i = 1; i < snakeCellIndices.length; i++) {
          const timer = setTimeout(() => {
            if (input.activeEffects.includes(effect)) {
              effect.affectedCellIndices = [snakeCellIndices[i]];
              input.gameState.activeEffects = [...input.activeEffects];
              this.updateStoreWithState();
            }
          }, stepMs * i);
          input.effectTimers.push(timer);
        }
      }
    }

    // Update game state with active effects
    input.gameState.activeEffects = input.activeEffects.length > 0 ? [...input.activeEffects] : undefined;
    this.updateStoreWithState();
  }

  private getInput(inputId: string): RoomInputState {
    const input = this.inputs.find(input => input.inputId === inputId);
    if (!input) {
      throw new Error(`Input ${inputId} not found`);
    }
    return input;
  }
  // Remove all wrapped-static image inputs
  private async removeWrappedStaticInputs(): Promise<void> {
    const inputsToRemove = this.inputs.filter(
      input => input.type === 'image' && input.imageId?.startsWith('wrapped::')
    );
    for (const input of inputsToRemove) {
      await this.removeInput(input.inputId);
    }
  }

  // Remove all wrapped MP4 inputs
  private async removeWrappedMp4Inputs(): Promise<void> {
    const inputsToRemove = this.inputs.filter(
      input => input.type === 'local-mp4' && input.inputId.includes('::local::wrapped::')
    );
    for (const input of inputsToRemove) {
      await this.removeInput(input.inputId);
    }
  }

  // Add every MP4 from wrapped/ as an input (if not present).
  private async ensureWrappedMp4Inputs(): Promise<void> {
    const wrappedDir = path.join(process.cwd(), 'wrapped');
    let entries: string[] = [];
    try {
      entries = await readdir(wrappedDir);
    } catch {
      return;
    }
    // Keep deterministic order
    entries.sort((a, b) => a.localeCompare(b, 'en'));
    const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));

    // Remove placeholder if we're adding inputs
    if (mp4s.length > 0) {
      await this.removePlaceholder();
    }

    for (const fileName of mp4s) {
      const absPath = path.join(wrappedDir, fileName);
      const baseName = fileName.replace(/\.mp4$/i, '');
      const inputId = `${this.idPrefix}::local::wrapped::${baseName}`;
      if (this.inputs.find(inp => inp.inputId === inputId)) {
        continue;
      }
      this.inputs.push({
        inputId,
        type: 'local-mp4',
        status: 'disconnected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        metadata: {
          title: `[MP4] ${formatMp4Name(fileName)}`,
          description: '[Wrapped MP4]',
        },
        mp4FilePath: absPath,
        volume: 0,
      });
      // Connect the input
      void this.connectInput(inputId);
    }
  }

  // Add every image from wrapped/ as an input (if not present). Registers images on the fly.
  private async ensureWrappedImageInputs(): Promise<void> {
    const wrappedDir = path.join(process.cwd(), 'wrapped');
    let entries: string[] = [];
    try {
      entries = await readdir(wrappedDir);
    } catch {
      return;
    }
    // Keep deterministic order
    entries.sort((a, b) => a.localeCompare(b, 'en'));
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
    const images = entries.filter(e => exts.some(ext => e.toLowerCase().endsWith(ext)));

    // Remove placeholder if we're adding inputs
    if (images.length > 0) {
      await this.removePlaceholder();
    }

    for (const fileName of images) {
      const lower = fileName.toLowerCase();
      const ext = exts.find(x => lower.endsWith(x))!;
      const absPath = path.join(wrappedDir, fileName);
      const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
      const imageId = `wrapped::${baseName}`;
      const inputId = `${this.idPrefix}::image::${baseName}`;
      // register image resource
      const assetType =
        ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';
      try {
        await SmelterInstance.registerImage(imageId, {
          serverPath: absPath,
          assetType: assetType as any,
        });
      } catch {
        // ignore if already registered
      }
      if (this.inputs.find(inp => inp.inputId === inputId)) {
        continue;
      }
      this.inputs.push({
        inputId,
        type: 'image',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        metadata: {
          title: formatImageName(fileName),
          description: '',
        },
        volume: 0,
        imageId,
      });
    }
  }
}

function registerOptionsFromInput(input: RoomInputState): RegisterSmelterInputOptions {
  if (input.type === 'local-mp4') {
    return { type: 'mp4', filePath: input.mp4FilePath };
  } else if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
    return { type: 'hls', url: input.hlsUrl };
  } else if (input.type === 'whip') {
    return { type: 'whip', url: input.whipUrl };
  } else if (input.type === 'image') {
    // Images are static resources, they don't need to be registered as inputs
    // They are already registered via registerImage and used directly in layouts
    throw Error('Images cannot be connected as stream inputs');
  } else if (input.type === 'game') {
    throw Error('Game inputs do not need stream registration');
  } else {
    throw Error('Unknown type');
  }
}

function inputIdForTwitchInput(idPrefix: string, twitchChannelId: string): string {
  return `${idPrefix}::twitch::${twitchChannelId}`;
}

function inputIdForKickInput(idPrefix: string, kickChannelId: string): string {
  return `${idPrefix}::kick::${kickChannelId}`;
}

function formatMp4Name(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.mp4$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatImageName(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isBlockedDefaultMp4(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.startsWith('logo_') || lower.startsWith('wrapped_');
}

/**
 * Keep at most `maxCount` newest MP4 recording files in the global
 * recordings directory by deleting the oldest ones.
 */
async function pruneOldRecordings(maxCount: number): Promise<void> {
  const recordingsDir = path.join(process.cwd(), 'recordings');
  if (!(await pathExists(recordingsDir))) {
    return;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(recordingsDir);
  } catch {
    // If we can't read the directory, silently skip pruning.
    return;
  }

  const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));
  if (mp4s.length <= maxCount) {
    return;
  }

  type RecordingFile = { name: string; timestamp: number };
  const parsed: RecordingFile[] = [];

  for (const file of mp4s) {
    // Expected pattern: recording-<safeRoomId>-<timestamp>.mp4
    const match = file.match(/^recording-.*-(\d+)\.mp4$/);
    const ts = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(ts)) {
      // Fallback: treat unknown pattern as very old so it gets pruned first.
      parsed.push({ name: file, timestamp: 0 });
    } else {
      parsed.push({ name: file, timestamp: ts });
    }
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);

  const toDelete = parsed.slice(0, Math.max(0, parsed.length - maxCount));
  for (const file of toDelete) {
    const fullPath = path.join(recordingsDir, file.name);
    try {
      await remove(fullPath);
    } catch (err) {
      // Ignore individual deletion errors – best-effort cleanup.
      console.warn('Failed to remove old recording file', { file: fullPath, err });
    }
  }
}
