import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, PADDLE_HEIGHT, paddleX } from '../constants';
import {
  collidePaddle,
  collideWalls,
  integrate,
  predictAtX,
  serveVelocity,
} from '../physics';
import type { Ball, Paddle } from '../types';

const ball = (over: Partial<Ball> = {}): Ball => ({
  x: 0.5,
  y: 0.5,
  vx: 0,
  vy: 0,
  ...over,
});

describe('integrate', () => {
  it('advances position by velocity * dt', () => {
    const b = integrate(ball({ vx: 0.5, vy: -0.25 }), 0.1);
    expect(b.x).toBeCloseTo(0.55);
    expect(b.y).toBeCloseTo(0.475);
    expect(b.vx).toBe(0.5);
    expect(b.vy).toBe(-0.25);
  });
});

describe('collideWalls', () => {
  it('reflects off the top wall and emits a bounce event', () => {
    const b = ball({ y: BALL_RADIUS - 0.01, vy: -0.5 });
    const { ball: out, event } = collideWalls(b, 1.0);
    expect(out.vy).toBe(0.5);
    expect(out.y).toBeCloseTo(BALL_RADIUS);
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('wall');
    expect(event!.time).toBe(1.0);
  });

  it('reflects off the bottom wall', () => {
    const b = ball({ y: 1 - BALL_RADIUS + 0.01, vy: 0.5 });
    const { ball: out, event } = collideWalls(b, 0);
    expect(out.vy).toBe(-0.5);
    expect(out.y).toBeCloseTo(1 - BALL_RADIUS);
    expect(event!.kind).toBe('wall');
  });

  it('does not collide when ball is in bounds', () => {
    const { event } = collideWalls(ball({ y: 0.5, vy: 0.1 }), 0);
    expect(event).toBeNull();
  });

  it('ignores wall contact when ball is moving away from it', () => {
    const b = ball({ y: BALL_RADIUS - 0.001, vy: 0.5 });
    const { event } = collideWalls(b, 0);
    expect(event).toBeNull();
  });
});

describe('collidePaddle', () => {
  const paddle: Paddle = { y: 0.5 };

  it('reflects ball when it hits the left paddle moving left', () => {
    const px = paddleX('left');
    const b = ball({ x: px, y: 0.5, vx: -0.4, vy: 0 });
    const { ball: out, event } = collidePaddle(b, paddle, 'left', 1.0);
    expect(out.vx).toBeGreaterThan(0);
    expect(event!.kind).toBe('paddle');
  });

  it('does not collide when ball moves away from the paddle', () => {
    const px = paddleX('left');
    const b = ball({ x: px, y: 0.5, vx: 0.4, vy: 0 });
    const { event } = collidePaddle(b, paddle, 'left', 0);
    expect(event).toBeNull();
  });

  it('deflects up when ball hits top of paddle, down for bottom', () => {
    const px = paddleX('left');
    const halfH = PADDLE_HEIGHT * 0.5;

    const topHit = collidePaddle(
      ball({ x: px, y: paddle.y - halfH * 0.9, vx: -0.4, vy: 0 }),
      paddle,
      'left',
      0,
    );
    expect(topHit.ball.vy).toBeLessThan(0);

    const bottomHit = collidePaddle(
      ball({ x: px, y: paddle.y + halfH * 0.9, vx: -0.4, vy: 0 }),
      paddle,
      'left',
      0,
    );
    expect(bottomHit.ball.vy).toBeGreaterThan(0);
  });

  it('increases ball speed on each paddle hit', () => {
    const px = paddleX('left');
    const incoming = 0.4;
    const b = ball({ x: px, y: 0.5, vx: -incoming, vy: 0 });
    const { ball: out } = collidePaddle(b, paddle, 'left', 0);
    expect(Math.hypot(out.vx, out.vy)).toBeGreaterThan(incoming);
  });
});

describe('predictAtX', () => {
  it('returns straight-line target when ball moves directly', () => {
    const b = ball({ x: 0.3, y: 0.5, vx: 0.5, vy: 0 });
    expect(predictAtX(b, 0.8, 8)).toBeCloseTo(0.5);
  });

  it('reflects off a Y wall when predicting with bounces allowed', () => {
    // Ball moving up-right; should bounce off top wall before reaching far X.
    const b = ball({ x: 0.1, y: 0.2, vx: 0.5, vy: -0.5 });
    const noBounce = predictAtX(b, 0.9, 0);
    const withBounce = predictAtX(b, 0.9, 4);
    expect(noBounce).toBeLessThan(BALL_RADIUS); // unreflected goes off-court
    expect(withBounce).toBeGreaterThan(BALL_RADIUS);
    expect(withBounce).toBeLessThanOrEqual(1 - BALL_RADIUS);
  });

  it('returns current y when ball moves away from target', () => {
    const b = ball({ x: 0.5, y: 0.4, vx: -0.5, vy: 0 });
    expect(predictAtX(b, 0.9, 8)).toBe(0.4);
  });
});

describe('serveVelocity', () => {
  it('aims right when left is serving', () => {
    const v = serveVelocity('left', 0.7, 0);
    expect(v.vx).toBeGreaterThan(0);
  });

  it('aims left when right is serving', () => {
    const v = serveVelocity('right', 0.7, 0);
    expect(v.vx).toBeLessThan(0);
  });
});
