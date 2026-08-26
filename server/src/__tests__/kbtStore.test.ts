import { describe, expect, it } from 'vitest';
import { barScale, kbtCasterCamRect, kbtParkRect } from '../app/store';

describe('barScale', () => {
  it('rounds the max up to the next step so bars only rescale at boundaries', () => {
    expect(barScale(0)).toBe(10);
    expect(barScale(1)).toBe(10);
    expect(barScale(10)).toBe(10);
    expect(barScale(11)).toBe(20);
    expect(barScale(27)).toBe(30);
    expect(barScale(30)).toBe(30);
  });

  it('never returns less than one step (empty rows → -Infinity max)', () => {
    expect(barScale(-Infinity)).toBe(10);
    expect(barScale(3, 5)).toBe(5);
  });
});

describe('kbt stage rects', () => {
  const res = { width: 1920, height: 1080 };

  it('parks off-stage inputs at a 1×1 bottom-corner pixel', () => {
    expect(kbtParkRect(res)).toEqual({ x: 0, y: 1079, width: 1, height: 1 });
    expect(kbtCasterCamRect(res, false)).toEqual(kbtParkRect(res));
  });

  it('gives the visible caster a landscape 16:9 lower-third tile', () => {
    const rect = kbtCasterCamRect(res, true);
    expect(rect.height).toBe(124);
    expect(rect.width).toBe(220);
    expect(rect.x).toBe(70);
    expect(rect.y).toBe(1080 - 70 - 124);
  });
});
