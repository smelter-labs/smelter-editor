import { remove } from 'fs-extra';
import { Mutex } from 'async-mutex';
import { SmelterInstance, type SmelterOutput } from '../smelter';
import type { InputConfig } from '../app/store';
import type { Layer, BehaviorInputInfo } from '../types';
import { computeLayout } from '@smelter-editor/types';
import type { SnakeEventType } from '../snakeGame/types';
import type { RoomNameEntry } from '../core/roomNames';
import {
  TimelinePlayer,
  type TimelineListener,
  type TimelineRoomStateAdapter,
} from '../timeline/TimelinePlayer';
import type { TimelineConfig } from '../timeline/types';
import { logTimelineEvent } from '../dashboard';

import { InputManager } from './InputManager';
import { RecordingController } from './RecordingController';
import { MotionController } from './MotionController';
import { SnakeGameController } from './SnakeGameController';
import { PlaceholderManager } from './PlaceholderManager';
import { AudioController } from '../audio/AudioController';
import type { AudioStoreState } from '../audio/audioStore';
import type { StoreApi } from 'zustand';
import type {
  PendingWhipInputData,
  RoomInputState,
  RegisterInputOptions,
  RoomSnapshot,
  UpdateInputOptions,
} from './types';
import type { ShaderConfig } from '../types';

const RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS = 5500;
const FROZEN_IMAGE_UNREGISTER_GRACE_MS = 500;

function cloneLayers(layers: Layer[]): Layer[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(layers);
  }
  return JSON.parse(JSON.stringify(layers)) as Layer[];
}

export class RoomState {
  private readonly mutex = new Mutex();
  private destroyed = false;

  private readonly inputManager: InputManager;
  private readonly recordingController: RecordingController;
  private readonly motionController: MotionController;
  private readonly snakeGameController: SnakeGameController;
  private readonly placeholderManager: PlaceholderManager;
  private readonly audioController: AudioController;

  private stateChangeListeners = new Set<() => void>();

  private timelinePlayer: TimelinePlayer | null = null;
  private timelineListeners = new Set<TimelineListener>();

  private frozenImages: Map<string, { imageId: string; jpegPath: string }> =
    new Map();
  private frozenImageCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private pendingImageUnregisters = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; jpegPath: string }
  >();

  private storeUpdateScheduled = false;
  private lastStoreFlushTime = 0;
  private pendingStoreFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MIN_STORE_FLUSH_INTERVAL_MS = 10;

  private layers: Layer[] = [
    {
      id: 'default',
      inputs: [],
    },
  ];
  private swapDurationMs: number = 500;
  private swapOutgoingEnabled: boolean = true;
  private swapFadeInDurationMs: number = 500;
  private swapFadeOutDurationMs: number = 500;
  private newsStripFadeDuringSwap: boolean = true;
  private newsStripEnabled: boolean = false;

  private viewportTop?: number;
  private viewportLeft?: number;
  private viewportWidth?: number;
  private viewportHeight?: number;
  private viewportTransitionDurationMs?: number;
  private viewportTransitionEasing?: string;

  public idPrefix: string;
  private output: SmelterOutput;

  public lastReadTimestamp: number;
  public creationTimestamp: number;
  private _pendingDelete?: boolean;
  private _isPublic: boolean = true;
  private _pendingWhipInputs: PendingWhipInputData[] = [];
  public roomName: RoomNameEntry;

  private readonly initInputs: RegisterInputOptions[];
  private readonly skipDefaultInputs: boolean;

  public constructor(
    idPrefix: string,
    output: SmelterOutput,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false,
    roomName?: RoomNameEntry,
    audioStore?: StoreApi<AudioStoreState>,
  ) {
    this.idPrefix = idPrefix;
    this.output = output;
    this.initInputs = initInputs;
    this.skipDefaultInputs = skipDefaultInputs;
    this.roomName = roomName ?? {
      pl: `Pokój ${idPrefix.slice(0, 6)}`,
      en: `Room ${idPrefix.slice(0, 6)}`,
    };
    this.lastReadTimestamp = Date.now();
    this.creationTimestamp = Date.now();

    this.placeholderManager = new PlaceholderManager(idPrefix);
    this.motionController = new MotionController(idPrefix, () =>
      this.inputManager.getInputs(),
    );
    this.audioController = new AudioController(idPrefix, output, audioStore);
    this.inputManager = new InputManager(
      idPrefix,
      this.placeholderManager,
      this.motionController,
      () => this.updateStoreWithState(),
    );
    this.recordingController = new RecordingController(idPrefix, output);
    this.snakeGameController = new SnakeGameController();
  }

  public async init(): Promise<void> {
    await this.inputManager.initializeInputs(
      this.initInputs,
      this.skipDefaultInputs,
    );
    for (const input of this.inputManager.getInputs()) {
      await this.inputManager.connectInput(input.inputId);
    }
  }

  // ── Room-level property accessors ────────────────────────

  public get pendingDelete(): boolean | undefined {
    return this._pendingDelete;
  }
  public set pendingDelete(value: boolean | undefined) {
    this._pendingDelete = value;
    this.notifyStateChange();
  }

  public get isPublic(): boolean {
    return this._isPublic;
  }
  public set isPublic(value: boolean) {
    this._isPublic = value;
    this.notifyStateChange();
  }

  public get pendingWhipInputs(): PendingWhipInputData[] {
    return this._pendingWhipInputs;
  }
  public set pendingWhipInputs(value: PendingWhipInputData[]) {
    this._pendingWhipInputs = value;
    this.notifyStateChange();
  }

  // ── Output accessors ──────────────────────────────────────

  public getWhepUrl(): string {
    return this.output.url;
  }

  public getResolution(): { width: number; height: number } {
    return this.output.resolution;
  }

  // ── State snapshot ────────────────────────────────────────

  public getState(): RoomSnapshot {
    this.lastReadTimestamp = Date.now();
    return {
      inputs: this.inputManager.getInputs(),
      layers: this.layers,
      swapDurationMs: this.swapDurationMs,
      swapOutgoingEnabled: this.swapOutgoingEnabled,
      swapFadeInDurationMs: this.swapFadeInDurationMs,
      newsStripFadeDuringSwap: this.newsStripFadeDuringSwap,
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
      newsStripEnabled: this.newsStripEnabled,
      outputShaders: this.getOutputShaders(),
      viewportTop: this.viewportTop,
      viewportLeft: this.viewportLeft,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportTransitionDurationMs: this.viewportTransitionDurationMs,
      viewportTransitionEasing: this.viewportTransitionEasing,
    };
  }

  public getInputs(): RoomInputState[] {
    return this.inputManager.getInputs();
  }

  // ── Recording (delegated) ─────────────────────────────────

  public hasActiveRecording(): boolean {
    return this.recordingController.hasActiveRecording();
  }

  public async startRecording(): Promise<{ fileName: string }> {
    return this.mutex.runExclusive(() =>
      this.recordingController.startRecording(),
    );
  }

  public async stopRecording(): Promise<{ fileName: string }> {
    return this.mutex.runExclusive(() =>
      this.recordingController.stopRecording(),
    );
  }

  // ── Room settings ─────────────────────────────────────────

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

  public setViewport(
    opts: Partial<import('../types').ViewportProperties>,
  ): void {
    if (opts.viewportTop !== undefined) this.viewportTop = opts.viewportTop;
    if (opts.viewportLeft !== undefined) this.viewportLeft = opts.viewportLeft;
    if (opts.viewportWidth !== undefined)
      this.viewportWidth = opts.viewportWidth;
    if (opts.viewportHeight !== undefined)
      this.viewportHeight = opts.viewportHeight;
    if (opts.viewportTransitionDurationMs !== undefined)
      this.viewportTransitionDurationMs = opts.viewportTransitionDurationMs;
    if (opts.viewportTransitionEasing !== undefined)
      this.viewportTransitionEasing = opts.viewportTransitionEasing;
    this.updateStoreWithState();
  }

  public resetViewport(): void {
    this.viewportTop = undefined;
    this.viewportLeft = undefined;
    this.viewportWidth = undefined;
    this.viewportHeight = undefined;
    this.viewportTransitionDurationMs = undefined;
    this.viewportTransitionEasing = undefined;
    this.updateStoreWithState();
  }

  public async updateLayers(layers: Layer[]) {
    return this.mutex.runExclusive(async () => {
      if (layers.length === 0) {
        throw new Error('layers must not be empty');
      }

      const cloned = cloneLayers(layers);
      this.layers = cloned;

      // Sync position, transition, and crop properties from layer entries back
      // to input state so the editor's controllers stay consistent.
      // The first layer that contains an input is authoritative.
      const allInputs = this.inputManager.getInputs();
      const seen = new Set<string>();
      for (const layer of cloned) {
        for (const li of layer.inputs) {
          if (seen.has(li.inputId)) continue;
          seen.add(li.inputId);
          const input = allInputs.find((i) => i.inputId === li.inputId);
          if (!input) continue;
          input.absoluteLeft = li.x;
          input.absoluteTop = li.y;
          input.absoluteWidth = li.width;
          input.absoluteHeight = li.height;
          if (li.transitionDurationMs !== undefined)
            input.absoluteTransitionDurationMs = li.transitionDurationMs;
          if (li.transitionEasing !== undefined)
            input.absoluteTransitionEasing = li.transitionEasing;
          if (li.cropTop !== undefined) input.cropTop = li.cropTop;
          if (li.cropLeft !== undefined) input.cropLeft = li.cropLeft;
          if (li.cropRight !== undefined) input.cropRight = li.cropRight;
          if (li.cropBottom !== undefined) input.cropBottom = li.cropBottom;
        }
      }

      // Apply store + behavior layouts immediately (do not debounce: callers expect
      // this.layers to match computeLayout right after updateLayers returns).
      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;
      this.flushStoreUpdate();
    });
  }

  /**
   * Build BehaviorInputInfo[] from the current connected, non-hidden inputs
   * for use with computeLayout().
   */
  private collectBehaviorInputInfos(): BehaviorInputInfo[] {
    const allInputs = this.inputManager.getInputs();
    const attachedIds = new Set<string>();
    for (const inp of allInputs) {
      if (inp.status === 'connected' && !inp.hidden && inp.attachedInputIds) {
        for (const id of inp.attachedInputIds) {
          attachedIds.add(id);
        }
      }
    }
    return allInputs
      .filter(
        (inp) =>
          inp.status === 'connected' &&
          !inp.hidden &&
          !attachedIds.has(inp.inputId),
      )
      .map((inp) => ({
        inputId: inp.inputId,
        nativeWidth: inp.nativeWidth,
        nativeHeight: inp.nativeHeight,
      }));
  }

  // ── Input operations (mutex-wrapped delegation) ───────────

  public async addNewInput(opts: RegisterInputOptions) {
    return this.mutex.runExclusive(async () => {
      return await this.inputManager.addNewInput(opts);
    });
  }

  public async removeInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.removeInput(inputId);
      for (const layer of this.layers) {
        layer.inputs = layer.inputs.filter((li) => li.inputId !== inputId);
      }
    });
  }

  public async connectInput(inputId: string): Promise<string> {
    return this.mutex.runExclusive(() =>
      this.inputManager.connectInput(inputId),
    );
  }

  public async resolveMissingLocalMp4Asset(
    inputId: string,
    opts: { fileName?: string; audioFileName?: string },
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.resolveMissingLocalMp4Asset(inputId, opts);
    });
  }

  public async resolveMissingImageAsset(
    inputId: string,
    opts: { fileName: string },
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.resolveMissingImageAsset(inputId, opts);
    });
  }

  public async disconnectInput(inputId: string) {
    return this.mutex.runExclusive(() =>
      this.inputManager.disconnectInput(inputId),
    );
  }

  public async updateInput(
    inputId: string,
    options: Partial<UpdateInputOptions>,
  ) {
    return this.mutex.runExclusive(async () => {
      // Sync: mirror absolute position, transition, and crop changes to all
      // matching layer inputs so the rendering pipeline (App.tsx reads from
      // LayerInput) stays consistent with input state.
      const hasLayerPatch =
        options.absoluteLeft !== undefined ||
        options.absoluteTop !== undefined ||
        options.absoluteWidth !== undefined ||
        options.absoluteHeight !== undefined ||
        options.absoluteTransitionDurationMs !== undefined ||
        options.absoluteTransitionEasing !== undefined ||
        options.cropTop !== undefined ||
        options.cropLeft !== undefined ||
        options.cropRight !== undefined ||
        options.cropBottom !== undefined;
      if (hasLayerPatch) {
        for (const layer of this.layers) {
          for (const li of layer.inputs) {
            if (li.inputId !== inputId) continue;
            if (options.absoluteLeft !== undefined) li.x = options.absoluteLeft;
            if (options.absoluteTop !== undefined) li.y = options.absoluteTop;
            if (options.absoluteWidth !== undefined)
              li.width = options.absoluteWidth;
            if (options.absoluteHeight !== undefined)
              li.height = options.absoluteHeight;
            if (options.absoluteTransitionDurationMs !== undefined)
              li.transitionDurationMs = options.absoluteTransitionDurationMs;
            if (options.absoluteTransitionEasing !== undefined)
              li.transitionEasing = options.absoluteTransitionEasing;
            if (options.cropTop !== undefined) li.cropTop = options.cropTop;
            if (options.cropLeft !== undefined) li.cropLeft = options.cropLeft;
            if (options.cropRight !== undefined)
              li.cropRight = options.cropRight;
            if (options.cropBottom !== undefined)
              li.cropBottom = options.cropBottom;
          }
        }
      }
      this.inputManager.updateInput(inputId, options);
    });
  }

  public reorderInputs(inputOrder: string[]) {
    return this.mutex.runExclusive(() => {
      this.inputManager.reorderInputs(inputOrder);

      const orderIndex = new Map(inputOrder.map((id, idx) => [id, idx]));
      for (const layer of this.layers) {
        // For both manual and behavior layers, sort inputs by the requested
        // order. Each LayerInput carries its own position, so a plain sort
        // preserves per-input geometry (no slot-position reassignment).
        layer.inputs.sort((a, b) => {
          const ai = orderIndex.get(a.inputId) ?? Number.MAX_SAFE_INTEGER;
          const bi = orderIndex.get(b.inputId) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
      }
    });
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
      this.inputManager.hideInput(inputId, activeTransition);
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
      this.inputManager.showInput(inputId, activeTransition);
    });
  }

  public async ackWhipInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.inputManager.ackWhipInput(inputId);
    });
  }

  public async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.removeStaleWhipInputs(staleTtlMs);
    });
  }

  public async restartMp4Input(
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.restartMp4Input(inputId, playFromMs, loop);
    });
  }

  // ── Motion (delegated) ────────────────────────────────────

  public async setMotionEnabled(
    inputId: string,
    enabled: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.inputManager.getInput(inputId);
      await this.motionController.setMotionEnabled(input, enabled);
    });
  }

  public async stopAllMotion(): Promise<void> {
    await this.motionController.stopAll();
  }

  public addStateChangeListener(listener: () => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => {
      this.stateChangeListeners.delete(listener);
    };
  }

  public addMotionScoreListener(
    listener: (scores: Record<string, number>) => void,
  ): () => void {
    return this.motionController.addMotionScoreListener(listener);
  }

  // ── Audio analysis (delegated) ──────────────────────────────

  public async setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.audioController.setAudioAnalysisEnabled(enabled);
    });
  }

  public isAudioAnalysisEnabled(): boolean {
    return this.audioController.isEnabled();
  }

  public getAudioStore() {
    return this.audioController.audioStore;
  }

  public addAudioLevelListener(
    listener: (levels: number[]) => void,
  ): () => void {
    return this.audioController.addAudioLevelListener(listener);
  }

  // ── Snake game (delegated) ────────────────────────────────

  public updateSnakeGameState(
    inputId: string,
    incomingState: Parameters<SnakeGameController['updateGameState']>[1],
    events?: { type: SnakeEventType }[],
  ) {
    return this.mutex.runExclusive(() => {
      const input = this.inputManager.getInput(inputId);
      if (input.type !== 'game') {
        throw new Error(`Input ${inputId} is not a game input`);
      }
      this.snakeGameController.updateGameState(
        input,
        incomingState,
        events,
        () => this.updateStoreWithState(),
      );
    });
  }

  // ── Timeline playback ─────────────────────────────────────

  public isFrozen(): boolean {
    return this.timelinePlayer?.getIsPaused() === true;
  }

  public setOutputShaders(shaders: ShaderConfig[]): void {
    this.output.store.getState().setOutputShaders(shaders);
  }

  public getOutputShaders(): ShaderConfig[] {
    return this.output.store.getState().outputShaders;
  }

  private buildTimelineAdapter(): TimelineRoomStateAdapter {
    return {
      getInputs: () => this.getInputs(),
      getLayers: () => this.layers,
      showInput: (inputId, transition) => this.showInput(inputId, transition),
      hideInput: (inputId, transition) => this.hideInput(inputId, transition),
      updateInput: (inputId, options) => this.updateInput(inputId, options),
      updateLayers: (layers) => this.updateLayers(layers),
      restartMp4Input: (inputId, playFromMs, loop) =>
        this.restartMp4Input(inputId, playFromMs, loop),
      reorderInputs: (order) => this.reorderInputs(order),
      updateOutputShaders: (shaders) => {
        this.setOutputShaders(shaders);
        return Promise.resolve();
      },
      getOutputShaders: () => this.getOutputShaders(),
    };
  }

  public async startTimelinePlayback(
    config: TimelineConfig,
    fromMs?: number,
  ): Promise<void> {
    if (this.timelinePlayer?.getIsPaused()) {
      this.timelinePlayer.updateConfig(config);
      await this.resumeTimeline(fromMs);
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
    this.notifyStateChange();
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

    this.cleanupFrozenImages();

    const inputs = this.inputManager.getInputs();
    for (const [inputId, clip] of activeClips) {
      const input = inputs.find((i) => i.inputId === inputId);
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

        this.setFrozenImage(inputId, frozenId, jpegPath);
        logTimelineEvent(
          this.idPrefix,
          `MP4 FROZEN (scrub) ${input.metadata.title} at ${Math.round(framePositionMs)}ms`,
        );
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
    this.cleanupFrozenImages();
    await this.timelinePlayer.stop();
    this.timelinePlayer.destroy();
    this.timelinePlayer = null;
    this.notifyStateChange();
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
    const inputs = this.inputManager.getInputs();

    for (const [inputId, clip] of activeClips) {
      const input = inputs.find((i) => i.inputId === inputId);
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

        this.setFrozenImage(inputId, frozenId, jpegPath);
        logTimelineEvent(
          this.idPrefix,
          `MP4 FROZEN (pause) ${input.metadata.title} at ${Math.round(framePositionMs)}ms`,
        );
      } catch (err) {
        console.error(`[timeline] Failed to extract frame for ${inputId}`, err);
      }
    }

    this.notifyStateChange();
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

    logTimelineEvent(
      this.idPrefix,
      `RESUME at ${Math.round(resumeMs)}ms (${activeFrozenInputIds.size} frozen MP4s)`,
    );

    await this.timelinePlayer.resume(fromMs);

    const inactiveFrozenInputIds = [...this.frozenImages.keys()].filter(
      (inputId) => !activeFrozenInputIds.has(inputId),
    );
    this.cleanupFrozenImages(inactiveFrozenInputIds);

    const inputs = this.inputManager.getInputs();
    for (const inputId of activeFrozenInputIds) {
      const input = inputs.find((i) => i.inputId === inputId);
      logTimelineEvent(
        this.idPrefix,
        `MP4 UNFREEZING ${input?.metadata.title ?? inputId.slice(0, 12)} (fade ${RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS}ms)`,
      );
      this.scheduleFrozenImageCleanup(inputId);
    }

    this.notifyStateChange();
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
    totalDurationMs: number;
  } {
    if (!this.timelinePlayer) {
      return {
        playheadMs: 0,
        isPlaying: false,
        isPaused: false,
        totalDurationMs: 0,
      };
    }
    return {
      playheadMs: this.timelinePlayer.getPlayheadMs(),
      isPlaying: this.timelinePlayer.isPlaying(),
      isPaused: this.timelinePlayer.getIsPaused(),
      totalDurationMs: this.timelinePlayer.getTotalDurationMs(),
    };
  }

  public getTimelineActiveInputIds(): string[] {
    if (!this.timelinePlayer) return [];
    return this.timelinePlayer.getActiveInputIdsAt(
      this.timelinePlayer.getPlayheadMs(),
    );
  }

  public addTimelineListener(listener: TimelineListener): () => void {
    this.timelineListeners.add(listener);
    return () => {
      this.timelineListeners.delete(listener);
    };
  }

  // ── Frozen image management ───────────────────────────────

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
      void this.mutex.runExclusive(() => this.cleanupFrozenImages([inputId]));
    }, delayMs);
    this.frozenImageCleanupTimers.set(inputId, timer);
  }

  private setFrozenImage(
    inputId: string,
    imageId: string,
    jpegPath: string,
  ): void {
    const previous = this.frozenImages.get(inputId);
    this.clearFrozenImageCleanupTimer(inputId);

    this.frozenImages.set(inputId, { imageId, jpegPath });
    this.output.store.getState().setInputFrozenImage(inputId, imageId);

    if (!previous) return;

    this.deferredUnregisterImage(previous.imageId, previous.jpegPath);
  }

  private cleanupFrozenImages(inputIds?: Iterable<string>): void {
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
      this.deferredUnregisterImage(imageId, jpegPath);
    }
  }

  private deferredUnregisterImage(imageId: string, jpegPath: string): void {
    const existing = this.pendingImageUnregisters.get(imageId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.pendingImageUnregisters.delete(imageId);
      SmelterInstance.unregisterImage(imageId).catch((err) => {
        console.error(`Failed to unregister frozen image ${imageId}`, err);
      });
      remove(jpegPath).catch(() => {});
    }, FROZEN_IMAGE_UNREGISTER_GRACE_MS);
    this.pendingImageUnregisters.set(imageId, { timer, jpegPath });
  }

  private async flushPendingImageUnregisters(): Promise<void> {
    for (const [imageId, { timer, jpegPath }] of this.pendingImageUnregisters) {
      clearTimeout(timer);
      try {
        await SmelterInstance.unregisterImage(imageId);
      } catch (err) {
        console.error(
          `Failed to flush-unregister frozen image ${imageId}`,
          err,
        );
      }
      try {
        await remove(jpegPath);
      } catch {
        // best-effort cleanup
      }
    }
    this.pendingImageUnregisters.clear();
  }

  // ── Room lifecycle ────────────────────────────────────────

  public async deleteRoom() {
    return this.mutex.runExclusive(async () => {
      this.destroyed = true;

      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;

      if (this.timelinePlayer) {
        this.timelinePlayer.destroy();
        this.timelinePlayer = null;
      }

      this.cleanupFrozenImages();
      await this.flushPendingImageUnregisters();

      await this.motionController.stopAll();
      await this.audioController.stopAll();
      await this.inputManager.destroyAll();

      try {
        await SmelterInstance.unregisterOutput(this.output.id);
      } catch (err: any) {
        console.error('Failed to remove output', err?.body ?? err);
      }

      await this.recordingController.cleanup();
    });
  }

  // ── Store sync ────────────────────────────────────────────

  private notifyStateChange() {
    for (const listener of this.stateChangeListeners) {
      try {
        listener();
      } catch {
        // best-effort notification
      }
    }
  }

  private updateStoreWithState() {
    if (this.destroyed) return;
    if (this.storeUpdateScheduled) return;
    this.storeUpdateScheduled = true;

    const elapsed = Date.now() - this.lastStoreFlushTime;
    if (elapsed >= RoomState.MIN_STORE_FLUSH_INTERVAL_MS) {
      queueMicrotask(() => this.flushStoreUpdate());
    } else {
      const delay = RoomState.MIN_STORE_FLUSH_INTERVAL_MS - elapsed;
      this.pendingStoreFlushTimer = setTimeout(() => {
        this.pendingStoreFlushTimer = null;
        this.flushStoreUpdate();
      }, delay);
    }
  }

  private flushStoreUpdate() {
    this.storeUpdateScheduled = false;
    this.lastStoreFlushTime = Date.now();
    if (this.destroyed) return;

    const allInputs = this.inputManager.getInputs();

    const toInputConfig = (input: RoomInputState): InputConfig => ({
      inputId: input.inputId,
      title: input.metadata.title,
      description: input.metadata.description,
      showTitle: input.showTitle,
      volume: input.volume,
      shaders: input.shaders,
      sourceWidth: input.type === 'local-mp4' ? input.mp4VideoWidth : undefined,
      sourceHeight:
        input.type === 'local-mp4' ? input.mp4VideoHeight : undefined,
      borderColor: input.borderColor,
      borderWidth: input.borderWidth,
      imageId:
        input.type === 'image' && !input.imageAssetMissing
          ? input.imageId
          : undefined,
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
      handsSourceInputId:
        input.type === 'hands' ? input.sourceInputId : undefined,
      handsStore: input.type === 'hands' ? input.handsStore : undefined,
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
      activeTransition: input.activeTransition,
      restartFading: input.restartFading,
      frozenImageId: this.frozenImages.get(input.inputId)?.imageId,
    });

    const connectedInputs = allInputs.filter(
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
            .map((id: string) => connectedMap.get(id))
            .filter((i: any): i is RoomInputState => !!i)
            .map(toInputConfig);
        }
        return config;
      });

    // Recompute positions for layers with a behavior config
    const behaviorInputInfos = this.collectBehaviorInputInfos();
    const inputMap = new Map(allInputs.map((i) => [i.inputId, i]));

    // Auto-append connected inputs that aren't in any layer to layers[0].
    // For a manual first layer, tile positions are filled in below using
    // equal-grid as a layout helper only (layer.behavior stays unset).
    const mentionedIds = new Set(
      this.layers.flatMap((l) => l.inputs.map((li) => li.inputId)),
    );
    const unplacedAttachedIds = new Set(
      allInputs
        .filter(
          (i) => i.status === 'connected' && !i.hidden && i.attachedInputIds,
        )
        .flatMap((i) => i.attachedInputIds ?? []),
    );
    const unplacedInputs = behaviorInputInfos.filter(
      (bi) =>
        !mentionedIds.has(bi.inputId) && !unplacedAttachedIds.has(bi.inputId),
    );
    let appendedUnplacedToFirstLayer = false;
    if (unplacedInputs.length > 0 && this.layers.length > 0) {
      const firstLayer = this.layers[0]!;
      for (const bi of unplacedInputs) {
        firstLayer.inputs.push({
          inputId: bi.inputId,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
      }
      appendedUnplacedToFirstLayer = true;
    }

    const manualFirstLayerLayoutHelper = {
      type: 'equal-grid' as const,
      autoscale: true,
    };

    this.layers = this.layers.map((layer, layerIndex) => {
      if (layer.behavior) {
        // Separate visible (non-hidden) and hidden inputs
        const visibleLayerInputs: typeof layer.inputs = [];
        const hiddenLayerInputs: typeof layer.inputs = [];

        for (const li of layer.inputs) {
          const input = inputMap.get(li.inputId);
          if (input?.hidden) {
            hiddenLayerInputs.push(li);
          } else {
            visibleLayerInputs.push(li);
          }
        }

        // Compute layout only for visible inputs, preserving layer order.
        // We build a lookup map from the global infos and then re-order by the
        // layer's own input sequence so that user reorderings are honoured.
        const behaviorInfoMap = new Map(
          behaviorInputInfos.map((bi) => [bi.inputId, bi]),
        );
        const visibleInputInfos = visibleLayerInputs
          .map((li) => behaviorInfoMap.get(li.inputId))
          .filter((bi): bi is BehaviorInputInfo => bi !== undefined);
        const result = computeLayout(
          layer.behavior,
          visibleInputInfos,
          this.output.resolution,
        );

        // Merge computed positions with hidden inputs
        return {
          ...layer,
          inputs: [...result.inputs, ...hiddenLayerInputs],
        };
      }

      if (
        layerIndex === 0 &&
        !layer.behavior &&
        appendedUnplacedToFirstLayer
      ) {
        const visibleLayerInputs: typeof layer.inputs = [];
        const hiddenLayerInputs: typeof layer.inputs = [];

        for (const li of layer.inputs) {
          const input = inputMap.get(li.inputId);
          if (input?.hidden) {
            hiddenLayerInputs.push(li);
          } else {
            visibleLayerInputs.push(li);
          }
        }

        const behaviorInfoMap = new Map(
          behaviorInputInfos.map((bi) => [bi.inputId, bi]),
        );
        const visibleInputInfos = visibleLayerInputs
          .map((li) => behaviorInfoMap.get(li.inputId))
          .filter((bi): bi is BehaviorInputInfo => bi !== undefined);
        const result = computeLayout(
          manualFirstLayerLayoutHelper,
          visibleInputInfos,
          this.output.resolution,
        );

        return {
          ...layer,
          inputs: [...result.inputs, ...hiddenLayerInputs],
        };
      }

      return layer;
    });

    this.output.store.getState().updateState({
      inputs: [...inputs].reverse(),
      layers: this.layers,
      swapDurationMs: this.swapDurationMs,
      swapOutgoingEnabled: this.swapOutgoingEnabled,
      swapFadeInDurationMs: this.swapFadeInDurationMs,
      newsStripFadeDuringSwap: this.newsStripFadeDuringSwap,
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
      newsStripEnabled: this.newsStripEnabled,
      viewportTop: this.viewportTop,
      viewportLeft: this.viewportLeft,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportTransitionDurationMs: this.viewportTransitionDurationMs,
      viewportTransitionEasing: this.viewportTransitionEasing,
    });

    this.notifyStateChange();
  }
}
