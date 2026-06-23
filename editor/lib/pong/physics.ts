import {
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_SPEED_INCREMENT_PER_HIT,
  COURT,
  MAX_DEFLECT_ANGLE_RAD,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  paddleX,
} from './constants';
import type { Ball, BounceEvent, Paddle, Side } from './types';

export function integrate(ball: Ball, dt: number): Ball {
  return {
    x: ball.x + ball.vx * dt,
    y: ball.y + ball.vy * dt,
    vx: ball.vx,
    vy: ball.vy,
  };
}

// Reflects ball off top/bottom walls. Returns the (possibly reflected) ball and
// a bounce event if a wall was hit during this step.
export function collideWalls(ball: Ball, now: number): { ball: Ball; event: BounceEvent | null } {
  let { x, y, vx, vy } = ball;
  let event: BounceEvent | null = null;

  if (y - BALL_RADIUS < COURT.top && vy < 0) {
    y = COURT.top + BALL_RADIUS;
    vy = -vy;
    event = { time: now, x, y, kind: 'wall' };
  } else if (y + BALL_RADIUS > COURT.bottom && vy > 0) {
    y = COURT.bottom - BALL_RADIUS;
    vy = -vy;
    event = { time: now, x, y, kind: 'wall' };
  }

  return { ball: { x, y, vx, vy }, event };
}

// Reflects ball off one paddle. Outgoing angle depends on hit position on the
// paddle face (Atari-style). Returns the new ball and a bounce event on contact.
export function collidePaddle(
  ball: Ball,
  paddle: Paddle,
  side: Side,
  now: number,
): { ball: Ball; event: BounceEvent | null } {
  const px = paddleX(side);
  const halfW = PADDLE_WIDTH * 0.5;
  const halfH = PADDLE_HEIGHT * 0.5;

  // Ball must be moving toward the paddle and its bounding circle must overlap the paddle rect.
  const movingTowards = side === 'left' ? ball.vx < 0 : ball.vx > 0;
  if (!movingTowards) {
    return { ball, event: null };
  }

  const dx = Math.abs(ball.x - px);
  const dy = Math.abs(ball.y - paddle.y);
  if (dx > halfW + BALL_RADIUS || dy > halfH + BALL_RADIUS) {
    return { ball, event: null };
  }

  // Push ball out along X and reflect.
  const newX = side === 'left' ? px + halfW + BALL_RADIUS : px - halfW - BALL_RADIUS;
  const hitOffset = (ball.y - paddle.y) / halfH; // -1..1
  const clamped = Math.max(-1, Math.min(1, hitOffset));
  const angle = clamped * MAX_DEFLECT_ANGLE_RAD;

  const speed = Math.min(
    Math.hypot(ball.vx, ball.vy) + BALL_SPEED_INCREMENT_PER_HIT,
    BALL_MAX_SPEED,
  );
  const dir = side === 'left' ? 1 : -1;
  const newVx = Math.cos(angle) * speed * dir;
  const newVy = Math.sin(angle) * speed;

  return {
    ball: { x: newX, y: ball.y, vx: newVx, vy: newVy },
    event: { time: now, x: newX, y: ball.y, kind: 'paddle' },
  };
}

// Pure prediction: simulate ball forward (reflecting off Y walls) until its X
// reaches `targetX` (or maxBounces are exhausted). Returns predicted y when ball
// crosses targetX. If ball is moving away from targetX, returns ball.y.
export function predictAtX(
  ball: Ball,
  targetX: number,
  maxBounces: number,
): number {
  if (Math.abs(ball.vx) < 1e-6) return ball.y;

  const movingRight = ball.vx > 0;
  if ((movingRight && targetX < ball.x) || (!movingRight && targetX > ball.x)) {
    return ball.y;
  }

  let x = ball.x;
  let y = ball.y;
  let vy = ball.vy;
  let bouncesLeft = maxBounces;

  // We advance to targetX in straight-line segments, reflecting Y as needed.
  // Loop bounded by bouncesLeft + 1 to guarantee termination even with maxBounces=0.
  for (let step = 0; step <= maxBounces + 1; step++) {
    const dxToTarget = targetX - x;
    const tToTarget = dxToTarget / ball.vx;

    const top = COURT.top + BALL_RADIUS;
    const bottom = COURT.bottom - BALL_RADIUS;
    let tToWall = Infinity;
    let nextWallY = y;
    if (vy < 0) {
      tToWall = (top - y) / vy;
      nextWallY = top;
    } else if (vy > 0) {
      tToWall = (bottom - y) / vy;
      nextWallY = bottom;
    }

    if (tToTarget <= tToWall || bouncesLeft <= 0) {
      return y + vy * tToTarget;
    }

    // Bounce off Y wall first.
    x = x + ball.vx * tToWall;
    y = nextWallY;
    vy = -vy;
    bouncesLeft--;
  }

  return y;
}

// Initial ball velocity at serve, directed toward `servingSide`'s opponent.
export function serveVelocity(servingSide: Side, speed: number, angleRad: number): { vx: number; vy: number } {
  const dir = servingSide === 'left' ? 1 : -1;
  return {
    vx: Math.cos(angleRad) * speed * dir,
    vy: Math.sin(angleRad) * speed,
  };
}
