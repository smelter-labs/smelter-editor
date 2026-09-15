import { describe, expect, it } from 'vitest';
import {
  MANUAL_EVENT_KINDS,
  cut,
  eventLabel,
  isLightColor,
  luminance,
  monoWidth,
  needsOutline,
} from '../fb-kit-helpers';

describe('fb-kit helpers', () => {
  it('cuts one corner', () => {
    expect(cut(12)).toContain('calc(100% - 12px)');
  });
  it('measures luminance', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#000000')).toBe(0);
    expect(isLightColor('#f4f1e8')).toBe(true);
    expect(isLightColor('#132257')).toBe(false);
    expect(needsOutline('#141416')).toBe(true);
  });
  it('predicts mono widths', () => {
    expect(monoWidth('ABCD', 10)).toBe(24);
  });
  it('labels event kinds', () => {
    expect(eventLabel('goal_kick')).toBe('GOAL KICK');
    expect(eventLabel('chance')).toBe('CHANCE');
    expect(MANUAL_EVENT_KINDS).toContain('goal');
  });
});
