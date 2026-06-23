import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../ai-difficulty';
import { AiController } from '../controllers/ai';
import type { ExternalInputs } from '../controllers/types';
import type { GameState } from '../types';

const noInputs: ExternalInputs = {
  keyboard: { upHeld: false, downHeld: false },
  mouse: { y: null },
};

function stateAt(now: number, ball: Partial<GameState['ball']> = {}): GameState {
  return {
    ball: { x: 0.5, y: 0.5, vx: 0.5, vy: 0, ...ball },
    paddles: { left: { y: 0.5 }, right: { y: 0.5 } },
    score: { left: 0, right: 0 },
    phase: 'playing',
    phaseTime: 0,
    now,
    servingSide: 'right',
    lastWinner: null,
    lastBounce: null,
  };
}

describe('AiController', () => {
  it('hard AI tracks predicted ball Y with low noise', () => {
    const ai = new AiController(DIFFICULTY.hard, 1);
    const s = stateAt(0, { x: 0.3, y: 0.5, vx: 0.5, vy: 0.1 });
    const intent = ai.update(1 / 60, s, 'right', noInputs);
    expect(intent.kind).toBe('absolute');
    if (intent.kind === 'absolute') {
      // Right paddle is at x ≈ 0.95. From (0.3, 0.5) at vy=0.1, vx=0.5:
      // dx ≈ 0.65, dt ≈ 1.3, dy ≈ 0.13 → predicted y ≈ 0.63 (+/- small noise).
      expect(intent.targetY).toBeGreaterThan(0.55);
      expect(intent.targetY).toBeLessThan(0.7);
      expect(intent.maxSpeed).toBe(DIFFICULTY.hard.maxSpeed);
    }
  });

  it('easy AI delays response by reaction lag', () => {
    const ai = new AiController(DIFFICULTY.easy, 2);
    // Feed ball at y=0.5 for some time so history has stale samples.
    for (let t = 0; t < 0.4; t += 1 / 60) {
      ai.update(1 / 60, stateAt(t, { x: 0.3, y: 0.5, vx: 0.5 }), 'right', noInputs);
    }
    // Suddenly move the ball way up.
    const intent = ai.update(
      1 / 60,
      stateAt(0.45, { x: 0.4, y: 0.1, vx: 0.5 }),
      'right',
      noInputs,
    );
    // Lag is 0.3s, so AI should still be seeing y near 0.5, not 0.1.
    if (intent.kind === 'absolute') {
      expect(intent.targetY).toBeGreaterThan(0.3);
    }
  });

  it('reset clears history and bounce tracking', () => {
    const ai = new AiController(DIFFICULTY.medium, 3);
    ai.update(1 / 60, stateAt(0), 'right', noInputs);
    ai.reset();
    // After reset, should behave like a brand-new controller — no throw.
    const intent = ai.update(1 / 60, stateAt(0.1), 'right', noInputs);
    expect(intent).toBeDefined();
  });
});
