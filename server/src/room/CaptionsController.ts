import { CaptionsPullManager } from '../captions/CaptionsPullManager';
import { captionTrace } from '../captions/captionsDebug';
import { supportsTranscription } from '../captions/constants';
import type { RoomInputState } from './types';

export class CaptionsController {
  private readonly pullManager: CaptionsPullManager;

  constructor(roomId: string) {
    this.pullManager = new CaptionsPullManager(roomId);
  }

  async setTranscriptionPull(
    input: RoomInputState,
    enabled: boolean,
  ): Promise<void> {
    const t0 = Date.now();
    if (!supportsTranscription(input.type)) {
      captionTrace('setTranscriptionPull skipped (unsupported type)', {
        inputId: input.inputId,
        type: input.type,
        enabled,
      });
      return;
    }
    if (enabled && input.status === 'connected' && input.transcription) {
      console.log(
        `[captions] setTranscriptionPull enabled inputId=${input.inputId}`,
      );
      captionTrace('setTranscriptionPull enabling', {
        inputId: input.inputId,
        type: input.type,
        status: input.status,
        transcription: input.transcription,
      });
      await this.pullManager.addInput(input.inputId);
      captionTrace('setTranscriptionPull enabled done', {
        inputId: input.inputId,
        elapsedMs: Date.now() - t0,
      });
      return;
    }
    captionTrace('setTranscriptionPull disabling', {
      inputId: input.inputId,
      type: input.type,
      status: input.status,
      transcription: input.transcription,
      enabled,
      reason:
        enabled && input.status !== 'connected'
          ? 'not_connected'
          : enabled && !input.transcription
            ? 'transcription_off'
            : 'explicit_disable',
    });
    await this.pullManager.removeInput(input.inputId);
  }

  async stopAll(): Promise<void> {
    await this.pullManager.stopAll();
  }

  /** Register the hidden pull output before any side channels appear. */
  async ensureReady(): Promise<void> {
    await this.pullManager.ensurePipeline();
  }
}
