import type { AIModelConfig } from '@smelter-editor/types';
import type { ModelManifest } from './registry';
import { ModelRegistry } from './registry';
import type { ModelResultEvent } from './base-sidecar';
import { BaseSidecar } from './base-sidecar';
import { computeSideChannelConfig } from './side-channel-config';
import type { RoomInputState } from '../room/types';
import { ensureMotionSidecarStarted } from './motion/motion-sidecar';
import { ensurePeopleCounterSidecarStarted } from './people-counter/people-counter-sidecar';
import { isPeopleCounterModel } from './people-counter/manifest';
import { ensureBuildingDetectorSidecarStarted } from './building-detector/building-detector-sidecar';
import { isBuildingDetectorModel } from './building-detector/manifest';
import { ensureCarAdsSidecarStarted } from './car-ads/car-ads-sidecar';
import { isCarAdsModel } from './car-ads/manifest';

export type ResultListener = (event: ModelResultEvent) => void;

type SidecarFactory = () => BaseSidecar;

const sidecarFactories: Record<string, SidecarFactory> = {
  motion: () => {
    throw new Error(
      'motion uses global singleton — call ensureMotionSidecarStarted',
    );
  },
};

/** Global sidecars shared across rooms (one Python process per model). */
const globalSidecars = new Map<string, BaseSidecar>();

export class RoomAIController {
  private readonly roomId: string;
  /** inputId → Set of enabled modelIds */
  private readonly inputModels = new Map<string, Set<string>>();
  private readonly resultListeners = new Map<string, Set<ResultListener>>();

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  getSideChannelConfig(input: RoomInputState) {
    return computeSideChannelConfig(input.aiModels ?? {}, input.transcription);
  }

  isModelEnabled(inputId: string, modelId: string): boolean {
    return this.inputModels.get(inputId)?.has(modelId) ?? false;
  }

  getEnabledModels(inputId: string): string[] {
    return [...(this.inputModels.get(inputId) ?? [])];
  }

  /** Sync tracking from input state (e.g. after load). */
  syncFromInput(input: RoomInputState): void {
    if (!input.aiModels) {
      input.aiModels = {};
    }

    // Backward compat: legacy motionEnabled flag
    if (input.motionEnabled && !input.aiModels.motion?.enabled) {
      const manifest = ModelRegistry.get('motion');
      input.aiModels.motion = {
        enabled: true,
        delayMs: manifest?.defaultDelayMs ?? 0,
      };
    }

    const models = input.aiModels;
    const enabled = new Set<string>();
    for (const [modelId, config] of Object.entries(models)) {
      if (config.enabled) enabled.add(modelId);
    }
    if (enabled.size > 0) {
      this.inputModels.set(input.inputId, enabled);
    } else {
      this.inputModels.delete(input.inputId);
    }
  }

  async enableModelOnInput(
    input: RoomInputState,
    modelId: string,
  ): Promise<void> {
    const manifest = ModelRegistry.get(modelId);
    if (!manifest) throw new Error(`Unknown model: ${modelId}`);

    if (!this.inputModels.has(input.inputId)) {
      this.inputModels.set(input.inputId, new Set());
    }
    this.inputModels.get(input.inputId)!.add(modelId);

    console.log(
      `[ai:${modelId}] enableModelOnInput room=${this.roomId} inputId=${input.inputId} status=${input.status}`,
    );

    if (input.status === 'connected') {
      await this.subscribeInputToModel(input, modelId);
    }
  }

  async disableModelOnInput(
    input: RoomInputState,
    modelId: string,
  ): Promise<void> {
    this.inputModels.get(input.inputId)?.delete(modelId);
    if (this.inputModels.get(input.inputId)?.size === 0) {
      this.inputModels.delete(input.inputId);
    }

    const sidecar = await this.getSidecarForModel(modelId);
    sidecar.removeInput(input.inputId);
  }

  async onInputConnected(input: RoomInputState): Promise<void> {
    this.syncFromInput(input);
    const models = this.inputModels.get(input.inputId);
    if (!models || models.size === 0) {
      console.log(
        `[ai] onInputConnected room=${this.roomId} inputId=${input.inputId} — no models enabled`,
      );
      return;
    }

    console.log(
      `[ai] onInputConnected room=${this.roomId} inputId=${input.inputId} models=[${[...models].join(',')}]`,
    );
    for (const modelId of models) {
      await this.subscribeInputToModel(input, modelId);
    }
  }

  async onInputDisconnected(inputId: string): Promise<void> {
    const models = this.inputModels.get(inputId);
    if (!models) return;

    for (const modelId of models) {
      const sidecar = await this.getSidecarForModel(modelId);
      sidecar.removeInput(inputId);
      sidecar.notifySideChannelStopped(inputId);
    }
  }

  onSideChannelReady(inputId: string): void {
    const models = this.inputModels.get(inputId);
    if (!models || models.size === 0) {
      console.log(
        `[ai] onSideChannelReady room=${this.roomId} inputId=${inputId} — no models tracked, skipping`,
      );
      return;
    }

    console.log(
      `[ai] onSideChannelReady room=${this.roomId} inputId=${inputId} models=[${[...models].join(',')}]`,
    );
    for (const modelId of models) {
      void this.getSidecarForModel(modelId).then((sidecar) => {
        sidecar.notifySideChannelReady(inputId);
      });
    }
  }

  addResultListener(modelId: string, listener: ResultListener): () => void {
    if (!this.resultListeners.has(modelId)) {
      this.resultListeners.set(modelId, new Set());
    }
    this.resultListeners.get(modelId)!.add(listener);
    return () => {
      this.resultListeners.get(modelId)?.delete(listener);
    };
  }

  /** Wire sidecar result events to room listeners. Call once at room init. */
  async wireSidecarListeners(
    modelId: string,
    onResult: (event: ModelResultEvent) => void,
  ): Promise<void> {
    const sidecar = await this.getSidecarForModel(modelId);
    sidecar.on('result', (event: ModelResultEvent) => {
      if (event.modelId !== modelId) return;
      onResult(event);
      const listeners = this.resultListeners.get(modelId);
      if (listeners) {
        for (const l of listeners) l(event);
      }
    });
  }

  async destroy(): Promise<void> {
    for (const [inputId] of this.inputModels) {
      await this.onInputDisconnected(inputId);
    }
    this.inputModels.clear();
  }

  /**
   * The params record actually sent to the worker: the stored model params plus
   * the authoritative side-channel delay. The worker needs the delay to time
   * lookahead work (marker interpolation reports results for a source-time in
   * the past, and the presentation hold in RoomState is computed against the
   * REGISTERED delay — which for WHIP is pinned and can differ from the
   * config's delayMs). Injected here, at send time, so the stored config stays
   * untouched and the paramsChanged comparison never sees this key. Every path
   * that changes the registered delay ends in a re-subscribe, which re-runs
   * this, so the worker's copy stays fresh.
   */
  private workerParams(
    input: RoomInputState,
    modelId: string,
  ): Record<string, number | string> {
    const cfg = input.aiModels?.[modelId];
    return {
      ...(cfg?.params ?? {}),
      delayMs: input.registeredSideChannelDelayMs ?? cfg?.delayMs ?? 0,
    };
  }

  private async subscribeInputToModel(
    input: RoomInputState,
    modelId: string,
  ): Promise<void> {
    const sidecar = await this.getSidecarForModel(modelId);
    sidecar.addInput(input.inputId, this.workerParams(input, modelId));
  }

  /** Push updated model params to the running worker without re-subscribing. */
  async configureModelOnInput(
    input: RoomInputState,
    modelId: string,
  ): Promise<void> {
    const sidecar = await this.getSidecarForModel(modelId);
    sidecar.configureInput(input.inputId, this.workerParams(input, modelId));
  }

  private async getSidecarForModel(modelId: string): Promise<BaseSidecar> {
    if (modelId === 'motion') {
      return ensureMotionSidecarStarted();
    }
    if (isPeopleCounterModel(modelId)) {
      return ensurePeopleCounterSidecarStarted(modelId);
    }
    if (isBuildingDetectorModel(modelId)) {
      return ensureBuildingDetectorSidecarStarted();
    }
    if (isCarAdsModel(modelId)) {
      return ensureCarAdsSidecarStarted(modelId);
    }

    let sidecar = globalSidecars.get(modelId);
    if (!sidecar) {
      const factory = sidecarFactories[modelId];
      if (!factory) {
        throw new Error(`No sidecar factory for model: ${modelId}`);
      }
      sidecar = factory();
      await sidecar.start();
      globalSidecars.set(modelId, sidecar);
    }
    return sidecar;
  }
}

export function manifestSupportsInput(
  manifest: ModelManifest,
  input: RoomInputState,
): boolean {
  return manifest.supportedInputTypes.includes(input.type);
}

export function defaultAIModelConfig(manifest: ModelManifest): AIModelConfig {
  return {
    enabled: false,
    delayMs: manifest.defaultDelayMs,
  };
}
