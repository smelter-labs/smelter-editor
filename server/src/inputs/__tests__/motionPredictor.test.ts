import { describe, expect, it } from 'vitest';
import { MotionPredictor } from '../motionPredictor';

describe('MotionPredictor', () => {
  it('returns the raw target before any velocity is known', () => {
    const p = new MotionPredictor();
    p.update(1, [10, 20], 1000);
    expect(p.predict(1, 1100)).toEqual([10, 20]);
  });

  it('extrapolates along the observed velocity between updates', () => {
    const p = new MotionPredictor();
    p.update(1, [0, 0], 1000);
    p.update(1, [10, 0], 1200); // 0.05 units/ms in x
    // Velocity is EMA-smoothed (weight 0.5), so one observation yields half
    // the instantaneous velocity: 0.025 units/ms.
    const [x, y] = p.predict(1, 1300)!;
    expect(x).toBeCloseTo(10 + 0.025 * 100, 5);
    expect(y).toBe(0);
  });

  it('converges to the true velocity over a few updates', () => {
    const p = new MotionPredictor();
    for (let i = 0; i <= 5; i++) {
      p.update(1, [i * 10, 0], 1000 + i * 200); // steady 0.05 units/ms
    }
    const [x] = p.predict(1, 2100)!; // 100ms past the last update at x=50
    expect(x).toBeGreaterThan(54);
    expect(x).toBeLessThanOrEqual(55);
  });

  it('caps extrapolation so a stale track freezes instead of flying off', () => {
    const p = new MotionPredictor();
    p.update(1, [0, 0], 1000);
    p.update(1, [10, 0], 1200);
    // 10 seconds with no updates: horizon is capped at 1.5× the ~200ms
    // interval, not the full elapsed time.
    const [xFar] = p.predict(1, 11200)!;
    const [xCap] = p.predict(1, 1200 + 300)!;
    expect(xFar).toBeCloseTo(xCap, 5);
  });

  it('resets velocity after a long gap between updates', () => {
    const p = new MotionPredictor();
    p.update(1, [0, 0], 1000);
    p.update(1, [10, 0], 1200);
    p.update(1, [500, 0], 5000); // gap way beyond MAX_DT — teleport, not motion
    expect(p.predict(1, 5100)).toEqual([500, 0]);
  });

  it('slows down when the target stops', () => {
    const p = new MotionPredictor();
    p.update(1, [0, 0], 1000);
    p.update(1, [10, 0], 1200);
    p.update(1, [10, 0], 1400); // stopped
    p.update(1, [10, 0], 1600);
    const [x] = p.predict(1, 1700)!;
    // Velocity EMA halves per stationary update — residual glide is tiny.
    expect(Math.abs(x - 10)).toBeLessThan(1);
  });

  it('prunes dead tracks', () => {
    const p = new MotionPredictor();
    p.update(1, [0, 0], 1000);
    p.update(2, [5, 5], 1000);
    p.prune(new Set([2]));
    expect(p.predict(1, 1100)).toBeUndefined();
    expect(p.predict(2, 1100)).toEqual([5, 5]);
  });
});
