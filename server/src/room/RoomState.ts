import { remove } from 'fs-extra';
import { Mutex } from 'async-mutex';
import { SmelterInstance, type SmelterOutput } from '../smelter';
import type { InputConfig } from '../app/store';
import type { Layout } from '../types';
import type { SnakeEventType } from '../snakeGame/types';
import type { RoomNameEntry } from '../server/roomNames';
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
import type { RoomInputState, RegisterInputOptions } from './types';

const RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS = 5500;

export class RoomState {
  private readonly mutex = new Mutex();
  private destroyed = false;

  private readonly inputManager: InputManager;
  private readonly recordingController: RecordingController;
  private readonly motionController: MotionController;
  private readonly snakeGameController: SnakeGameController;
  private readonly placeholderManager: PlaceholderManager;

  private timelinePlayer: TimelinePlayer | null = null;
  private timelineListeners = new Set<TimelineListener>();

  private frozenImages: Map<string, { imageId: string; jpegPath: string }> =
    new Map();
  private frozenImageCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private layout: Layout = 'picture-in-picture';
  private swapDurationMs: number = 500;
  private swapOutgoingEnabled: boolean = true;
  private swapFadeInDurationMs: number = 500;
  private swapFadeOutDurationMs: number = 500;
  private newsStripFadeDuringSwap: boolean = true;
  private newsStripEnabled: boolean = false;

  public idPrefix: string;
  private output: SmelterOutput;

  public lastReadTimestamp: number;
  public creationTimestamp: number;
  public pendingDelete?: boolean;
  public isPublic: boolean = true;
  public pendingWhipInputs: import('./types').PendingWhipInputData[] = [];
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
    this.motionController = new MotionController(
      idPrefix,
      () => this.inputManager.getInputs(),
    );
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

  // ── Output accessors ──────────────────────────────────────

  public getWhepUrl(): string {
    return this.output.url;
  }

  public getResolution(): { width: number; height: number } {
    return this.output.resolution;
  }

  // ── State snapshot ────────────────────────────────────────

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
      this.inputManager.getInputs(),
      this.layout,
      this.swapDurationMs,
      this.swapOutgoingEnabled,
      this.swapFadeInDurationMs,
      this.newsStripFadeDuringSwap,
      this.swapFadeOutDurationMs,
      this.newsStripEnabled,
    ];
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

  public async updateLayout(layout: Layout) {
    return this.mutex.runExclusive(async () => {
      this.layout = layout;
      this.updateStoreWithState();
    });
  }

  // ── Input operations (mutex-wrapped delegation) ───────────

  public async addNewInput(opts: RegisterInputOptions) {
    return this.mutex.runExclusive(() => this.inputManager.addNewInput(opts));
  }

  public async removeInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(() => this.inputManager.removeInput(inputId));
  }

  public async connectInput(inputId: string): Promise<string> {
    return this.mutex.runExclusive(() =>
      this.inputManager.connectInput(inputId),
    );
  }

  public async disconnectInput(inputId: string) {
    return this.mutex.runExclusive(() =>
      this.inputManager.disconnectInput(inputId),
    );
  }

  public async updateInput(
    inputId: string,
    options: Partial<import('./types').UpdateInputOptions>,
  ) {
    return this.mutex.runExclusive(async () => {
      this.inputManager.updateInput(inputId, options);
    });
  }

  public reorderInputs(inputOrder: string[]) {
    return this.mutex.runExclusive(() => {
      this.inputManager.reorderInputs(inputOrder);
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

  public addMotionScoreListener(
    listener: (scores: Record<string, number>) => void,
  ): () => void {
    return this.motionController.addMotionScoreListener(listener);
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

        await this.setFrozenImage(inputId, frozenId, jpegPath);
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

        await this.setFrozenImage(inputId, frozenId, jpegPath);
        logTimelineEvent(
          this.idPrefix,
          `MP4 FROZEN (pause) ${input.metadata.title} at ${Math.round(framePositionMs)}ms`,
        );
      } catch (err) {
        console.error(
          `[timeline] Failed to extract frame for ${inputId}`,
          err,
        );
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

    logTimelineEvent(
      this.idPrefix,
      `RESUME at ${Math.round(resumeMs)}ms (${activeFrozenInputIds.size} frozen MP4s)`,
    );

    await this.timelinePlayer.resume(fromMs);

    const inactiveFrozenInputIds = [...this.frozenImages.keys()].filter(
      (inputId) => !activeFrozenInputIds.has(inputId),
    );
    await this.cleanupFrozenImages(inactiveFrozenInputIds);

    const inputs = this.inputManager.getInputs();
    for (const inputId of activeFrozenInputIds) {
      const input = inputs.find((i) => i.inputId === inputId);
      logTimelineEvent(
        this.idPrefix,
        `MP4 UNFREEZING ${input?.metadata.title ?? inputId.slice(0, 12)} (fade ${RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS}ms)`,
      );
      this.scheduleFrozenImageCleanup(inputId);
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

  // ── Room lifecycle ────────────────────────────────────────

  public async deleteRoom() {
    return this.mutex.runExclusive(async () => {
      this.destroyed = true;

      if (this.timelinePlayer) {
        this.timelinePlayer.destroy();
        this.timelinePlayer = null;
      }

      await this.cleanupFrozenImages();

      await this.motionController.stopAll();
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

  private updateStoreWithState() {
    if (this.destroyed) return;

    const allInputs = this.inputManager.getInputs();

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
      snakeGameState:
        input.type === 'game' ? input.snakeGameState : undefined,
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
}
