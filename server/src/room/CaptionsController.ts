import { CaptionsPullManager } from '../captions/CaptionsPullManager';
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
    if (!supportsTranscription(input.type)) return;
    if (enabled && input.status === 'connected' && input.transcription) {
      console.log(
        `[captions] setTranscriptionPull enabled inputId=${input.inputId}`,
      );
      await this.pullManager.addInput(input.inputId);
      return;
    }
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
