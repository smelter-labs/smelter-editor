import { describe, expect, it } from 'vitest';
import type { TrackedPersonBox } from '../../../app/store';
import { jitterBoxes } from '../box-jitter';

function box(over: Partial<TrackedPersonBox> = {}): TrackedPersonBox {
  return { id: 1, color: 0, x: 0.4, y: 0.4, w: 0.1, h: 0.1, ...over };
}

const center = (b: TrackedPersonBox) => ({
  x: b.x + b.w / 2,
  y: b.y + b.h / 2,
});

describe('jitterBoxes', () => {
  it('returns the boxes untouched when the amplitude is zero', () => {
    const boxes = [box()];
    expect(jitterBoxes(boxes, 0, 1000)).toBe(boxes);
  });

  it('keeps every displacement below PeopleTracker’s match gate', () => {
    // PeopleTracker gates association at >= 0.03 (MATCH_MIN_DIST). Jitter that
    // reached that far could hand a box to the wrong track between responses.
    const original = box();
    let worst = 0;
    for (let ms = 0; ms < 60_000; ms += 37) {
      const [j] = jitterBoxes([original], 1, ms); // amp deliberately over the cap
      const d = Math.hypot(
        center(j).x - center(original).x,
        center(j).y - center(original).y,
      );
      worst = Math.max(worst, d);
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.03);
  });

  it('moves a box over time rather than holding it still', () => {
    const b = box();
    const a = jitterBoxes([b], 0.005, 1000)[0];
    const c = jitterBoxes([b], 0.005, 1400)[0];
    expect(a.x).not.toBeCloseTo(c.x, 5);
  });

  it('gives boxes with different ids different phases', () => {
    const [a, b] = jitterBoxes([box({ id: 1 }), box({ id: 2 })], 0.005, 1234);
    expect(a.x).not.toBeCloseTo(b.x, 5);
  });

  it('keeps boxes inside the frame at the edges', () => {
    const edges = [
      box({ id: 1, x: 0, y: 0 }),
      box({ id: 2, x: 0.9, y: 0.9 }),
      box({ id: 3, x: 0, y: 0.9, w: 1, h: 0.1 }),
    ];
    for (let ms = 0; ms < 5_000; ms += 53) {
      for (const j of jitterBoxes(edges, 0.01, ms)) {
        expect(j.x).toBeGreaterThanOrEqual(0);
        expect(j.y).toBeGreaterThanOrEqual(0);
        expect(j.x + j.w).toBeLessThanOrEqual(1.000001);
        expect(j.y + j.h).toBeLessThanOrEqual(1.000001);
      }
    }
  });

  it('preserves track identity and colour', () => {
    const [j] = jitterBoxes([box({ id: 7, color: 2, conf: 0.9 })], 0.005, 500);
    expect(j.id).toBe(7);
    expect(j.color).toBe(2);
    expect(j.conf).toBe(0.9);
  });
});
