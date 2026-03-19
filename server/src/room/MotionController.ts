import { MotionManager } from '../motion/MotionManager';
import type { RoomInputState } from './types';

const VIDEO_INPUT_TYPES: RoomInputState['type'][] = [
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'whip',
];

export class MotionController {
  private readonly motionManager: MotionManager;
  private readonly motionScoreListeners = new Set<
    (scores: Record<string, number>) => void
  >();

  constructor(
    idPrefix: string,
    private readonly getInputs: () => RoomInputState[],
  ) {
    this.motionManager = new MotionManager(idPrefix);
  }

  async startMotionDetection(
    inputId: string,
    onScore: (score: number) => void,
  ): Promise<void> {
    await this.motionManager.startMotionDetection(inputId, onScore);
  }

  async stopMotionDetection(inputId: string): Promise<void> {
    await this.motionManager.stopMotionDetection(inputId);
  }

  async setMotionEnabled(
    input: RoomInputState,
    enabled: boolean,
  ): Promise<void> {
    input.motionEnabled = enabled;
    if (
      enabled &&
      input.status === 'connected' &&
      VIDEO_INPUT_TYPES.includes(input.type)
    ) {
      try {
        console.log(
          `[motion][setMotionEnabled] starting for inputId=${input.inputId} type=${input.type} title="${input.metadata.title}"`,
        );
        await this.motionManager.startMotionDetection(
          input.inputId,
          (score) => {
            if (score === -1) {
              input.motionScore = undefined;
            } else {
              input.motionScore = score;
            }
            this.emitMotionScores();
          },
        );
      } catch (err) {
        console.error(
          `[motion] Failed to start motion detection for ${input.inputId}`,
          err,
        );
      }
    } else if (!enabled) {
      await this.motionManager.stopMotionDetection(input.inputId);
      input.motionScore = undefined;
      this.emitMotionScores();
    }
  }

  async stopAll(): Promise<void> {
    await this.motionManager.stopAll();
  }

  addMotionScoreListener(
    listener: (scores: Record<string, number>) => void,
  ): () => void {
    this.motionScoreListeners.add(listener);
    return () => {
      this.motionScoreListeners.delete(listener);
    };
  }

  emitMotionScores(): void {
    if (this.motionScoreListeners.size === 0) return;
    const scores: Record<string, number> = {};
    for (const input of this.getInputs()) {
      if (input.motionScore !== undefined) {
        scores[input.inputId] = input.motionScore;
      }
    }
    for (const listener of this.motionScoreListeners) {
      listener(scores);
    }
  }
}
