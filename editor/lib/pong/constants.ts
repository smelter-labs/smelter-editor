// All coordinates are in normalized UV space [0..1] to match the shader.

export const COURT = {
  top: 0,
  bottom: 1,
  left: 0,
  right: 1,
} as const;

export const BALL_RADIUS = 0.05;
export const PADDLE_WIDTH = 0.02;
export const PADDLE_HEIGHT = 0.18;
export const PADDLE_MARGIN = 0.04;

export const BALL_INITIAL_SPEED = 0.7;
export const BALL_SPEED_INCREMENT_PER_HIT = 0.04;
export const BALL_MAX_SPEED = 1.6;

export const PADDLE_DEFAULT_MAX_SPEED = 1.0;

// Angle of deflection off a paddle scales with how far from paddle center the
// ball lands. ±MAX_DEFLECT_ANGLE_RAD at the paddle tips.
export const MAX_DEFLECT_ANGLE_RAD = Math.PI * 0.35;

export const DEFAULT_MATCH_CONFIG = {
  firstTo: 7,
  countdownSec: 1.5,
  pointScoredPauseSec: 0.8,
} as const;

export function paddleX(side: 'left' | 'right'): number {
  return side === 'left'
    ? PADDLE_MARGIN + PADDLE_WIDTH * 0.5
    : 1 - PADDLE_MARGIN - PADDLE_WIDTH * 0.5;
}

export function clampPaddleY(y: number): number {
  const half = PADDLE_HEIGHT * 0.5;
  return Math.max(half, Math.min(1 - half, y));
}
