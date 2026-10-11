import { describe, expect, it } from 'vitest';
import { formatKbtPoints } from '@smelter-editor/types';
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

  it('handles the fractional maxima weighted scoring produces', () => {
    expect(barScale(12.3)).toBe(20);
    expect(barScale(0.4)).toBe(10);
  });
});

describe('formatKbtPoints', () => {
  it('renders one decimal under weighted scoring, integers otherwise', () => {
    expect(formatKbtPoints(18, true)).toBe('18.0');
    expect(formatKbtPoints(18, false)).toBe('18');
    expect(formatKbtPoints(12.3, true)).toBe('12.3');
  });

  it('cleans float accumulation artifacts before printing', () => {
    expect(formatKbtPoints(7.1999999, true)).toBe('7.2');
    expect(formatKbtPoints(0.9 + 0.9, true)).toBe('1.8');
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
