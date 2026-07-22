import { describe, expect, it } from 'vitest';
import type { CarAdDetection, CarQuad } from '../../../app/store';
import { CarTracker } from '../car-tracker';

function quadAt(cx: number, cy: number, w = 0.2, h = 0.1): CarQuad {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

function car(cx: number, cy: number, withQuad = true): CarAdDetection {
  return {
    box: { x: cx - 0.15, y: cy - 0.1, w: 0.3, h: 0.2 },
    quad: withQuad ? quadAt(cx, cy) : null,
    wheels: withQuad
      ? [
          { x: cx - 0.1, y: cy + 0.05, r: 0.02 },
          { x: cx + 0.1, y: cy + 0.05, r: 0.02 },
        ]
      : null,
  };
}

describe('CarTracker', () => {
  it('keeps a stable id across responses for the same car', () => {
    const t = new CarTracker();
    const [a] = t.update([car(0.5, 0.5)], 1000);
    const [b] = t.update([car(0.52, 0.5)], 1200);
    expect(b.id).toBe(a.id);
  });

  it('holds the quad, translated with the car, through a wheel dropout', () => {
    const t = new CarTracker();
    t.update([car(0.5, 0.5)], 1000);
    // Same car matched again, but Hough lost the wheels this response.
    const [tracked] = t.update([car(0.6, 0.5, false)], 1200);
    expect(tracked.quad).toBeDefined();
    // Quad center moved along with the box (+0.1 in x).
    const cx =
      tracked.quad!.reduce((s, p) => s + p.x, 0) / tracked.quad!.length;
    expect(cx).toBeCloseTo(0.6, 1);
  });

  it('drops the quad after the hold budget runs out', () => {
    const t = new CarTracker();
    t.update([car(0.5, 0.5)], 1000);
    let tracked = t.update([car(0.5, 0.5, false)], 1200)[0];
    for (let i = 0; i < 8; i++) {
      tracked = t.update([car(0.5, 0.5, false)], 1400 + i * 200)[0];
    }
    expect(tracked.quad).toBeUndefined();
  });

  it('smooths a jittering quad instead of jumping to each detection', () => {
    const t = new CarTracker();
    t.update([car(0.5, 0.5)], 1000);
    // Detection jumps by 0.04 — EMA should land between old and new.
    const [tracked] = t.update(
      [{ ...car(0.5, 0.5), quad: quadAt(0.54, 0.5) }],
      1200,
    );
    const cx =
      tracked.quad!.reduce((s, p) => s + p.x, 0) / tracked.quad!.length;
    expect(cx).toBeGreaterThan(0.5);
    expect(cx).toBeLessThan(0.54);
  });

  it('retires a track after enough misses and never matches across the frame', () => {
    const t = new CarTracker();
    t.update([car(0.2, 0.5)], 1000);
    // A detection far across the frame must become a new track, not a match.
    const tracked = t.update([car(0.8, 0.5)], 1200);
    expect(tracked).toHaveLength(2);
    // The old car goes unmatched; after maxMisses (4) responses it retires.
    let last = tracked;
    for (let i = 0; i < 5; i++) {
      last = t.update([car(0.8, 0.5)], 1400 + i * 200);
    }
    expect(last).toHaveLength(1);
    expect(last[0].quad).toBeDefined();
  });
});
