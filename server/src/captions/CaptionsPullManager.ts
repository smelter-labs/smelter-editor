import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StoreApi } from 'zustand';

import { SmelterInstance } from '../smelter';
import { captionTrace } from './captionsDebug';
import {
  CaptionsScene,
  createCaptionsPullStore,
  type CaptionsPullStore,
} from './CaptionsScene';

/**
 * Per-room hidden RTP output that renders InputStreams for inputs with
 * transcription enabled, so Smelter decodes their audio into the side channel.
 *
 * Like MotionManager and AudioManager, we spawn ffmpeg to consume the RTP
 * stream *before* registering the Smelter output. Without a downstream reader
 * the composition may not run (especially on macOS / ffmpeg encoder paths),
 * so the side-channel socket exists but never receives PCM.
 */
export class CaptionsPullManager {
  private static nextPort = 21000;
  private static readonly PORT_STRIDE = 2;
  private static readonly MAX_FFMPEG_RESTART_ATTEMPTS = 3;

  private readonly outputId: string;
  private readonly rtpPort: number;
  private readonly pullStore = createCaptionsPullStore();
  private trackedInputIds: string[] = [];
  private pipelineRunning = false;
  private ffmpegProcess: ChildProcess | null = null;
  private ffmpegRestartAttempts = 0;
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
    const ids = [...this.trackedInputIds];
    this.pullStore.getState().setInputIds(ids);
    captionTrace('pull store synced', {
      outputId: this.outputId,
      pipelineRunning: this.pipelineRunning,
      trackedInputIds: ids,
      storeInputIds: this.pullStore.getState().inputIds,
    });
  }

  private buildCaptionsPullSdp(): string {
    return (
      [
        'v=0',
        'o=- 0 0 IN IP4 127.0.0.1',
        's=CaptionsPull',
        'c=IN IP4 127.0.0.1',
        't=0 0',
        `m=video ${this.rtpPort} RTP/AVP 96`,
        'a=rtpmap:96 H264/90000',
        `m=audio ${this.rtpPort} RTP/AVP 111`,
        'a=rtpmap:111 opus/48000/2',
      ].join('\r\n') + '\r\n'
    );
  }

  private spawnFfmpegSink(): Promise<void> {
    const sdp = this.buildCaptionsPullSdp();
    console.log(
      `[captions] spawning ffmpeg RTP sink outputId=${this.outputId} rtpPort=${this.rtpPort}`,
    );

    const child = spawn(
      'ffmpeg',
      [
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-protocol_whitelist',
        'pipe,rtp,udp',
        '-f',
        'sdp',
        '-i',
        'pipe:0',
        '-f',
        'null',
        '-',
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );

    this.ffmpegProcess = child;
    child.stdin!.write(sdp);
    child.stdin!.end();

    child.on('exit', (code) => {
      console.log(
        `[captions] pull ffmpeg exited outputId=${this.outputId} code=${code}`,
      );
      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
      }
      if (!this.pipelineRunning || this.trackedInputIds.length === 0) {
        return;
      }
      if (
        this.ffmpegRestartAttempts >= CaptionsPullManager.MAX_FFMPEG_RESTART_ATTEMPTS
      ) {
        console.error(
          `[captions] pull ffmpeg restart limit reached outputId=${this.outputId}`,
        );
        return;
      }
      const delay = Math.min(
        1000 * Math.pow(2, this.ffmpegRestartAttempts),
        8000,
      );
      this.ffmpegRestartAttempts++;
      console.log(
        `[captions] restarting pull ffmpeg in ${delay}ms (attempt ${this.ffmpegRestartAttempts})`,
      );
      setTimeout(() => {
        if (this.pipelineRunning && this.trackedInputIds.length > 0) {
          void this.spawnFfmpegSink();
        }
      }, delay);
    });

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(
          `[captions] pull ffmpeg ready timeout outputId=${this.outputId}, proceeding`,
        );
        resolve();
      }, 3000);

      let resolved = false;
      const stderrRl = createInterface({ input: child.stderr! });
      stderrRl.on('line', (line) => {
        captionTrace('pull ffmpeg stderr', { outputId: this.outputId, line });
        if (!resolved && /^(SDP:|Input #|Stream mapping)/i.test(line)) {
          resolved = true;
          clearTimeout(timeout);
          setTimeout(resolve, 200);
        }
      });

      child.on('exit', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  private killFfmpeg(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
  }

  private async startPipeline(): Promise<void> {
    const t0 = Date.now();
    console.log(
      `[captions] starting pull output id=${this.outputId} rtpPort=${this.rtpPort}`,
    );

    await this.spawnFfmpegSink();

    await SmelterInstance.registerCaptionsPullOutput(
      this.outputId,
      this.pullStore,
      this.rtpPort,
    );
    this.pipelineRunning = true;
    this.ffmpegRestartAttempts = 0;
    captionTrace('pull output registered', {
      outputId: this.outputId,
      rtpPort: this.rtpPort,
      trackedInputIds: [...this.trackedInputIds],
      elapsedMs: Date.now() - t0,
    });
  }

  private async teardown(): Promise<void> {
    console.log(`[captions] stopping pull output id=${this.outputId}`);
    captionTrace('pull output teardown', {
      outputId: this.outputId,
      removedInputIds: [...this.trackedInputIds],
    });
    this.pipelineRunning = false;
    this.killFfmpeg();
    await SmelterInstance.unregisterCaptionsPullOutput(this.outputId);
  }
}

export type { CaptionsPullStore, StoreApi };
