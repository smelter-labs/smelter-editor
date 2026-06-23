import { clampPaddleY } from '../constants';
import type { GameState, Paddle, Side } from '../types';

export type ExternalInputs = {
  keyboard: { upHeld: boolean; downHeld: boolean };
  mouse: { y: number | null };
};

// An intent the controller produces each tick. `applyIntent` consumes it.
export type PaddleIntent =
  | { kind: 'absolute'; targetY: number; maxSpeed: number }
  | { kind: 'relative'; direction: -1 | 0 | 1; maxSpeed: number };

export interface PaddleController {
  update(dt: number, state: GameState, side: Side, inputs: ExternalInputs): PaddleIntent;
  reset?(): void;
}

export function applyIntent(paddle: Paddle, intent: PaddleIntent, dt: number): Paddle {
  let newY = paddle.y;
  const maxStep = intent.maxSpeed * dt;

  if (intent.kind === 'absolute') {
    const delta = intent.targetY - paddle.y;
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    newY = paddle.y + step;
  } else {
    newY = paddle.y + intent.direction * maxStep;
  }

  return { y: clampPaddleY(newY) };
}
