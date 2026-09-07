import { describe, expect, it } from 'vitest';
import {
  colorDistance,
  colorsTooClose,
  hueDistance,
  medianRgb,
  parseHex,
  rgbToHsv,
  toHex,
} from '@/lib/arcade/color';

describe('arcade colour helpers', () => {
  it('parses and formats hex', () => {
    expect(parseHex('#ff6a1f')).toEqual({ r: 255, g: 106, b: 31 });
    expect(parseHex('FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('nope')).toBeNull();
    expect(toHex({ r: 255, g: 106, b: 31 })).toBe('#ff6a1f');
  });

  it('converts to HSV with a circular hue distance', () => {
    const orange = rgbToHsv({ r: 255, g: 106, b: 31 });
    expect(Math.round(orange.h)).toBe(20);
    expect(orange.s).toBeGreaterThan(0.8);
    expect(hueDistance(350, 10)).toBe(20);
  });

  it('flags team colours the AI could not tell apart', () => {
    expect(colorsTooClose('#ff6a1f', '#ff8a3f')).toBe(true);
    expect(colorsTooClose('#ff6a1f', '#1f7bff')).toBe(false);
    // Black vs white differ by value alone.
    expect(colorsTooClose('#141416', '#f4efe6')).toBe(false);
    expect(colorDistance('#ff6a1f', '#ff6a1f')).toBe(0);
  });

  it('takes a per-channel median', () => {
    expect(
      medianRgb([
        { r: 0, g: 0, b: 0 },
        { r: 10, g: 20, b: 30 },
        { r: 255, g: 255, b: 255 },
      ]),
    ).toEqual({ r: 10, g: 20, b: 30 });
    expect(medianRgb([])).toBeNull();
  });
});
