import { describe, expect, it } from 'vitest';
import {
  MOVE_MAX_OFFSET,
  MOVE_POS_TAU,
  MOVE_ROT_GATE_DEG_S,
  freshMoveState,
  stepTranslation,
  type MoveState,
} from '../translation';

const SENS = 1;
const STILL = { right: 0, up: 0 };

/** Run `seconds` of samples at a fixed rate, returning the last offset. */
function run(
  s: MoveState,
  acc: { right: number; up: number },
  seconds: number,
  dt: number,
  opts: { rot?: number; sens?: number } = {},
) {
  const steps = Math.round(seconds / dt);
  let last = { offX: 0, offY: 0 };
  for (let i = 0; i < steps; i++) {
    last = stepTranslation(
      s,
      acc,
      opts.rot ?? 0,
      dt,
      opts.sens ?? SENS,
      MOVE_ROT_GATE_DEG_S,
    );
  }
  return last;
}

describe('translation (parallax) integrator', () => {
  it('self-centres: a shove decays back to zero once the phone is still', () => {
    const s = freshMoveState();
    const shoved = run(s, { right: 8, up: 0 }, 0.2, 0.016);
    expect(Math.abs(shoved.offX)).toBeGreaterThan(0.005);

    const settled = run(s, STILL, 2, 0.016);
    expect(Math.abs(settled.offX)).toBeLessThan(0.001);
    expect(Math.abs(settled.offY)).toBeLessThan(0.001);
  });

  it('cannot drift: sustained acceleration gives a bounded offset', () => {
    const s = freshMoveState();
    const after1s = run(s, { right: 4, up: 0 }, 1, 0.016);
    const after10s = run(s, { right: 4, up: 0 }, 9, 0.016);

    // A true double integrator would be ~100x further along after 10 s.
    expect(Math.abs(after10s.offX)).toBeLessThanOrEqual(MOVE_MAX_OFFSET * SENS);
    expect(Math.abs(after10s.offX - after1s.offX)).toBeLessThan(0.01);
  });

  it('gates out translation while the phone is rotating fast', () => {
    const spun = run(freshMoveState(), { right: 8, up: 0 }, 0.3, 0.016, {
      rot: MOVE_ROT_GATE_DEG_S,
    });
    expect(spun.offX).toBe(0);

    const still = run(freshMoveState(), { right: 8, up: 0 }, 0.3, 0.016);
    expect(Math.abs(still.offX)).toBeGreaterThan(0.005);
  });

  it('ignores acceleration inside the noise deadzone', () => {
    const s = freshMoveState();
    const out = run(s, { right: 0.1, up: -0.1 }, 1, 0.016);
    expect(Math.abs(out.offX)).toBe(0);
    expect(Math.abs(out.offY)).toBe(0);
  });

  it('decays at the same wall-clock rate regardless of sample rate', () => {
    // The regression this guards: decaying by a fixed per-sample factor instead
    // of exp(-dt/tau) would make 60 Hz bleed off ~3x faster than 20 Hz.
    const fast: MoveState = { vRight: 0, vUp: 0, pRight: 1, pUp: 0 };
    const slow: MoveState = { vRight: 0, vUp: 0, pRight: 1, pUp: 0 };

    run(fast, STILL, 1, 1 / 60);
    run(slow, STILL, 1, 1 / 20);

    const expected = Math.exp(-1 / MOVE_POS_TAU);
    expect(fast.pRight).toBeCloseTo(expected, 6);
    expect(slow.pRight).toBeCloseTo(expected, 6);
  });

  it('moves the crosshair with the phone, screen y inverted', () => {
    const right = run(freshMoveState(), { right: 8, up: 0 }, 0.2, 0.016);
    expect(right.offX).toBeGreaterThan(0);

    const up = run(freshMoveState(), { right: 0, up: 8 }, 0.2, 0.016);
    expect(up.offY).toBeLessThan(0); // up on screen = smaller y
  });

  it('sens 0 is a hard off switch and keeps no state', () => {
    const s = freshMoveState();
    const out = run(s, { right: 8, up: 8 }, 1, 0.016, { sens: 0 });

    expect(out).toEqual({ offX: 0, offY: 0 });
    expect(s).toEqual(freshMoveState());
  });

  it('scales with sensitivity', () => {
    // Gentle enough that neither result is sitting on its clamp, so this
    // measures the gain rather than the cap.
    const low = run(freshMoveState(), { right: 1.5, up: 0 }, 0.2, 0.016, {
      sens: 0.5,
    });
    const high = run(freshMoveState(), { right: 1.5, up: 0 }, 0.2, 0.016, {
      sens: 2,
    });
    expect(Math.abs(low.offX)).toBeLessThan(MOVE_MAX_OFFSET * 0.5);
    expect(Math.abs(high.offX)).toBeCloseTo(Math.abs(low.offX) * 4, 5);
  });
});
