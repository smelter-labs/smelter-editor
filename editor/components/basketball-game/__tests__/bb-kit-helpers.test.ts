import { describe, expect, it } from 'vitest';
import {
  cut,
  isLightColor,
  luminance,
  monoWidth,
  needsOutline,
} from '../bb-kit-helpers';

describe('bb-kit helpers', () => {
  it('cut() is a single top-right corner polygon', () => {
    expect(cut(18)).toBe(
      'polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%)',
    );
  });

  it('luminance orders the bib presets sensibly', () => {
    expect(luminance('#141416')).toBeLessThan(0.01);
    expect(luminance('#f4efe6')).toBeGreaterThan(0.85);
    expect(luminance('#ffd21f')).toBeGreaterThan(luminance('#1f7bff'));
  });

  it('badge text goes dark on light bibs and chalk on dark ones', () => {
    expect(isLightColor('#c8ff3d')).toBe(true);
    expect(isLightColor('#ffd21f')).toBe(true);
    expect(isLightColor('#f4efe6')).toBe(true);
    expect(isLightColor('#1e2a78')).toBe(false);
    expect(isLightColor('#141416')).toBe(false);
    expect(isLightColor('#ff2e3d')).toBe(false);
  });

  it('only very dark stripes need an outline (design: Dockside #1E2A78 does)', () => {
    expect(needsOutline('#141416')).toBe(true);
    expect(needsOutline('#1e2a78')).toBe(true);
    expect(needsOutline('#1f7bff')).toBe(false);
    expect(needsOutline('#c8ff3d')).toBe(false);
  });

  it("monoWidth follows Plex Mono's 0.6 em advance", () => {
    expect(monoWidth('REG', 11)).toBeCloseTo(19.8);
    expect(monoWidth('FIRST TO +2', 11)).toBeCloseTo(72.6);
  });
});
