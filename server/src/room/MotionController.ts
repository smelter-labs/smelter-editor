import { MotionManager } from '../motion/MotionManager';
import type { StoreApi } from 'zustand';
import type { HandsStore } from '../hands/handStore';
import type { RoomInputState } from './types';

/** Legacy MotionManager kept for hand-tracking grid pipeline only. */
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

  /** No-op — motion detection now runs via side-channel AI pipeline. */
  async startMotionDetection(
    _inputId: string,
    _onScore: (score: number) => void,
  ): Promise<void> {}

  /** No-op — motion detection now runs via side-channel AI pipeline. */
  async stopMotionDetection(_inputId: string): Promise<void> {}

  async startHandTracking(
    sourceInputId: string,
    handsStore: StoreApi<HandsStore>,
  ): Promise<void> {
    await this.motionManager.startHandTracking(sourceInputId, handsStore);
  }

  stopHandTracking(sourceInputId: string): void {
    this.motionManager.stopHandTracking(sourceInputId);
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
