import { describe, expect, it } from 'vitest';
import {
  chipRect,
  dotoTextWidth,
  hudScale,
  resultsLayout,
  scoreboardRect,
} from '../retroHudLayout';

const FHD = { width: 1920, height: 1080 };

describe('retroHudLayout', () => {
  it('dotoTextWidth grows linearly with chars and font size', () => {
    expect(dotoTextWidth(20, 10)).toBeGreaterThan(dotoTextWidth(20, 5));
    expect(dotoTextWidth(40, 10)).toBe(2 * dotoTextWidth(20, 10));
  });

  it('hudScale is 1 at 1080p and proportional elsewhere', () => {
    expect(hudScale(FHD)).toBe(1);
    expect(hudScale({ height: 720 })).toBeCloseTo(2 / 3);
  });

  it('chip is horizontally centered and wider for longer labels', () => {
    const a = chipRect(FHD, 'GO');
    const b = chipRect(FHD, 'TIME ATTACK 1:00');
    expect(b.width).toBeGreaterThan(a.width);
    expect(a.left + a.width / 2).toBeCloseTo(FHD.width / 2, -1);
    expect(b.left + b.width / 2).toBeCloseTo(FHD.width / 2, -1);
  });

  it('scoreboard height scales with the row count and stays right-aligned', () => {
    const two = scoreboardRect(FHD, 2);
    const six = scoreboardRect(FHD, 6);
    expect(six.height - two.height).toBe(4 * (six.rowH + six.rowGap));
    expect(two.left + two.width).toBe(FHD.width - Math.round(FHD.width * 0.02));
  });

  it('results columns tile the row without overlap, in order', () => {
    for (const res of [FHD, { width: 2560, height: 1440 }]) {
      const l = resultsLayout(res);
      expect(l.winner.left + l.winner.width + l.colGap).toBe(l.finals.left);
      expect(l.finals.left + l.finals.width + l.colGap).toBe(l.tops.left);
      expect(l.tops.left + l.tops.width).toBeLessThanOrEqual(res.width);
      expect(l.finals.width).toBeGreaterThan(0);
    }
  });
});
