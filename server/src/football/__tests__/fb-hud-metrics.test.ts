import { describe, expect, it } from 'vitest';
import { FB_MINIMAP_SIZES } from '@smelter-editor/types';
import { fbMinimapRect } from '../../app/store';
import { MINIMAP_PLATE, minimapScale } from '../../inputs/fbHudMetrics';

const FULL_HD = { width: 1920, height: 1080 };

describe('fbMinimapRect', () => {
  it('size 1 is the design plate, bottom-left', () => {
    expect(fbMinimapRect(FULL_HD)).toEqual({
      x: 56,
      y: 1080 - 56 - MINIMAP_PLATE.h,
      width: MINIMAP_PLATE.w,
      height: MINIMAP_PLATE.h,
    });
  });
  it('grows with the size step, keeps the corner and the aspect, stays on screen', () => {
    let last = 0;
    for (const size of FB_MINIMAP_SIZES) {
      const r = fbMinimapRect(FULL_HD, size);
      expect(r.width).toBeGreaterThan(last);
      last = r.width;
      expect(r.x).toBe(56);
      expect(r.y + r.height).toBe(1080 - 56);
      expect(r.y).toBeGreaterThan(0);
      expect(r.x + r.width).toBeLessThan(FULL_HD.width / 2);
      expect(r.width / r.height).toBeCloseTo(
        MINIMAP_PLATE.w / MINIMAP_PLATE.h,
        1,
      );
    }
  });
  it('scales with the output height', () => {
    const r = fbMinimapRect({ width: 1280, height: 720 }, 3);
    expect(r.width).toBe(Math.round(MINIMAP_PLATE.w * (720 / 1080) * 1.8));
    expect(minimapScale(undefined)).toBe(1);
  });
});
