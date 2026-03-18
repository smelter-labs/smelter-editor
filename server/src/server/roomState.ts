import { ensureDir, pathExists, readdir, remove } from 'fs-extra';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import {
  SmelterInstance,
  type RegisterSmelterInputOptions,
  type SmelterOutput,
} from '../smelter';
import { hlsUrlForKickChannel, hlsUrlForTwitchChannel } from '../streamlink';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import { sleep } from '../utils';
import type {
  SnakeGameState,
  SnakeEventShaderConfig,
  ActiveSnakeEffect,
  SnakeEventType,
} from '../snakeGame/types';
import type { InputConfig } from '../app/store';
import type {
  Layout,
  ShaderConfig,
  StreamMonitor,
  WhipMonitor,
  ActiveTransition,
} from '../types';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import { getMp4DurationMs } from './mp4Duration';
import {
  createDefaultSnakeGameInputState,
  DEFAULT_SNAKE_EVENT_SHADERS,
  buildUpdatedSnakeGameState,
  processSnakeGameEvents,
} from '../snakeGame/snakeGameState';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';
import type { RoomNameEntry } from './roomNames';
import { MotionManager } from '../motion/MotionManager';
import {
  TimelinePlayer,
  type TimelineListener,
  type TimelineRoomStateAdapter,
} from '../timeline/TimelinePlayer';
import type { TimelineConfig } from '../timeline/types';

const RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS = 5500;

export type InputOrientation = 'horizontal' | 'vertical';

export type RoomInputState = {
  inputId: string;
  type:
    | 'local-mp4'
    | 'twitch-channel'
    | 'kick-channel'
    | 'whip'
    | 'image'
    | 'text-input'
    | 'game';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  borderColor: string;
  borderWidth: number;
  hidden: boolean;
  attachedInputIds?: string[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
  motionScore?: number;
  motionEnabled: boolean;
  metadata: {
    title: string;
    description: string;
  };
} & TypeSpecificState;

type TypeSpecificState =
  | {
      type: 'local-mp4';
      mp4FilePath: string;
      registeredAtPipelineMs?: number;
      playFromMs?: number;
      mp4DurationMs?: number;
    }
  | {
      type: 'twitch-channel';
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(
          fn: (streamInfo: TwitchStreamInfo, isLive: boolean) => void,
        ): void;
      };
    }
  | {
      type: 'kick-channel';
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(fn: (streamInfo: any, isLive: boolean) => void): void;
      };
    }
  | { type: 'whip'; whipUrl: string; monitor: WhipMonitor }
  | { type: 'image'; imageId: string }
  | {
      type: 'text-input';
      text: string;
      textAlign: 'left' | 'center' | 'right';
      textColor: string;
      textMaxLines: number;
      textScrollSpeed: number;
      textScrollLoop: boolean;
      textScrollNudge: number;
      textFontSize: number;
    }
  | {
      type: 'game';
      snakeGameState: SnakeGameState;
      snakeEventShaders?: SnakeEventShaderConfig;
      snake1Shaders?: ShaderConfig[];
      snake2Shaders?: ShaderConfig[];
      activeEffects: ActiveSnakeEffect[];
      effectTimers: NodeJS.Timeout[];
    };

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
  absolutePosition: boolean;
  absoluteTop: number;
  absoluteLeft: number;
  absoluteWidth: number;
  absoluteHeight: number;
  absoluteTransitionDurationMs: number;
  absoluteTransitionEasing: string;
  activeTransition: {
    type: string;
    durationMs: number;
    direction: 'in' | 'out';
  };
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

const DEFAULT_LOGO_SHADERS: ShaderConfig[] = [
  {
    shaderName: 'Remove Color',
    shaderId: 'remove-color',
    enabled: true,
    params: [
      { paramName: 'target_color', paramValue: '#1c1c35' },
      { paramName: 'tolerance', paramValue: 0.2 },
    ],
  },
];

function cloneDefaultLogoShaders(): ShaderConfig[] {
  return DEFAULT_LOGO_SHADERS.map((shader) => ({
    ...shader,
    params: shader.params.map((param) => ({ ...param })),
  }));
}

export class RoomState {
  private readonly mutex = new Mutex();
  private inputs: RoomInputState[];
  private destroyed = false;
  private transitionTimers: Map<string, NodeJS.Timeout> = new Map();
  private motionManager: MotionManager;
  private motionScoreListeners: Set<(scores: Record<string, number>) => void> =
    new Set();
  private timelinePlayer: TimelinePlayer | null = null;
  private timelineListeners = new Set<TimelineListener>();
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
  private readonly initInputs: RegisterInputOptions[];
  private readonly skipDefaultInputs: boolean;

  public constructor(
    idPrefix: string,
    output: SmelterOutput,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false,
    roomName?: RoomNameEntry,
  ) {
    this.mp4sDir = path.join(process.cwd(), 'mp4s');
    this.mp4Files = mp4SuggestionsMonitor.mp4Files;
    this.inputs = [];
    this.idPrefix = idPrefix;
    this.motionManager = new MotionManager(idPrefix);
    this.output = output;
    this.roomName = roomName ?? {
      pl: `Pokój ${idPrefix.slice(0, 6)}`,
      en: `Room ${idPrefix.slice(0, 6)}`,
    };
    this.initInputs = initInputs;
    this.skipDefaultInputs = skipDefaultInputs;

    this.lastReadTimestamp = Date.now();
    this.creationTimestamp = Date.now();
  }

  public async init(): Promise<void> {
    await this.getInitialInputState(
      this.idPrefix,
      this.initInputs,
      this.skipDefaultInputs,
    );
    for (let i = 0; i < this.inputs.length; i++) {
      const maybeInput = this.inputs[i];
      if (maybeInput) {
        await this._connectInput(maybeInput.inputId);
      }
    }
  }

  private async getInitialInputState(
    idPrefix: string,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false,
  ): Promise<void> {
    if (initInputs.length > 0) {
      for (const input of initInputs) {
        await this._addNewInput(input);
      }
    } else if (!skipDefaultInputs) {
      const preferredMp4 =
        this.mp4Files.find((f) => f.toLowerCase().startsWith('eclipse')) ??
        this.mp4Files.find((file) => !isBlockedDefaultMp4(file));
      if (preferredMp4) {
        await this._addNewInput({
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
        const logoInputId = await this._addNewInput({
          type: 'image',
          fileName: PLACEHOLDER_LOGO_FILE,
        });
        const logoInput = this.inputs.find(
          (inp) => inp.inputId === logoInputId,
        );
        if (logoInput) {
          logoInput.shaders = cloneDefaultLogoShaders();
          this.updateStoreWithState();
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
    return this.mutex.runExclusive(async () => {
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

      await SmelterInstance.registerMp4Output(
        recordingId,
        this.output,
        filePath,
      );

      this.recording = {
        outputId: recordingId,
        filePath,
        fileName,
        startedAt: timestamp,
      };

      return { fileName };
    });
  }

  public async stopRecording(): Promise<{ fileName: string }> {
    return this.mutex.runExclusive(async () => {
      if (!this.recording || this.recording.stoppedAt) {
        throw new Error('No active recording to stop for this room');
      }

      try {
        await SmelterInstance.unregisterOutput(this.recording.outputId);
      } finally {
        this.recording.stoppedAt = Date.now();
      }

      try {
        await pruneOldRecordings(10);
      } catch (err) {
        console.error('Failed to prune old recordings', err);
      }

      return { fileName: this.recording.fileName };
    });
  }

  private frozenImages: Map<string, { imageId: string; jpegPath: string }> =
    new Map();
  private frozenImageCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  public isFrozen(): boolean {
    return this.timelinePlayer?.getIsPaused() === true;
  }

  public getState(): [
    RoomInputState[],
    Layout,
    number,
    boolean,
    number,
    boolean,
    number,
    boolean,
  ] {
    this.lastReadTimestamp = Date.now();
    return [
      this.inputs,
      this.layout,
      this.swapDurationMs,
      this.swapOutgoingEnabled,
      this.swapFadeInDurationMs,
      this.newsStripFadeDuringSwap,
      this.swapFadeOutDurationMs,
      this.newsStripEnabled,
    ];
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
    const nonPlaceholderInputs = this.inputs.filter(
      (inp) => !this.isPlaceholder(inp.inputId),
    );
    if (nonPlaceholderInputs.length > 0) {
      return; // Don't add placeholder if there are real inputs
    }

    // Check if placeholder already exists
    if (this.inputs.find((inp) => this.isPlaceholder(inp.inputId))) {
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
        shaders: cloneDefaultLogoShaders(),
        orientation: 'horizontal',
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        motionEnabled: false,
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
    const placeholder = this.inputs.find((inp) =>
      this.isPlaceholder(inp.inputId),
    );
    if (placeholder) {
      this.inputs = this.inputs.filter(
        (inp) => !this.isPlaceholder(inp.inputId),
      );
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
      motionEnabled: false,
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
      inputState = { ...baseState, type: 'kick-channel', monitor: kickMonitor };
    }
    monitor.onUpdate((streamInfo: TwitchStreamInfo, _isLive: boolean) => {
      inputState.metadata.title =
        platform === 'twitch-channel'
          ? `[Twitch.tv/${streamInfo.category}] ${streamInfo.displayName}`
          : `[Kick.com] ${streamInfo.displayName}`;
      inputState.metadata.description = streamInfo.title;
      this.updateStoreWithState();
    });
    this.inputs.push(inputState);
    return inputId;
  }

  public async addNewInput(opts: RegisterInputOptions) {
    return this.mutex.runExclusive(() => this._addNewInput(opts));
  }

  private async _addNewInput(opts: RegisterInputOptions) {
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
          'local-mp4 requires source.fileName. Only URL is not supported; provide a file name from the mp4s directory.',
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
        motionEnabled: false,
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
        if (!ext) {
          throw new Error(`Unsupported image format: ${fileName}`);
        }
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
          motionEnabled: false,
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
        borderWidth: 0,
        hidden: false,
        motionEnabled: false,
        metadata: {
          title: 'Text',
          description: '',
        },
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
      this.updateStoreWithState();

      return inputId;
    } else if (opts.type === 'game') {
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
        borderColor: '#ff0000',
        borderWidth: 0,
        hidden: false,
        motionEnabled: false,
        volume: 0,
        ...defaults,
      });
      this.updateStoreWithState();
      return inputId;
    }
  }

  public async removeInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(() => this._removeInput(inputId));
  }

  private async _removeInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);

    // Check if this is the last non-placeholder input
    const nonPlaceholderInputs = this.inputs.filter(
      (inp) => !this.isPlaceholder(inp.inputId),
    );
    const willBeEmpty =
      nonPlaceholderInputs.length === 1 &&
      nonPlaceholderInputs[0].inputId === inputId;

    // If removing the last input, add placeholder first
    if (willBeEmpty) {
      await this.ensurePlaceholder();
    }

    this.inputs = this.inputs.filter((input) => input.inputId !== inputId);
    for (const other of this.inputs) {
      if (other.attachedInputIds) {
        other.attachedInputIds = other.attachedInputIds.filter(
          (id) => id !== inputId,
        );
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
        console.warn(
          `[roomState] Timed out waiting for pending input ${inputId}, forcing disconnected`,
        );
        input.status = 'disconnected';
        break;
      }
      await sleep(500);
    }
    if (input.status === 'connected') {
      await this.motionManager.stopMotionDetection(inputId);
      try {
        await SmelterInstance.unregisterInput(inputId);
      } catch (err: any) {
        console.log(err, 'Failed to unregister when removing input.');
      }
      input.status = 'disconnected';
    }
  }

  public async connectInput(inputId: string): Promise<string> {
    return this.mutex.runExclusive(() => this._connectInput(inputId));
  }

  private async _connectInput(inputId: string): Promise<string> {
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
      this.updateStoreWithState();
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
    // Start motion detection for video inputs
    if (
      input.motionEnabled &&
      ['local-mp4', 'twitch-channel', 'kick-channel', 'whip'].includes(
        input.type,
      )
    ) {
      this.motionManager
        .startMotionDetection(inputId, (score) => {
          if (score === -1) {
            input.motionScore = undefined;
          } else {
            input.motionScore = score;
          }
          this.emitMotionScores();
        })
        .catch((err) =>
          console.error(`[motion] Failed to start for ${inputId}`, err),
        );
    }
    this.updateStoreWithState();
    return response;
  }

  public async ackWhipInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.getInput(inputId);
      if (input.type !== 'whip') {
        throw new Error('Input is not a Whip input');
      }
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
    });
  }

  public async restartMp4Input(
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.getInput(inputId);
      if (input.type !== 'local-mp4') {
        throw new Error(`Input ${inputId} is not a local-mp4 input`);
      }
      if (input.status !== 'connected') {
        throw new Error(`Input ${inputId} is not connected`);
      }

      const pipelineMs = SmelterInstance.getPipelineTimeMs();
      console.log(
        `[mp4-restart] BEGIN inputId=${inputId} playFromMs=${playFromMs} loop=${loop} pipelineMs=${pipelineMs} status=${input.status} hidden=${input.hidden}`,
      );
      const t0 = Date.now();

      input.restartFading = true;
      this.updateStoreWithState();
      await sleep(150);

      try {
        console.log(`[mp4-restart] unregisterInput inputId=${inputId}`);
        await SmelterInstance.unregisterInput(inputId);
        console.log(
          `[mp4-restart] unregisterInput OK inputId=${inputId} elapsed=${Date.now() - t0}ms`,
        );

        const offsetMs = SmelterInstance.getPipelineTimeMs() - playFromMs;
        console.log(
          `[mp4-restart] registerInput inputId=${inputId} filePath=${input.mp4FilePath} loop=${loop} offsetMs=${offsetMs}`,
        );
        await SmelterInstance.registerInput(inputId, {
          type: 'mp4',
          filePath: input.mp4FilePath,
          loop,
          offsetMs,
        });
        console.log(
          `[mp4-restart] registerInput OK inputId=${inputId} elapsed=${Date.now() - t0}ms`,
        );

        input.registeredAtPipelineMs = SmelterInstance.getPipelineTimeMs();
        if (loop && input.mp4DurationMs && input.mp4DurationMs > 0) {
          input.playFromMs = playFromMs % input.mp4DurationMs;
        } else {
          input.playFromMs = playFromMs;
        }
      } catch (err) {
        console.error(
          `[mp4-restart] FAILED inputId=${inputId} elapsed=${Date.now() - t0}ms status=${input.status}`,
          err,
        );
        throw err;
      } finally {
        input.restartFading = false;
        this.updateStoreWithState();
        console.log(
          `[mp4-restart] END inputId=${inputId} elapsed=${Date.now() - t0}ms restartFading=${input.restartFading} status=${input.status} hidden=${input.hidden}`,
        );
      }
    });
  }

  public async disconnectInput(inputId: string) {
    return this.mutex.runExclusive(async () => {
      const input = this.getInput(inputId);
      if (input.status === 'disconnected') {
        return;
      }
      await this.motionManager.stopMotionDetection(inputId);
      input.status = 'pending';
      this.updateStoreWithState();
      try {
        await SmelterInstance.unregisterInput(inputId);
      } finally {
        input.status = 'disconnected';
        this.updateStoreWithState();
      }
    });
  }

  public async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
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
              await this._removeInput(input.inputId);
            } catch (err: any) {
              console.log(err, 'Failed to remove stale WHIP input');
            }
          }
        }
      }
    });
  }

  public async updateInput(
    inputId: string,
    options: Partial<UpdateInputOptions>,
  ) {
    return this.mutex.runExclusive(async () => {
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
          input.snakeGameState.backgroundColor = options.gameBackgroundColor;
        }
        if (options.gameCellGap !== undefined) {
          input.snakeGameState.cellGap = options.gameCellGap;
        }
        if (options.gameBoardBorderColor !== undefined) {
          input.snakeGameState.boardBorderColor = options.gameBoardBorderColor;
        }
        if (options.gameBoardBorderWidth !== undefined) {
          input.snakeGameState.boardBorderWidth = options.gameBoardBorderWidth;
        }
        if (options.gameGridLineColor !== undefined) {
          input.snakeGameState.gridLineColor = options.gameGridLineColor;
        }
        if (options.gameGridLineAlpha !== undefined) {
          input.snakeGameState.gridLineAlpha = options.gameGridLineAlpha;
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
      if (options.absolutePosition !== undefined) {
        input.absolutePosition = options.absolutePosition;
      }
      if (options.absoluteTop !== undefined) {
        input.absoluteTop = options.absoluteTop;
      }
      if (options.absoluteLeft !== undefined) {
        input.absoluteLeft = options.absoluteLeft;
      }
      if (options.absoluteWidth !== undefined) {
        input.absoluteWidth = options.absoluteWidth;
      }
      if (options.absoluteHeight !== undefined) {
        input.absoluteHeight = options.absoluteHeight;
      }
      if (options.absoluteTransitionDurationMs !== undefined) {
        input.absoluteTransitionDurationMs =
          options.absoluteTransitionDurationMs;
      }
      if (options.absoluteTransitionEasing !== undefined) {
        input.absoluteTransitionEasing = options.absoluteTransitionEasing;
      }
      if (options.activeTransition !== undefined) {
        // Cancel any existing auto-clear timer for this input
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

        // Auto-clear after duration
        const timer = setTimeout(() => {
          input.activeTransition = undefined;
          this.transitionTimers.delete(inputId);
          this.updateStoreWithState();
        }, durationMs);
        this.transitionTimers.set(inputId, timer);
      }
      this.updateStoreWithState();
    });
  }

  public reorderInputs(inputOrder: string[]) {
    return this.mutex.runExclusive(() => {
      const inputIdSet = new Set(this.inputs.map((input) => input.inputId));
      const inputs: RoomInputState[] = [];
      for (const inputId of inputOrder) {
        const input = this.inputs.find((input) => input.inputId === inputId);
        if (input) {
          inputs.push(input);
          inputIdSet.delete(inputId);
        }
      }
      for (const inputId of inputIdSet) {
        const input = this.inputs.find((input) => input.inputId === inputId);
        if (input) {
          inputs.push(input);
        }
      }

      this.inputs = inputs;
      this.updateStoreWithState();
    });
  }

  public async updateLayout(layout: Layout) {
    return this.mutex.runExclusive(async () => {
      this.layout = layout;
      this.updateStoreWithState();
    });
  }

  // ── Timeline playback ─────────────────────────────────────

  private buildTimelineAdapter(): TimelineRoomStateAdapter {
    return {
      getInputs: () => this.getInputs(),
      showInput: (inputId, transition) => this.showInput(inputId, transition),
      hideInput: (inputId, transition) => this.hideInput(inputId, transition),
      updateInput: (inputId, options) => this.updateInput(inputId, options),
      restartMp4Input: (inputId, playFromMs, loop) =>
        this.restartMp4Input(inputId, playFromMs, loop),
      reorderInputs: (order) => this.reorderInputs(order),
    };
  }

  public async startTimelinePlayback(
    config: TimelineConfig,
    fromMs?: number,
  ): Promise<void> {
    if (this.timelinePlayer?.getIsPaused()) {
      await this.cleanupFrozenImages();
      this.timelinePlayer.updateConfig(config);
      await this.timelinePlayer.resume(fromMs);
      return;
    }

    if (this.timelinePlayer) {
      this.timelinePlayer.destroy();
    }

    const adapter = this.buildTimelineAdapter();
    this.timelinePlayer = new TimelinePlayer(adapter, config);

    const forwardListener: TimelineListener = (data) => {
      for (const listener of this.timelineListeners) {
        listener(data);
      }
    };
    this.timelinePlayer.addListener(forwardListener);

    await this.timelinePlayer.start(fromMs);
  }

  public async applyTimelineState(
    config: TimelineConfig,
    playheadMs: number,
  ): Promise<void> {
    if (this.timelinePlayer) {
      this.timelinePlayer.destroy();
    }

    const adapter = this.buildTimelineAdapter();
    this.timelinePlayer = new TimelinePlayer(adapter, config);

    const forwardListener: TimelineListener = (data) => {
      for (const listener of this.timelineListeners) {
        listener(data);
      }
    };
    this.timelinePlayer.addListener(forwardListener);

    const activeClips =
      await this.timelinePlayer.applyStaticSnapshot(playheadMs);

    await this.cleanupFrozenImages();

    for (const [inputId, clip] of activeClips) {
      const input = this.inputs.find((i) => i.inputId === inputId);
      if (!input || input.type !== 'local-mp4') continue;

      const basePlayFrom = clip.blockSettings.mp4PlayFromMs ?? 0;
      let framePositionMs = basePlayFrom + (playheadMs - clip.startMs);

      const isLooped = clip.blockSettings.mp4Loop !== false;
      if (isLooped && input.mp4DurationMs && input.mp4DurationMs > 0) {
        framePositionMs = framePositionMs % input.mp4DurationMs;
      }

      try {
        const jpegPath = await SmelterInstance.extractMp4Frame(
          input.mp4FilePath,
          framePositionMs,
        );
        const frozenId = `frozen::${this.idPrefix}::${inputId}::${Date.now()}`;
        await SmelterInstance.registerImage(frozenId, {
          serverPath: jpegPath,
          assetType: 'jpeg',
        });

        await this.setFrozenImage(inputId, frozenId, jpegPath);
      } catch (err) {
        console.error(
          `[timeline] Failed to extract frame for ${inputId} at scrub position`,
          err,
        );
      }
    }
  }

  public async stopTimelinePlayback(): Promise<void> {
    if (!this.timelinePlayer) return;
    await this.cleanupFrozenImages();
    await this.timelinePlayer.stop();
    this.timelinePlayer.destroy();
    this.timelinePlayer = null;
  }

  public async pauseTimeline(): Promise<{
    playheadMs: number;
    isPaused: true;
  }> {
    if (!this.timelinePlayer || !this.timelinePlayer.isPlaying()) {
      throw new Error('No timeline playback in progress');
    }

    const { playheadMs, activeClips } = this.timelinePlayer.pause();
    const currentPipelineMs = SmelterInstance.getPipelineTimeMs();

    for (const [inputId, clip] of activeClips) {
      const input = this.inputs.find((i) => i.inputId === inputId);
      if (!input || input.type !== 'local-mp4') continue;

      let framePositionMs =
        (input.playFromMs ?? 0) +
        (currentPipelineMs -
          (input.registeredAtPipelineMs ?? currentPipelineMs));

      const isLooped = clip.blockSettings.mp4Loop !== false;
      if (isLooped && input.mp4DurationMs && input.mp4DurationMs > 0) {
        framePositionMs = framePositionMs % input.mp4DurationMs;
      }

      try {
        const jpegPath = await SmelterInstance.extractMp4Frame(
          input.mp4FilePath,
          framePositionMs,
        );
        const frozenId = `frozen::${this.idPrefix}::${inputId}::${Date.now()}`;
        await SmelterInstance.registerImage(frozenId, {
          serverPath: jpegPath,
          assetType: 'jpeg',
        });

        await this.setFrozenImage(inputId, frozenId, jpegPath);
      } catch (err) {
        console.error(`[timeline] Failed to extract frame for ${inputId}`, err);
      }
    }

    return { playheadMs, isPaused: true };
  }

  public async resumeTimeline(fromMs?: number): Promise<void> {
    if (!this.timelinePlayer?.getIsPaused()) {
      throw new Error('Timeline is not paused');
    }

    const resumeMs = fromMs ?? this.timelinePlayer.getPlayheadMs();
    const activeFrozenInputIds = new Set(
      this.timelinePlayer
        .getActiveInputIdsAt(resumeMs)
        .filter((inputId) => this.frozenImages.has(inputId)),
    );

    await this.timelinePlayer.resume(fromMs);

    const inactiveFrozenInputIds = [...this.frozenImages.keys()].filter(
      (inputId) => !activeFrozenInputIds.has(inputId),
    );
    await this.cleanupFrozenImages(inactiveFrozenInputIds);

    for (const inputId of activeFrozenInputIds) {
      this.scheduleFrozenImageCleanup(inputId);
    }
  }

  private clearFrozenImageCleanupTimer(inputId: string): void {
    const timer = this.frozenImageCleanupTimers.get(inputId);
    if (!timer) return;
    clearTimeout(timer);
    this.frozenImageCleanupTimers.delete(inputId);
  }

  private clearAllFrozenImageCleanupTimers(): void {
    for (const timer of this.frozenImageCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.frozenImageCleanupTimers.clear();
  }

  private scheduleFrozenImageCleanup(
    inputId: string,
    delayMs = RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS,
  ): void {
    if (!this.frozenImages.has(inputId)) {
      this.clearFrozenImageCleanupTimer(inputId);
      return;
    }

    this.clearFrozenImageCleanupTimer(inputId);
    const timer = setTimeout(() => {
      this.frozenImageCleanupTimers.delete(inputId);
      void this.cleanupFrozenImages([inputId]);
    }, delayMs);
    this.frozenImageCleanupTimers.set(inputId, timer);
  }

  private async setFrozenImage(
    inputId: string,
    imageId: string,
    jpegPath: string,
  ): Promise<void> {
    const previous = this.frozenImages.get(inputId);
    this.clearFrozenImageCleanupTimer(inputId);

    this.frozenImages.set(inputId, { imageId, jpegPath });
    this.output.store.getState().setInputFrozenImage(inputId, imageId);

    if (!previous) return;

    try {
      await SmelterInstance.unregisterImage(previous.imageId);
    } catch (err) {
      console.error(
        `Failed to unregister replaced frozen image ${previous.imageId}`,
        err,
      );
    }
    try {
      await remove(previous.jpegPath);
    } catch {
      // best-effort cleanup
    }
  }

  private async cleanupFrozenImages(
    inputIds?: Iterable<string>,
  ): Promise<void> {
    const targets = inputIds
      ? [...new Set(inputIds)]
          .map((inputId) => {
            const frozenImage = this.frozenImages.get(inputId);
            return frozenImage ? ([inputId, frozenImage] as const) : null;
          })
          .filter(
            (
              entry,
            ): entry is readonly [
              string,
              { imageId: string; jpegPath: string },
            ] => !!entry,
          )
      : [...this.frozenImages.entries()];

    if (!inputIds) {
      this.clearAllFrozenImageCleanupTimers();
    }

    for (const [inputId, { imageId, jpegPath }] of targets) {
      this.clearFrozenImageCleanupTimer(inputId);
      this.output.store.getState().setInputFrozenImage(inputId, null);
      this.frozenImages.delete(inputId);
      try {
        await SmelterInstance.unregisterImage(imageId);
      } catch (err) {
        console.error(`Failed to unregister frozen image ${imageId}`, err);
      }
      try {
        await remove(jpegPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  public async seekTimeline(ms: number): Promise<void> {
    if (!this.timelinePlayer) {
      throw new Error('No timeline playback in progress');
    }
    await this.timelinePlayer.seek(ms);
  }

  public getTimelinePlaybackState(): {
    playheadMs: number;
    isPlaying: boolean;
    isPaused: boolean;
  } {
    if (!this.timelinePlayer) {
      return { playheadMs: 0, isPlaying: false, isPaused: false };
    }
    return {
      playheadMs: this.timelinePlayer.getPlayheadMs(),
      isPlaying: this.timelinePlayer.isPlaying(),
      isPaused: this.timelinePlayer.getIsPaused(),
    };
  }

  public addTimelineListener(listener: TimelineListener): () => void {
    this.timelineListeners.add(listener);
    return () => {
      this.timelineListeners.delete(listener);
    };
  }

  public async deleteRoom() {
    return this.mutex.runExclusive(async () => {
      this.destroyed = true;

      if (this.timelinePlayer) {
        this.timelinePlayer.destroy();
        this.timelinePlayer = null;
      }

      await this.cleanupFrozenImages();

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

      await this.stopAllMotion();
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
    });
  }

  private updateStoreWithState() {
    if (this.destroyed) return;

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
      textMaxLines:
        input.type === 'text-input' ? input.textMaxLines : undefined,
      textScrollSpeed:
        input.type === 'text-input' ? input.textScrollSpeed : undefined,
      textScrollLoop:
        input.type === 'text-input' ? input.textScrollLoop : undefined,
      textScrollNudge:
        input.type === 'text-input' ? input.textScrollNudge : undefined,
      textFontSize:
        input.type === 'text-input' ? input.textFontSize : undefined,
      snakeGameState: input.type === 'game' ? input.snakeGameState : undefined,
      snakeEventShaders:
        input.type === 'game' ? input.snakeEventShaders : undefined,
      snake1Shaders: input.type === 'game' ? input.snake1Shaders : undefined,
      snake2Shaders: input.type === 'game' ? input.snake2Shaders : undefined,
      absolutePosition: input.absolutePosition,
      absoluteTop: input.absoluteTop,
      absoluteLeft: input.absoluteLeft,
      absoluteWidth: input.absoluteWidth,
      absoluteHeight: input.absoluteHeight,
      absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
      absoluteTransitionEasing: input.absoluteTransitionEasing,
      activeTransition: input.activeTransition,
      restartFading: input.restartFading,
      frozenImageId: this.frozenImages.get(input.inputId)?.imageId,
    });

    const connectedInputs = this.inputs.filter(
      (input) => input.status === 'connected' && !input.hidden,
    );
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
      .filter((input) => !attachedIds.has(input.inputId))
      .map((input) => {
        const config = toInputConfig(input);
        if (input.attachedInputIds && input.attachedInputIds.length > 0) {
          config.attachedInputs = input.attachedInputIds
            .map((id) => connectedMap.get(id))
            .filter((i): i is RoomInputState => !!i)
            .map(toInputConfig);
        }
        return config;
      });

    this.output.store
      .getState()
      .updateState(
        [...inputs].reverse(),
        this.swapDurationMs,
        this.swapOutgoingEnabled,
        this.swapFadeInDurationMs,
        this.newsStripFadeDuringSwap,
        this.swapFadeOutDurationMs,
        this.newsStripEnabled,
      );
  }

  public hideInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
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
        this.updateStoreWithState();

        const timer = setTimeout(() => {
          input.hidden = true;
          input.activeTransition = undefined;
          this.transitionTimers.delete(inputId);
          this.updateStoreWithState();
        }, durationMs);
        this.transitionTimers.set(inputId, timer);
      } else {
        input.hidden = true;
        this.updateStoreWithState();
      }
    });
  }

  public showInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
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
          this.updateStoreWithState();
        }, durationMs);
        this.transitionTimers.set(inputId, timer);
      }

      this.updateStoreWithState();
    });
  }

  public async setMotionEnabled(
    inputId: string,
    enabled: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.getInput(inputId);
      input.motionEnabled = enabled;
      if (
        enabled &&
        input.status === 'connected' &&
        ['local-mp4', 'twitch-channel', 'kick-channel', 'whip'].includes(
          input.type,
        )
      ) {
        try {
          console.log(
            `[motion][setMotionEnabled] starting for inputId=${inputId} type=${input.type} title="${input.metadata.title}"`,
          );
          await this.motionManager.startMotionDetection(inputId, (score) => {
            if (score === -1) {
              input.motionScore = undefined;
            } else {
              input.motionScore = score;
            }
            this.emitMotionScores();
          });
        } catch (err) {
          console.error(
            `[motion] Failed to start motion detection for ${inputId}`,
            err,
          );
        }
      } else if (!enabled) {
        await this.motionManager.stopMotionDetection(inputId);
        input.motionScore = undefined;
        this.emitMotionScores();
      }
    });
  }

  public async stopAllMotion(): Promise<void> {
    await this.motionManager.stopAll();
  }

  public addMotionScoreListener(
    listener: (scores: Record<string, number>) => void,
  ): () => void {
    this.motionScoreListeners.add(listener);
    return () => {
      this.motionScoreListeners.delete(listener);
    };
  }

  private emitMotionScores(): void {
    if (this.motionScoreListeners.size === 0) return;
    const scores: Record<string, number> = {};
    for (const input of this.inputs) {
      if (input.motionScore !== undefined) {
        scores[input.inputId] = input.motionScore;
      }
    }
    for (const listener of this.motionScoreListeners) {
      listener(scores);
    }
  }

  public updateSnakeGameState(
    inputId: string,
    incomingState: {
      board: {
        width: number;
        height: number;
        cellSize: number;
        cellGap?: number;
      };
      cells: {
        x: number;
        y: number;
        color: string;
        size?: number;
        isHead?: boolean;
        direction?: 'up' | 'down' | 'left' | 'right';
        progress?: number;
      }[];
      smoothMove?: boolean;
      smoothMoveSpeed?: number;
      smoothMoveAccel?: number;
      smoothMoveDecel?: number;
      backgroundColor: string;
      gameOverData?: {
        winnerName: string;
        reason: string;
        players: {
          name: string;
          score: number;
          eaten: number;
          cuts: number;
          color: string;
        }[];
      };
    },
    events?: { type: SnakeEventType }[],
  ) {
    return this.mutex.runExclusive(() => {
      const input = this.getInput(inputId);
      if (input.type !== 'game') {
        throw new Error(`Input ${inputId} is not a game input`);
      }
      input.snakeGameState = buildUpdatedSnakeGameState(
        input.snakeGameState,
        incomingState,
      );
      console.log(
        `[game] Updated snake board: ${incomingState.cells.length} cells on ${incomingState.board.width}x${incomingState.board.height}`,
      );

      if (events && events.length > 0) {
        this.ingestSnakeGameEvents(inputId, events);
      } else {
        this.updateStoreWithState();
      }
    });
  }

  private ingestSnakeGameEvents(
    inputId: string,
    events: { type: SnakeEventType }[],
  ) {
    const input = this.getInput(inputId);
    if (input.type !== 'game') return;
    if (!events || events.length === 0) return;

    const result = processSnakeGameEvents(
      events,
      input.snakeGameState,
      input.activeEffects,
      input.snakeEventShaders,
      () => this.updateStoreWithState(),
    );

    if (result.needsStoreUpdate) {
      input.activeEffects = result.updatedActiveEffects;
      input.effectTimers.push(...result.newTimers);
      this.updateStoreWithState();
    }
  }

  private getInput(inputId: string): RoomInputState {
    const input = this.inputs.find((input) => input.inputId === inputId);
    if (!input) {
      throw new Error(`Input ${inputId} not found`);
    }
    return input;
  }
}

function registerOptionsFromInput(
  input: RoomInputState,
): RegisterSmelterInputOptions {
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
    throw Error('Snake game inputs do not need stream registration');
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
  const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
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

  const mp4s = entries.filter((e) => e.toLowerCase().endsWith('.mp4'));
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
      console.warn('Failed to remove old recording file', {
        file: fullPath,
        err,
      });
    }
  }
}
