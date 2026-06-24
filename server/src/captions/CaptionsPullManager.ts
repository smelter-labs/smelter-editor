import type { StoreApi } from 'zustand';

import { SmelterInstance } from '../smelter';
import {
  CaptionsScene,
  createCaptionsPullStore,
  type CaptionsPullStore,
} from './CaptionsScene';

/**
 * Per-room hidden RTP output that renders InputStreams for inputs with
 * transcription enabled, so Smelter decodes their audio into the side channel.
 */
export class CaptionsPullManager {
  private static nextPort = 21000;
  private static readonly PORT_STRIDE = 2;

  private readonly outputId: string;
  private readonly rtpPort: number;
  private readonly pullStore = createCaptionsPullStore();
  private trackedInputIds: string[] = [];
  private pipelineRunning = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(roomId: string) {
    this.outputId = `captions::pull::${roomId}`;
    this.rtpPort = CaptionsPullManager.nextPort;
    CaptionsPullManager.nextPort += CaptionsPullManager.PORT_STRIDE;
  }

  async addInput(inputId: string): Promise<void> {
    if (this.trackedInputIds.includes(inputId)) return;
    const prev = this.queue;
    this.queue = prev
      .then(() => this._addInput(inputId))
      .catch((err) => {
        console.error(
          `[captions] pull addInput failed inputId=${inputId}`,
          err,
        );
      });
    await this.queue;
  }

  async ensurePipeline(): Promise<void> {
    const prev = this.queue;
    this.queue = prev
      .then(() => this._ensurePipeline())
      .catch((err) => {
        console.error('[captions] pull ensurePipeline failed', err);
      });
    await this.queue;
  }

  private async _ensurePipeline(): Promise<void> {
    if (this.pipelineRunning) return;
    await this.startPipeline();
  }

  async removeInput(inputId: string): Promise<void> {
    if (!this.trackedInputIds.includes(inputId)) return;
    const prev = this.queue;
    this.queue = prev
      .then(() => this._removeInput(inputId))
      .catch((err) => {
        console.error(
          `[captions] pull removeInput failed inputId=${inputId}`,
          err,
        );
      });
    await this.queue;
  }

  async stopAll(): Promise<void> {
    const ids = [...this.trackedInputIds];
    for (const id of ids) {
      await this.removeInput(id);
    }
  }

  private async _addInput(inputId: string): Promise<void> {
    this.trackedInputIds.push(inputId);
    this.syncStore();
    if (!this.pipelineRunning) {
      await this.startPipeline();
    }
    console.log(
      `[captions] pull output tracking inputId=${inputId} (${this.trackedInputIds.length} total)`,
    );
  }

  private async _removeInput(inputId: string): Promise<void> {
    this.trackedInputIds = this.trackedInputIds.filter((id) => id !== inputId);
    this.syncStore();
    console.log(
      `[captions] pull output removed inputId=${inputId} (${this.trackedInputIds.length} remaining)`,
    );
    if (this.trackedInputIds.length === 0 && this.pipelineRunning) {
      await this.teardown();
    }
  }

  private syncStore(): void {
    this.pullStore.getState().setInputIds([...this.trackedInputIds]);
  }

  private async startPipeline(): Promise<void> {
    console.log(
      `[captions] starting pull output id=${this.outputId} rtpPort=${this.rtpPort}`,
    );
    await SmelterInstance.registerCaptionsPullOutput(
      this.outputId,
      this.pullStore,
      this.rtpPort,
    );
    this.pipelineRunning = true;
  }

  private async teardown(): Promise<void> {
    console.log(`[captions] stopping pull output id=${this.outputId}`);
    this.pipelineRunning = false;
    await SmelterInstance.unregisterCaptionsPullOutput(this.outputId);
  }
}

export type { CaptionsPullStore, StoreApi };
