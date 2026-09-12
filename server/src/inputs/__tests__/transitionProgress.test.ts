import { describe, expect, it } from 'vitest';
import { transitionProgress } from '../transitionWrapper';

const base = { startedAtMs: 1_000, durationMs: 400 };

describe('transitionProgress', () => {
  it('fades in from 0 to 1 over the window', () => {
    const t = { ...base, direction: 'in' as const };
    expect(transitionProgress(t, 1_000)).toBe(0);
    expect(transitionProgress(t, 1_200)).toBeCloseTo(0.5);
    expect(transitionProgress(t, 1_400)).toBe(1);
  });

  it('fades out from 1 to 0 — the very first frame is fully visible', () => {
    const t = { ...base, direction: 'out' as const };
    expect(transitionProgress(t, 1_000)).toBe(1);
    expect(transitionProgress(t, 1_100)).toBeCloseTo(0.75);
    expect(transitionProgress(t, 1_400)).toBe(0);
  });

  it('clamps outside the window', () => {
    expect(transitionProgress({ ...base, direction: 'in' }, 900)).toBe(0);
    expect(transitionProgress({ ...base, direction: 'in' }, 9_000)).toBe(1);
    expect(transitionProgress({ ...base, direction: 'out' }, 900)).toBe(1);
    expect(transitionProgress({ ...base, direction: 'out' }, 9_000)).toBe(0);
  });

  it('treats a zero-length transition as finished', () => {
    expect(
      transitionProgress({ startedAtMs: 5, durationMs: 0, direction: 'in' }, 5),
    ).toBe(1);
    expect(
      transitionProgress(
        { startedAtMs: 5, durationMs: 0, direction: 'out' },
        5,
      ),
    ).toBe(0);
  });
});
