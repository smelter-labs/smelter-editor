import type {
  TimelineConfig,
  TimelineClip,
  TimelineBlockSettings,
  TimelineKeyframe,
  TimelineKeyframeInterpolationMode,
} from './types';
import type { RoomInputState } from '../room/types';

type PlaybackEvent = {
  timeMs: number;
  type:
    | 'connect'
    | 'disconnect'
    | 'transition-in'
    | 'transition-out'
    | 'keyframe';
  inputId: string;
  transition?: { type: string; durationMs: number };
};

type TimelineVisibilityTransition = {
  type: string;
  durationMs: number;
  direction: 'in' | 'out';
};

type Mp4RestartKey = `${number}|${number}|${boolean}`;

type InputSnapshot = {
  hidden: boolean;
  update: Record<string, unknown>;
  mp4PlayFromMs?: number;
};

type PrePlaySnapshot = {
  inputSnapshots: Map<string, InputSnapshot>;
  inputOrder: string[];
};

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export type TimelineListenerData = {
  playheadMs: number;
  isPlaying: boolean;
  isPaused: boolean;
};

export type TimelineListener = (data: TimelineListenerData) => void;

export interface TimelineRoomStateAdapter {
  getInputs(): RoomInputState[];
  showInput(
    inputId: string,
    activeTransition?: TimelineVisibilityTransition,
  ): Promise<void>;
  hideInput(
    inputId: string,
    activeTransition?: TimelineVisibilityTransition,
  ): Promise<void>;
  updateInput(
    inputId: string,
    options: Partial<Record<string, any>>,
  ): Promise<void>;
  restartMp4Input(
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void>;
  reorderInputs(inputOrder: string[]): Promise<void>;
}

function isMp4InputId(inputId: string): boolean {
  return inputId.includes('::local::');
}

function getMp4RestartKey(clip: TimelineClip): Mp4RestartKey {
  const playFromMs = clip.blockSettings.mp4PlayFromMs ?? 0;
  const loop = clip.blockSettings.mp4Loop !== false;
  return loop
    ? `0|${playFromMs}|${loop}`
    : `${clip.startMs}|${playFromMs}|${loop}`;
}

function compileEvents(
  config: TimelineConfig,
  fromMs: number,
  mode: TimelineKeyframeInterpolationMode,
): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];

  for (const track of config.tracks) {
    for (const clip of track.clips) {
      if (clip.startMs > fromMs) {
        events.push({
          timeMs: clip.startMs,
          type: 'connect',
          inputId: clip.inputId,
        });
      }
      if (clip.endMs > fromMs) {
        events.push({
          timeMs: clip.endMs,
          type: 'disconnect',
          inputId: clip.inputId,
        });
      }

      if (mode === 'step') {
        for (const keyframe of getNormalizedKeyframes(clip)) {
          const keyframeTimeMs = clip.startMs + keyframe.timeMs;
          if (
            keyframeTimeMs > fromMs &&
            keyframeTimeMs > clip.startMs &&
            keyframeTimeMs < clip.endMs
          ) {
            events.push({
              timeMs: keyframeTimeMs,
              type: 'keyframe',
              inputId: clip.inputId,
            });
          }
        }
      }

      const intro = resolveBlockSettingsAtTime(
        clip,
        clip.startMs,
        mode,
      ).introTransition;
      if (intro && clip.startMs > fromMs) {
        events.push({
          timeMs: clip.startMs,
          type: 'transition-in',
          inputId: clip.inputId,
          transition: intro,
        });
      }

      const outro = resolveBlockSettingsAtTime(
        clip,
        Math.max(clip.startMs, clip.endMs - 1),
        mode,
      ).outroTransition;
      if (outro) {
        const outroStartMs = clip.endMs - outro.durationMs;
        if (outroStartMs > fromMs) {
          events.push({
            timeMs: outroStartMs,
            type: 'transition-out',
            inputId: clip.inputId,
            transition: outro,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

function getActiveClipsByInputAt(
  config: TimelineConfig,
  timeMs: number,
): Map<string, TimelineClip> {
  const active = new Map<string, TimelineClip>();
  for (const track of config.tracks) {
    for (const clip of track.clips) {
      if (
        timeMs >= clip.startMs &&
        timeMs < clip.endMs &&
        !active.has(clip.inputId)
      ) {
        active.set(clip.inputId, clip);
      }
    }
  }
  return active;
}

function getResolvedActiveClipsByInputAt(
  config: TimelineConfig,
  timeMs: number,
  mode: TimelineKeyframeInterpolationMode,
): Map<string, TimelineClip> {
  const active = getActiveClipsByInputAt(config, timeMs);
  const resolved = new Map<string, TimelineClip>();
  for (const [inputId, clip] of active) {
    resolved.set(inputId, {
      ...clip,
      blockSettings: resolveBlockSettingsAtTime(clip, timeMs, mode),
    });
  }
  return resolved;
}

function getClipDurationMs(clip: TimelineClip): number {
  return Math.max(0, clip.endMs - clip.startMs);
}

function getNormalizedKeyframes(clip: TimelineClip): TimelineKeyframe[] {
  const durationMs = getClipDurationMs(clip);
  const rawKeyframes =
    clip.keyframes.length > 0
      ? clip.keyframes
      : [{ id: `${clip.id}-0`, timeMs: 0, blockSettings: clip.blockSettings }];

  const keyframes = rawKeyframes
    .map((keyframe) => ({
      id: keyframe.id,
      timeMs: Math.max(0, Math.min(keyframe.timeMs, durationMs)),
      blockSettings: deepClone(keyframe.blockSettings),
    }))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));

  if (keyframes.length === 0 || keyframes[0].timeMs !== 0) {
    keyframes.unshift({
      id: `${clip.id}-0`,
      timeMs: 0,
      blockSettings: deepClone(clip.blockSettings),
    });
  }

  return keyframes;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function interpolateShaderConfigs(
  fromShaders: TimelineBlockSettings['shaders'] | undefined,
  toShaders: TimelineBlockSettings['shaders'] | undefined,
  progress: number,
): TimelineBlockSettings['shaders'] | undefined {
  if (!fromShaders) return undefined;
  if (!toShaders || fromShaders.length !== toShaders.length) {
    return deepClone(fromShaders);
  }

  return fromShaders.map((fromShader, index) => {
    const toShader = toShaders[index];
    if (
      !toShader ||
      fromShader.shaderId !== toShader.shaderId ||
      fromShader.shaderName !== toShader.shaderName ||
      fromShader.enabled !== toShader.enabled ||
      fromShader.params.length !== toShader.params.length
    ) {
      return deepClone(fromShader);
    }

    return {
      ...deepClone(fromShader),
      params: fromShader.params.map((fromParam, paramIndex) => {
        const toParam = toShader.params[paramIndex];
        if (
          !toParam ||
          fromParam.paramName !== toParam.paramName ||
          typeof fromParam.paramValue !== 'number' ||
          typeof toParam.paramValue !== 'number'
        ) {
          return deepClone(fromParam);
        }
        return {
          ...fromParam,
          paramValue: lerp(fromParam.paramValue, toParam.paramValue, progress),
        };
      }),
    };
  });
}

function interpolateBlockSettings(
  from: TimelineBlockSettings,
  to: TimelineBlockSettings,
  progress: number,
): TimelineBlockSettings {
  const result = deepClone(from);
  const resultRecord = result as Record<string, unknown>;
  const fromRecord = from as Record<string, unknown>;
  const toRecord = to as Record<string, unknown>;

  for (const [key, toValue] of Object.entries(toRecord)) {
    const fromValue = fromRecord[key];
    if (typeof fromValue === 'number' && typeof toValue === 'number') {
      resultRecord[key] = lerp(fromValue, toValue, progress);
    }
  }

  const shaders = interpolateShaderConfigs(from.shaders, to.shaders, progress);
  if (shaders) {
    result.shaders = shaders;
  }
  const snake1Shaders = interpolateShaderConfigs(
    from.snake1Shaders,
    to.snake1Shaders,
    progress,
  );
  if (snake1Shaders) {
    result.snake1Shaders = snake1Shaders;
  }
  const snake2Shaders = interpolateShaderConfigs(
    from.snake2Shaders,
    to.snake2Shaders,
    progress,
  );
  if (snake2Shaders) {
    result.snake2Shaders = snake2Shaders;
  }

  return result;
}

function resolveBlockSettingsAtTime(
  clip: TimelineClip,
  playheadMs: number,
  mode: TimelineKeyframeInterpolationMode,
): TimelineBlockSettings {
  const keyframes = getNormalizedKeyframes(clip);
  const offsetMs = Math.max(
    0,
    Math.min(playheadMs - clip.startMs, getClipDurationMs(clip)),
  );

  let current = keyframes[0];
  for (const keyframe of keyframes) {
    if (keyframe.timeMs > offsetMs) {
      break;
    }
    current = keyframe;
  }

  if (mode === 'step') {
    return deepClone(current.blockSettings);
  }

  const currentIndex = keyframes.findIndex(
    (keyframe) => keyframe.id === current.id,
  );
  const next = keyframes[currentIndex + 1];
  if (!next || next.timeMs <= current.timeMs || offsetMs <= current.timeMs) {
    return deepClone(current.blockSettings);
  }

  const progress = (offsetMs - current.timeMs) / (next.timeMs - current.timeMs);
  return interpolateBlockSettings(
    current.blockSettings,
    next.blockSettings,
    progress,
  );
}

function getActiveOrder(config: TimelineConfig, timeMs: number): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const track of config.tracks) {
    for (const clip of track.clips) {
      if (
        timeMs >= clip.startMs &&
        timeMs < clip.endMs &&
        !seen.has(clip.inputId)
      ) {
        order.push(clip.inputId);
        seen.add(clip.inputId);
      }
    }
  }
  return order;
}

function computeDesiredState(
  config: TimelineConfig,
  playheadMs: number,
): Map<string, boolean> {
  const desired = new Map<string, boolean>();

  for (const track of config.tracks) {
    for (const clip of track.clips) {
      if (!desired.has(clip.inputId)) {
        desired.set(clip.inputId, false);
      }
    }
  }

  for (const track of config.tracks) {
    for (const clip of track.clips) {
      if (playheadMs >= clip.startMs && playheadMs < clip.endMs) {
        desired.set(clip.inputId, true);
      }
    }
  }

  return desired;
}

export function buildUpdateFromBlockSettings(
  bs: TimelineBlockSettings,
): Record<string, unknown> {
  return {
    volume: bs.volume,
    shaders: bs.shaders,
    showTitle: bs.showTitle,
    orientation: bs.orientation,
    text: bs.text,
    textAlign: bs.textAlign,
    textColor: bs.textColor,
    textMaxLines: bs.textMaxLines,
    textScrollSpeed: bs.textScrollSpeed,
    textScrollLoop: bs.textScrollLoop,
    textFontSize: bs.textFontSize,
    borderColor: bs.borderColor,
    borderWidth: bs.borderWidth,
    attachedInputIds: bs.attachedInputIds,
    snake1Shaders: bs.snake1Shaders,
    snake2Shaders: bs.snake2Shaders,
    absolutePosition: bs.absolutePosition,
    absoluteTop: bs.absoluteTop,
    absoluteLeft: bs.absoluteLeft,
    absoluteWidth: bs.absoluteWidth,
    absoluteHeight: bs.absoluteHeight,
    absoluteTransitionDurationMs: bs.absoluteTransitionDurationMs,
    absoluteTransitionEasing: bs.absoluteTransitionEasing,
    cropTop: bs.cropTop,
    cropLeft: bs.cropLeft,
    cropRight: bs.cropRight,
    cropBottom: bs.cropBottom,
    gameBackgroundColor: bs.gameBackgroundColor,
    gameCellGap: bs.gameCellGap,
    gameBoardBorderColor: bs.gameBoardBorderColor,
    gameBoardBorderWidth: bs.gameBoardBorderWidth,
    gameGridLineColor: bs.gameGridLineColor,
    gameGridLineAlpha: bs.gameGridLineAlpha,
    snakeEventShaders: bs.snakeEventShaders,
  };
}

function buildUpdateFromRoomInput(
  input: RoomInputState,
): Record<string, unknown> {
  return {
    volume: input.volume,
    shaders: deepClone(input.shaders),
    showTitle: input.showTitle,
    orientation: input.orientation,
    text: input.type === 'text-input' ? input.text : undefined,
    textAlign: input.type === 'text-input' ? input.textAlign : undefined,
    textColor: input.type === 'text-input' ? input.textColor : undefined,
    textMaxLines: input.type === 'text-input' ? input.textMaxLines : undefined,
    textScrollSpeed:
      input.type === 'text-input' ? input.textScrollSpeed : undefined,
    textScrollLoop:
      input.type === 'text-input' ? input.textScrollLoop : undefined,
    textFontSize: input.type === 'text-input' ? input.textFontSize : undefined,
    borderColor: input.borderColor,
    borderWidth: input.borderWidth,
    attachedInputIds: input.attachedInputIds,
    snake1Shaders: input.type === 'game' ? input.snake1Shaders : undefined,
    snake2Shaders: input.type === 'game' ? input.snake2Shaders : undefined,
    absolutePosition: input.absolutePosition,
    absoluteTop: input.absoluteTop,
    absoluteLeft: input.absoluteLeft,
    absoluteWidth: input.absoluteWidth,
    absoluteHeight: input.absoluteHeight,
    absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input.absoluteTransitionEasing,
    cropTop: input.cropTop,
    cropLeft: input.cropLeft,
    cropRight: input.cropRight,
    cropBottom: input.cropBottom,
    gameBackgroundColor:
      input.type === 'game' ? input.snakeGameState.backgroundColor : undefined,
    gameCellGap:
      input.type === 'game' ? input.snakeGameState.cellGap : undefined,
    gameBoardBorderColor:
      input.type === 'game' ? input.snakeGameState.boardBorderColor : undefined,
    gameBoardBorderWidth:
      input.type === 'game' ? input.snakeGameState.boardBorderWidth : undefined,
    gameGridLineColor:
      input.type === 'game' ? input.snakeGameState.gridLineColor : undefined,
    gameGridLineAlpha:
      input.type === 'game' ? input.snakeGameState.gridLineAlpha : undefined,
    snakeEventShaders:
      input.type === 'game' ? input.snakeEventShaders : undefined,
    activeTransition: input.activeTransition,
  };
}

function snapshotInput(input: RoomInputState): InputSnapshot {
  return {
    hidden: input.hidden,
    update: buildUpdateFromRoomInput(input),
    mp4PlayFromMs: input.type === 'local-mp4' ? input.playFromMs : undefined,
  };
}

const PLAYHEAD_EMIT_INTERVAL_MS = 200;
const SMOOTH_UPDATE_INTERVAL_MS = 50;

export class TimelinePlayer {
  private config: TimelineConfig;
  private room: TimelineRoomStateAdapter;
  private listeners = new Set<TimelineListener>();

  private startWallMs = 0;
  private startPlayheadMs = 0;
  private playing = false;
  private paused = false;
  private pausedPlayheadMs = 0;

  private events: PlaybackEvent[] = [];
  private nextEventIndex = 0;
  private eventTimers: NodeJS.Timeout[] = [];
  private playheadInterval: NodeJS.Timeout | null = null;
  private smoothUpdateInterval: NodeJS.Timeout | null = null;
  private endTimer: NodeJS.Timeout | null = null;

  private appliedState = new Map<string, boolean>();
  private appliedBlockSettings = new Map<string, string>();
  private mp4RestartedKeys = new Map<string, Mp4RestartKey>();
  private mp4ActualRestarted = new Set<string>();
  private lastAppliedOrder = '';

  private snapshot: PrePlaySnapshot | null = null;

  constructor(room: TimelineRoomStateAdapter, config: TimelineConfig) {
    this.room = room;
    this.config = config;
  }

  public addListener(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getPlayheadMs(): number {
    if (this.paused) return this.pausedPlayheadMs;
    if (!this.playing) return this.startPlayheadMs;
    return this.startPlayheadMs + (Date.now() - this.startWallMs);
  }

  public getActiveInputIdsAt(timeMs: number): string[] {
    return [...getActiveClipsByInputAt(this.config, timeMs).keys()];
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public getTotalDurationMs(): number {
    return this.config.totalDurationMs;
  }

  public updateConfig(config: TimelineConfig): void {
    this.config = config;
  }

  public async start(fromMs?: number): Promise<void> {
    const playheadMs = fromMs ?? 0;
    console.log(
      `[timeline] START playback fromMs=${playheadMs} totalDuration=${this.config.totalDurationMs} tracks=${this.config.tracks.length}`,
    );

    this.snapshotState();
    this.playing = true;
    this.startWallMs = Date.now();
    this.startPlayheadMs = playheadMs;
    this.appliedBlockSettings.clear();
    this.mp4ActualRestarted.clear();
    this.lastAppliedOrder = '';

    // Pre-populate MP4 keys for clips already active at fromMs
    const activeAtStart = getResolvedActiveClipsByInputAt(
      this.config,
      playheadMs,
      this.config.keyframeInterpolationMode,
    );
    this.mp4RestartedKeys.clear();
    for (const [inputId, clip] of activeAtStart) {
      if (isMp4InputId(inputId)) {
        const key = getMp4RestartKey(clip);
        this.mp4RestartedKeys.set(inputId, key);
        console.log(
          `[timeline] MP4 pre-populated key inputId=${inputId} key=${key} clipStart=${clip.startMs} clipEnd=${clip.endMs}`,
        );
      }
    }

    // Initialize applied state from current visibility
    this.appliedState = new Map(
      this.room.getInputs().map((i) => [i.inputId, !i.hidden]),
    );

    // Apply initial desired state
    const desired = computeDesiredState(this.config, playheadMs);
    await this.applyDesiredState(desired, playheadMs);
    await this.applyBlockSettingsAtTime(playheadMs);
    this.applyOrderIfChanged(playheadMs);

    // Re-sync wall clock so playhead starts from when MP4s are actually playing
    this.startWallMs = Date.now();

    // Compile and schedule events
    this.events = compileEvents(
      this.config,
      playheadMs,
      this.config.keyframeInterpolationMode,
    );
    this.nextEventIndex = 0;
    this.scheduleAllEvents();
    console.log(
      `[timeline] Scheduled ${this.events.length} events, first=${this.events[0]?.timeMs ?? 'none'}`,
    );

    // Schedule end-of-timeline auto-stop
    const remainingMs = this.config.totalDurationMs - playheadMs;
    if (remainingMs > 0) {
      this.endTimer = setTimeout(() => {
        void this.stop();
      }, remainingMs);
    }

    // Emit playhead periodically
    this.playheadInterval = setInterval(() => {
      this.emit();
    }, PLAYHEAD_EMIT_INTERVAL_MS);
    this.startSmoothUpdates();

    this.emit();
  }

  public async stop(): Promise<void> {
    if (!this.playing && !this.paused) return;
    console.log(
      `[timeline] STOP playback playheadMs=${this.getPlayheadMs()} paused=${this.paused}`,
    );
    this.playing = false;
    this.paused = false;
    this.clearTimers();
    await this.restoreState();
    this.emit();
  }

  public pause(): {
    playheadMs: number;
    activeClips: Map<string, TimelineClip>;
  } {
    if (!this.playing) {
      throw new Error('Cannot pause: timeline is not playing');
    }
    this.pausedPlayheadMs = this.getPlayheadMs();
    console.log(
      `[timeline] PAUSE playback playheadMs=${this.pausedPlayheadMs}`,
    );
    this.playing = false;
    this.paused = true;
    this.clearTimers();

    const activeClips = getResolvedActiveClipsByInputAt(
      this.config,
      this.pausedPlayheadMs,
      this.config.keyframeInterpolationMode,
    );
    this.emit();
    return { playheadMs: this.pausedPlayheadMs, activeClips };
  }

  public async resume(fromMs?: number): Promise<void> {
    if (!this.paused) {
      throw new Error('Cannot resume: timeline is not paused');
    }
    const resumeMs = fromMs ?? this.pausedPlayheadMs;
    console.log(
      `[timeline] RESUME playback fromMs=${resumeMs} (pausedAt=${this.pausedPlayheadMs})`,
    );
    this.paused = false;
    this.playing = true;
    this.startWallMs = Date.now();
    this.startPlayheadMs = resumeMs;

    // Recompile events from new position
    this.events = compileEvents(
      this.config,
      resumeMs,
      this.config.keyframeInterpolationMode,
    );
    this.nextEventIndex = 0;

    // Apply state at resume position
    const desired = computeDesiredState(this.config, resumeMs);
    await this.applyDesiredState(desired, resumeMs);
    this.mp4RestartedKeys.clear();
    await this.applyBlockSettingsAtTime(resumeMs);
    this.lastAppliedOrder = '';
    this.applyOrderIfChanged(resumeMs);

    // Re-sync wall clock so playhead starts from when MP4s are actually playing
    this.startWallMs = Date.now();

    this.scheduleAllEvents();

    // Schedule end-of-timeline auto-stop
    const remainingMs = this.config.totalDurationMs - resumeMs;
    if (remainingMs > 0) {
      this.endTimer = setTimeout(() => {
        void this.stop();
      }, remainingMs);
    }

    this.playheadInterval = setInterval(() => {
      this.emit();
    }, PLAYHEAD_EMIT_INTERVAL_MS);
    this.startSmoothUpdates();

    this.emit();
  }

  public getIsPaused(): boolean {
    return this.paused;
  }

  public async seek(ms: number): Promise<void> {
    if (!this.playing) return;
    console.log(
      `[timeline] SEEK to ${ms}ms (was at ${this.getPlayheadMs()}ms)`,
    );

    this.clearEventTimers();
    this.startWallMs = Date.now();
    this.startPlayheadMs = ms;

    // Reset end timer
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    const remainingMs = this.config.totalDurationMs - ms;
    if (remainingMs > 0) {
      this.endTimer = setTimeout(() => {
        void this.stop();
      }, remainingMs);
    }

    // Recompile events from new position
    this.events = compileEvents(
      this.config,
      ms,
      this.config.keyframeInterpolationMode,
    );
    this.nextEventIndex = 0;

    // Apply state at new position
    const desired = computeDesiredState(this.config, ms);
    await this.applyDesiredState(desired, ms);
    this.mp4RestartedKeys.clear();
    await this.applyBlockSettingsAtTime(ms);
    this.lastAppliedOrder = '';
    this.applyOrderIfChanged(ms);

    this.scheduleAllEvents();
    this.emit();
  }

  public async applyStaticSnapshot(
    playheadMs: number,
  ): Promise<Map<string, TimelineClip>> {
    console.log(
      `[timeline] APPLY STATIC SNAPSHOT playheadMs=${playheadMs} totalDuration=${this.config.totalDurationMs}`,
    );

    this.snapshotState();
    this.appliedState = new Map(
      this.room.getInputs().map((i) => [i.inputId, !i.hidden]),
    );
    this.appliedBlockSettings.clear();
    this.mp4RestartedKeys.clear();
    this.mp4ActualRestarted.clear();
    this.lastAppliedOrder = '';

    const desired = computeDesiredState(this.config, playheadMs);
    await this.applyDesiredState(desired, playheadMs);
    await this.applyBlockSettingsAtTime(playheadMs);
    this.applyOrderIfChanged(playheadMs);

    this.paused = true;
    this.pausedPlayheadMs = playheadMs;
    this.emit();

    return getResolvedActiveClipsByInputAt(
      this.config,
      playheadMs,
      this.config.keyframeInterpolationMode,
    );
  }

  public destroy(): void {
    this.playing = false;
    this.paused = false;
    this.clearTimers();
    this.listeners.clear();
  }

  // ── Private ─────────────────────────────────────────────

  private emit(): void {
    const data: TimelineListenerData = {
      playheadMs: Math.min(this.getPlayheadMs(), this.config.totalDurationMs),
      isPlaying: this.playing,
      isPaused: this.paused,
    };
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  private clearEventTimers(): void {
    for (const timer of this.eventTimers) {
      clearTimeout(timer);
    }
    this.eventTimers = [];
  }

  private clearTimers(): void {
    this.clearEventTimers();
    if (this.playheadInterval) {
      clearInterval(this.playheadInterval);
      this.playheadInterval = null;
    }
    if (this.smoothUpdateInterval) {
      clearInterval(this.smoothUpdateInterval);
      this.smoothUpdateInterval = null;
    }
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  private startSmoothUpdates(): void {
    if (this.config.keyframeInterpolationMode !== 'smooth') return;
    if (this.smoothUpdateInterval) {
      clearInterval(this.smoothUpdateInterval);
    }
    this.smoothUpdateInterval = setInterval(() => {
      if (!this.playing) return;
      void this.applyBlockSettingsAtTime(this.getPlayheadMs());
    }, SMOOTH_UPDATE_INTERVAL_MS);
  }

  private scheduleAllEvents(): void {
    this.clearEventTimers();

    for (let i = this.nextEventIndex; i < this.events.length; i++) {
      const event = this.events[i];
      const delayMs =
        event.timeMs - this.startPlayheadMs - (Date.now() - this.startWallMs);

      const timer = setTimeout(
        () => {
          this.fireEvent(i);
        },
        Math.max(0, delayMs),
      );
      this.eventTimers.push(timer);
    }
  }

  private fireEvent(index: number): void {
    if (!this.playing) return;
    const event = this.events[index];
    if (!event) return;

    if (event.type === 'connect') {
      this.appliedState.set(event.inputId, true);

      // Look for a co-located transition-in event
      let mergedTransition: TimelineVisibilityTransition | undefined;
      for (let j = index + 1; j < this.events.length; j++) {
        if (this.events[j].timeMs !== event.timeMs) break;
        if (
          this.events[j].type === 'transition-in' &&
          this.events[j].inputId === event.inputId &&
          this.events[j].transition
        ) {
          mergedTransition = {
            type: this.events[j].transition!.type,
            durationMs: this.events[j].transition!.durationMs,
            direction: 'in',
          };
          break;
        }
      }

      void this.showInputAtTime(event.inputId, event.timeMs, mergedTransition);
    } else if (event.type === 'disconnect') {
      const stillActive = this.config.tracks.some((track) =>
        track.clips.some(
          (clip) =>
            clip.inputId === event.inputId &&
            event.timeMs >= clip.startMs &&
            event.timeMs < clip.endMs,
        ),
      );
      if (!stillActive) {
        this.appliedState.set(event.inputId, false);
        void this.room
          .hideInput(event.inputId)
          .catch((err) =>
            console.warn(`[timeline] Failed to hide ${event.inputId}`, err),
          );
      }
    } else if (event.type === 'transition-in' && event.transition) {
      // Standalone transition-in (not merged with connect)
      void this.room
        .updateInput(event.inputId, {
          activeTransition: {
            type: event.transition.type,
            durationMs: event.transition.durationMs,
            direction: 'in',
          },
        })
        .catch((err) =>
          console.warn(
            `[timeline] Failed transition-in for ${event.inputId}`,
            err,
          ),
        );
    } else if (event.type === 'transition-out' && event.transition) {
      this.appliedState.set(event.inputId, false);
      void this.room
        .hideInput(event.inputId, {
          type: event.transition.type,
          durationMs: event.transition.durationMs,
          direction: 'out',
        })
        .catch((err) =>
          console.warn(
            `[timeline] Failed transition-out for ${event.inputId}`,
            err,
          ),
        );
    } else if (event.type === 'keyframe') {
      // Keyframe timing is handled by the shared post-event apply below.
    }

    this.applyOrderIfChanged(event.timeMs);
    void this.applyBlockSettingsAtTime(event.timeMs);
  }

  private async showInputAtTime(
    inputId: string,
    timeMs: number,
    transition?: TimelineVisibilityTransition,
  ): Promise<void> {
    const clip = getResolvedActiveClipsByInputAt(
      this.config,
      timeMs,
      this.config.keyframeInterpolationMode,
    ).get(inputId);
    if (!clip) {
      console.warn(
        `[timeline] showInputAtTime: no active clip for ${inputId} at ${timeMs}ms`,
      );
      return;
    }

    const isMp4 = isMp4InputId(inputId);
    if (isMp4) {
      console.log(
        `[timeline] showInputAtTime MP4 inputId=${inputId} timeMs=${timeMs} clipStart=${clip.startMs} clipEnd=${clip.endMs} mp4PlayFromMs=${clip.blockSettings.mp4PlayFromMs ?? 0} mp4Loop=${clip.blockSettings.mp4Loop !== false}`,
      );
    }

    await this.applyClipState(inputId, clip, timeMs);

    const input = this.room.getInputs().find((i) => i.inputId === inputId);
    if (!input) {
      console.warn(
        `[timeline] showInputAtTime: input ${inputId} not found in room`,
      );
      return;
    }

    const isVisible =
      (input.status === 'connected' || input.status === 'pending') &&
      !input.hidden;

    if (isMp4) {
      console.log(
        `[timeline] showInputAtTime MP4 inputId=${inputId} status=${input.status} hidden=${input.hidden} isVisible=${isVisible} restartFading=${(input as any).restartFading ?? false}`,
      );
    }

    if (isVisible) return;

    const showTransition =
      transition ??
      (clip.blockSettings.introTransition
        ? {
            type: clip.blockSettings.introTransition.type,
            durationMs: clip.blockSettings.introTransition.durationMs,
            direction: 'in' as const,
          }
        : undefined);

    await this.room
      .showInput(inputId, showTransition)
      .catch((err) =>
        console.warn(`[timeline] Failed to show ${inputId}`, err),
      );
  }

  private async applyClipState(
    inputId: string,
    clip: TimelineClip,
    targetPlayheadMs: number,
  ): Promise<void> {
    const resolvedBlockSettings = resolveBlockSettingsAtTime(
      clip,
      targetPlayheadMs,
      this.config.keyframeInterpolationMode,
    );
    const serialized = JSON.stringify(resolvedBlockSettings);
    if (this.appliedBlockSettings.get(inputId) !== serialized) {
      this.appliedBlockSettings.set(inputId, serialized);
      await this.room
        .updateInput(
          inputId,
          buildUpdateFromBlockSettings(resolvedBlockSettings),
        )
        .catch((err) =>
          console.warn(
            `[timeline] Failed to apply block settings for ${inputId}`,
            err,
          ),
        );
    }

    if (isMp4InputId(inputId)) {
      const basePlayFrom = resolvedBlockSettings.mp4PlayFromMs ?? 0;
      const elapsedInClip = Math.max(0, targetPlayheadMs - clip.startMs);
      const playFromMs = basePlayFrom + elapsedInClip;
      const loop = resolvedBlockSettings.mp4Loop !== false;
      const key = getMp4RestartKey({
        ...clip,
        blockSettings: resolvedBlockSettings,
      });
      const prevKey = this.mp4RestartedKeys.get(inputId);
      if (prevKey !== key) {
        console.log(
          `[timeline] MP4 restart TRIGGERED inputId=${inputId} playFromMs=${playFromMs} loop=${loop} key=${key} prevKey=${prevKey ?? 'none'}`,
        );
        this.mp4RestartedKeys.set(inputId, key);
        this.mp4ActualRestarted.add(inputId);
        const t0 = Date.now();
        try {
          await this.room.restartMp4Input(inputId, playFromMs, loop);
          console.log(
            `[timeline] MP4 restart OK inputId=${inputId} durationMs=${Date.now() - t0}`,
          );
        } catch (err) {
          console.error(
            `[timeline] MP4 restart FAILED inputId=${inputId} durationMs=${Date.now() - t0}`,
            err,
          );
        }
      }
    }
  }

  private async applyDesiredState(
    desired: Map<string, boolean>,
    timeMs: number,
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [inputId, shouldBeVisible] of desired) {
      const wasVisible = this.appliedState.get(inputId);
      if (wasVisible === shouldBeVisible) continue;

      const input = this.room.getInputs().find((i) => i.inputId === inputId);
      if (!input) continue;

      const isCurrentlyVisible =
        (input.status === 'connected' || input.status === 'pending') &&
        !input.hidden;

      if (shouldBeVisible && !isCurrentlyVisible) {
        promises.push(this.showInputAtTime(inputId, timeMs));
      } else if (!shouldBeVisible && isCurrentlyVisible) {
        promises.push(
          this.room
            .hideInput(inputId)
            .catch((err) =>
              console.warn(`[timeline] Failed to hide ${inputId}`, err),
            ),
        );
      }

      this.appliedState.set(inputId, shouldBeVisible);
    }

    for (const input of this.room.getInputs()) {
      if (desired.has(input.inputId)) continue;
      const isVisible =
        (input.status === 'connected' || input.status === 'pending') &&
        !input.hidden;
      if (isVisible) {
        promises.push(
          this.room
            .hideInput(input.inputId)
            .catch((err) =>
              console.warn(
                `[timeline] Failed to hide non-timeline input ${input.inputId}`,
                err,
              ),
            ),
        );
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  private async applyBlockSettingsAtTime(timeMs: number): Promise<void> {
    const active = getResolvedActiveClipsByInputAt(
      this.config,
      timeMs,
      this.config.keyframeInterpolationMode,
    );
    const updates: Promise<void>[] = [];
    for (const [inputId, clip] of active) {
      updates.push(this.applyClipState(inputId, clip, timeMs));
    }
    if (updates.length > 0) {
      await Promise.allSettled(updates);
    }
  }

  private applyOrderIfChanged(timeMs: number): void {
    const order = getActiveOrder(this.config, timeMs);
    const key = order.join(',');
    if (key === this.lastAppliedOrder || order.length === 0) return;
    this.lastAppliedOrder = key;
    void this.room
      .reorderInputs(order)
      .catch((err) => console.warn('[timeline] Failed to apply order', err));
  }

  private snapshotState(): void {
    const inputs = this.room.getInputs();
    const inputSnapshots = new Map<string, InputSnapshot>();
    const inputOrder: string[] = [];

    for (const input of inputs) {
      inputOrder.push(input.inputId);
      inputSnapshots.set(input.inputId, snapshotInput(input));
    }

    this.snapshot = { inputSnapshots, inputOrder };
  }

  private async restoreState(): Promise<void> {
    if (!this.snapshot) return;

    const promises: Promise<void>[] = [];
    const inputs = this.room.getInputs();

    for (const input of inputs) {
      const snap = this.snapshot.inputSnapshots.get(input.inputId);
      if (!snap) {
        if (input.hidden) {
          promises.push(this.room.showInput(input.inputId).catch(() => {}));
        }
        continue;
      }

      const currentUpdate = buildUpdateFromRoomInput(input);
      const hasPatch =
        JSON.stringify(currentUpdate) !== JSON.stringify(snap.update);
      const shouldRestartMp4 = this.mp4ActualRestarted.has(input.inputId);
      const needsVisibilityRestore =
        (snap.hidden && !input.hidden) || (!snap.hidden && input.hidden);

      if (!hasPatch && !shouldRestartMp4 && !needsVisibilityRestore) continue;

      promises.push(
        (async () => {
          if (hasPatch) {
            await this.room
              .updateInput(input.inputId, snap.update)
              .catch(() => {});
          }
          if (shouldRestartMp4) {
            await this.room
              .restartMp4Input(input.inputId, snap.mp4PlayFromMs ?? 0, true)
              .catch(() => {});
          }
          if (snap.hidden && !input.hidden) {
            await this.room.hideInput(input.inputId).catch(() => {});
          } else if (!snap.hidden && input.hidden) {
            await this.room.showInput(input.inputId).catch(() => {});
          }
        })(),
      );
    }

    if (this.snapshot.inputOrder.length > 0) {
      promises.push(
        this.room.reorderInputs(this.snapshot.inputOrder).catch(() => {}),
      );
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    this.snapshot = null;
    this.appliedState.clear();
    this.appliedBlockSettings.clear();
    this.mp4RestartedKeys.clear();
    this.mp4ActualRestarted.clear();
  }
}
