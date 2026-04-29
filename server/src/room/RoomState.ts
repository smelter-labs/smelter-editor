import path from 'node:path';
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
import { isSmelterTransportError } from '../smelterTransportError';

import { InputManager } from './InputManager';
import { RecordingController } from './RecordingController';
import { MotionController } from './MotionController';
import { SnakeGameController } from './SnakeGameController';
import { PlaceholderManager } from './PlaceholderManager';
import { AudioController } from '../audio/AudioController';
import type { AudioStoreState } from '../audio/audioStore';
import type { StoreApi } from 'zustand';
import { DATA_DIR } from '../dataDir';
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
const AUDIO_ASSETS_DIR = path.join(DATA_DIR, 'audios');

function cloneLayers(layers: Layer[]): Layer[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(layers);
  }
  return JSON.parse(JSON.stringify(layers)) as Layer[];
}

function sanitizeLayerInputs(layers: Layer[]): Layer[] {
  return layers.map((layer) => {
    const seenInputIds = new Set<string>();
    const inputs = layer.inputs.filter((input) => {
      if (seenInputIds.has(input.inputId)) {
        return false;
      }
      seenInputIds.add(input.inputId);
      return true;
    });

    if (inputs.length === layer.inputs.length) {
      return layer;
    }

    return {
      ...layer,
      inputs,
    };
  });
}

function normalizeFramePositionMs(
  requestedMs: number,
  isLooped: boolean,
  durationMs?: number,
): number {
  let normalized = Math.max(0, requestedMs);
  if (durationMs && durationMs > 0) {
    if (isLooped) {
      normalized = normalized % durationMs;
    } else {
      normalized = Math.min(normalized, Math.max(0, durationMs - 1));
    }
  }
  return normalized;
}

function isAudioBackedLocalMp4(mp4FilePath: string): boolean {
  const relativeToAudioDir = path.relative(AUDIO_ASSETS_DIR, mp4FilePath);
  return (
    relativeToAudioDir !== '' &&
    !relativeToAudioDir.startsWith('..') &&
    !path.isAbsolute(relativeToAudioDir)
  );
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
  private pausedAttachedInputVolumes = new Map<string, number>();

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
  private _restoringTimeline = false;
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
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
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
      this.setLayersAndSyncInputState(layers);

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
   * Restore layers from a timeline snapshot without auto-appending unplaced
   * inputs or re-tiling manual layers with the equal-grid helper.
   */
  public async restoreLayers(layers: Layer[]) {
    return this.mutex.runExclusive(async () => {
      this.setLayersAndSyncInputState(layers);

      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;
      this.flushStoreUpdate(true);
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

      let layersUpdated = false;
      this.layers = this.layers.map((layer) => {
        const filteredInputs = layer.inputs.filter(
          (input) => input.inputId !== inputId,
        );
        if (filteredInputs.length === layer.inputs.length) {
          return layer;
        }

        layersUpdated = true;
        return {
          ...layer,
          inputs: filteredInputs,
        };
      });

      if (layersUpdated) {
        this.updateStoreWithState();
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
        // `null` resets the corresponding field on LayerInput to `undefined`
        // to stay consistent with InputManager.updateInput (absolute/crop
        // reset semantics). LayerInput declares `x`/`y`/`width`/`height` as
        // required `number`s, so we widen via a Record cast when clearing
        // them — Phase 2 of timeline restoreState replaces all layers, so
        // this transient undefined state is bounded to the restore window.
        for (const layer of this.layers) {
          for (const li of layer.inputs) {
            if (li.inputId !== inputId) continue;
            const liRecord = li as Record<string, unknown>;
            if (options.absoluteLeft !== undefined)
              liRecord.x =
                options.absoluteLeft === null
                  ? undefined
                  : options.absoluteLeft;
            if (options.absoluteTop !== undefined)
              liRecord.y =
                options.absoluteTop === null ? undefined : options.absoluteTop;
            if (options.absoluteWidth !== undefined)
              liRecord.width =
                options.absoluteWidth === null
                  ? undefined
                  : options.absoluteWidth;
            if (options.absoluteHeight !== undefined)
              liRecord.height =
                options.absoluteHeight === null
                  ? undefined
                  : options.absoluteHeight;
            if (options.absoluteTransitionDurationMs !== undefined)
              li.transitionDurationMs =
                options.absoluteTransitionDurationMs === null
                  ? undefined
                  : options.absoluteTransitionDurationMs;
            if (options.absoluteTransitionEasing !== undefined)
              li.transitionEasing =
                options.absoluteTransitionEasing === null
                  ? undefined
                  : options.absoluteTransitionEasing;
            if (options.cropTop !== undefined)
              li.cropTop =
                options.cropTop === null ? undefined : options.cropTop;
            if (options.cropLeft !== undefined)
              li.cropLeft =
                options.cropLeft === null ? undefined : options.cropLeft;
            if (options.cropRight !== undefined)
              li.cropRight =
                options.cropRight === null ? undefined : options.cropRight;
            if (options.cropBottom !== undefined)
              li.cropBottom =
                options.cropBottom === null ? undefined : options.cropBottom;
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

  public batchHideInputs(
    inputIds: string[],
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      // Hide all inputs under a single lock
      for (const inputId of inputIds) {
        this.inputManager.hideInput(inputId, activeTransition);
      }
    });
  }

  public batchShowInputs(
    inputIds: string[],
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      // Show all inputs under a single lock
      for (const inputId of inputIds) {
        this.inputManager.showInput(inputId, activeTransition);
      }
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
      restoreLayers: (layers) => this.restoreLayers(layers),
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
    this.timelinePlayer.onPlaybackEnded = () => {
      void this.stopTimelinePlayback().catch((err) =>
        console.error('[timeline] natural-end stop failed', err),
      );
    };

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
    this.timelinePlayer.onPlaybackEnded = () => {
      void this.stopTimelinePlayback().catch((err) =>
        console.error('[timeline] natural-end stop failed', err),
      );
    };

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
      if (isAudioBackedLocalMp4(input.mp4FilePath)) {
        continue;
      }

      const basePlayFrom = clip.blockSettings.mp4PlayFromMs ?? 0;
      const isLooped = clip.blockSettings.mp4Loop !== false;
      const framePositionMs = normalizeFramePositionMs(
        basePlayFrom + (playheadMs - clip.startMs),
        isLooped,
        input.mp4DurationMs,
      );

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
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Skipping scrub frozen frame for ${inputId} while Smelter is recovering`,
          );
        } else {
          console.error(
            `[timeline] Failed to extract frame for ${inputId} at scrub position`,
            err,
          );
        }
      }
    }
  }

  public async stopTimelinePlayback(): Promise<void> {
    if (!this.timelinePlayer) return;
    this.pausedAttachedInputVolumes.clear();
    this.cleanupFrozenImages();
    this._restoringTimeline = true;
    try {
      await this.timelinePlayer.stop();
    } finally {
      this._restoringTimeline = false;
    }
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
    const inputById = new Map(inputs.map((input) => [input.inputId, input]));
    const activeInputIds = new Set(activeClips.keys());
    const attachedInputIds = this.collectAttachedInputIds(
      activeInputIds,
      inputById,
    );

    this.pausedAttachedInputVolumes.clear();
    for (const attachedInputId of attachedInputIds) {
      if (activeInputIds.has(attachedInputId)) continue;
      const attachedInput = inputById.get(attachedInputId);
      if (!attachedInput) continue;
      this.pausedAttachedInputVolumes.set(
        attachedInputId,
        attachedInput.volume,
      );
      this.inputManager.updateInput(attachedInputId, { volume: 0 });
    }

    for (const [inputId, clip] of activeClips) {
      const input = inputById.get(inputId);
      if (!input) continue;

      // Pause should freeze the soundscape as well as the visuals.
      this.inputManager.updateInput(inputId, { volume: 0 });

      if (input.type !== 'local-mp4') continue;
      if (isAudioBackedLocalMp4(input.mp4FilePath)) {
        continue;
      }
      const isLooped = clip.blockSettings.mp4Loop !== false;
      if (isLooped) {
        continue;
      }

      const framePositionMs = normalizeFramePositionMs(
        (input.playFromMs ?? 0) +
          (currentPipelineMs -
            (input.registeredAtPipelineMs ?? currentPipelineMs)),
        isLooped,
        input.mp4DurationMs,
      );

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
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Skipping pause frozen frame for ${inputId} while Smelter is recovering`,
          );
        } else {
          console.error(
            `[timeline] Failed to extract frame for ${inputId}`,
            err,
          );
        }
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

    for (const [inputId, volume] of this.pausedAttachedInputVolumes) {
      this.inputManager.updateInput(inputId, { volume });
    }
    this.pausedAttachedInputVolumes.clear();

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

  private collectAttachedInputIds(
    rootInputIds: Iterable<string>,
    inputById: Map<string, RoomInputState>,
  ): Set<string> {
    const visited = new Set<string>();
    const queue = [...new Set(rootInputIds)];

    while (queue.length > 0) {
      const inputId = queue.shift()!;
      if (visited.has(inputId)) continue;
      visited.add(inputId);
      const input = inputById.get(inputId);
      const attachedInputIds = input?.attachedInputIds ?? [];
      for (const attachedInputId of attachedInputIds) {
        if (!visited.has(attachedInputId)) {
          queue.push(attachedInputId);
        }
      }
    }

    return visited;
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
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Frozen image unregister skipped during Smelter recovery imageId=${imageId}`,
          );
          return;
        }
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
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Frozen image flush-unregister skipped during Smelter recovery imageId=${imageId}`,
          );
        } else {
          console.error(
            `Failed to flush-unregister frozen image ${imageId}`,
            err,
          );
        }
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
      this.pausedAttachedInputVolumes.clear();

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

  private flushStoreUpdate(skipUnplacedAppend = false) {
    if (this._restoringTimeline) {
      skipUnplacedAppend = true;
    }
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
      textScrollEnabled:
        input.type === 'text-input' ? input.textScrollEnabled : undefined,
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
      hidden: input.hidden,
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
    // For a manual first layer, we prefer existing absolute coordinates from
    // input state to avoid re-tiling on timeline source swaps.
    // If geometry is unknown, use output-sized fallback geometry for only the
    // newly added input, without re-tiling already positioned manual inputs.
    // Skipped during timeline snapshot restore to preserve exact manual
    // positions.
    if (!skipUnplacedAppend) {
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
      if (unplacedInputs.length > 0 && this.layers.length > 0) {
        const firstLayer = this.layers[0]!;
        const isManualFirstLayer = !firstLayer.behavior;
        for (const bi of unplacedInputs) {
          const input = inputMap.get(bi.inputId);
          const hasAbsoluteGeometry =
            input?.absoluteLeft !== undefined &&
            input?.absoluteTop !== undefined &&
            input?.absoluteWidth !== undefined &&
            input?.absoluteHeight !== undefined;

          if (isManualFirstLayer && hasAbsoluteGeometry) {
            const absoluteInput = input as RoomInputState & {
              absoluteLeft: number;
              absoluteTop: number;
              absoluteWidth: number;
              absoluteHeight: number;
            };
            firstLayer.inputs.push({
              inputId: bi.inputId,
              x: absoluteInput.absoluteLeft,
              y: absoluteInput.absoluteTop,
              width: absoluteInput.absoluteWidth,
              height: absoluteInput.absoluteHeight,
              transitionDurationMs: absoluteInput.absoluteTransitionDurationMs,
              transitionEasing: absoluteInput.absoluteTransitionEasing,
              cropTop: absoluteInput.cropTop,
              cropLeft: absoluteInput.cropLeft,
              cropRight: absoluteInput.cropRight,
              cropBottom: absoluteInput.cropBottom,
            });
            continue;
          }

          const fallbackWidth =
            input?.absoluteWidth ??
            input?.nativeWidth ??
            this.output.resolution.width;
          const fallbackHeight =
            input?.absoluteHeight ??
            input?.nativeHeight ??
            this.output.resolution.height;
          firstLayer.inputs.push({
            inputId: bi.inputId,
            x: input?.absoluteLeft ?? 0,
            y: input?.absoluteTop ?? 0,
            width: fallbackWidth,
            height: fallbackHeight,
            transitionDurationMs: input?.absoluteTransitionDurationMs,
            transitionEasing: input?.absoluteTransitionEasing,
            cropTop: input?.cropTop,
            cropLeft: input?.cropLeft,
            cropRight: input?.cropRight,
            cropBottom: input?.cropBottom,
          });
        }
      }
    }

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

        // Merge computed positions back in the original layer.inputs order
        // so that hidden inputs keep their position instead of being pushed
        // to the end (which would break reorderInputs ordering).
        const computedMap = new Map(
          result.inputs.map((li) => [li.inputId, li]),
        );
        return {
          ...layer,
          inputs: layer.inputs
            .map((li) => computedMap.get(li.inputId) ?? li)
            .filter(
              (li) =>
                computedMap.has(li.inputId) || inputMap.get(li.inputId)?.hidden,
            ),
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
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
      viewportTop: this.viewportTop,
      viewportLeft: this.viewportLeft,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportTransitionDurationMs: this.viewportTransitionDurationMs,
      viewportTransitionEasing: this.viewportTransitionEasing,
    });

    this.notifyStateChange();
  }

  private setLayersAndSyncInputState(layers: Layer[]): void {
    if (layers.length === 0) {
      throw new Error('layers must not be empty');
    }

    const cloned = cloneLayers(layers);
    const sanitized = sanitizeLayerInputs(cloned);
    this.layers = sanitized;

    // Sync position, transition, and crop properties from layer entries back
    // to input state so the editor's controllers stay consistent.
    // The first layer that contains an input is authoritative.
    const allInputs = this.inputManager.getInputs();
    const seen = new Set<string>();
    for (const layer of sanitized) {
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
  }
}
