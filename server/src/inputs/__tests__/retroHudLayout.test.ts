import { describe, expect, it } from 'vitest';
import {
  chipRect,
  dotoTextWidth,
  hudScale,
  lineupLayout,
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
      expect(l.finals.left + l.finals.width + l.colGap).toBe(l.tops.left);
      expect(l.tops.left + l.tops.width).toBeLessThanOrEqual(res.width);
      expect(l.finals.width).toBeGreaterThan(0);
      // Two row sub-columns fit inside the padded column box.
      for (const col of [l.finals, l.tops]) {
        expect(col.subWidth).toBeGreaterThan(0);
        expect(col.subLefts[1] + col.subWidth).toBeLessThanOrEqual(
          col.width - col.pad,
        );
      }
    }
  });

  it('podium sits above the columns and inside the frame', () => {
    for (const res of [FHD, { width: 2560, height: 1440 }]) {
      const l = resultsLayout(res);
      expect(l.podium.top).toBeGreaterThan(l.subTop);
      expect(l.podium.top + l.podium.height).toBeLessThanOrEqual(l.columnsTop);
      expect(l.columnsTop + l.columnsH).toBeLessThanOrEqual(res.height);
      const first = l.slots.find((s) => s.place === 1)!;
      const runners = l.slots.filter((s) => s.place !== 1);
      // Winner is centered, widest, and stands on the tallest pedestal.
      expect(first.clip.left + first.clip.width / 2).toBeCloseTo(
        res.width / 2,
        -1,
      );
      for (const r of runners) {
        expect(first.clip.width).toBeGreaterThan(r.clip.width);
        expect(first.pedestal.height).toBeGreaterThan(r.pedestal.height);
      }
      // Slots share a baseline, never overlap, and stack label → clip → pedestal.
      const base = l.podium.top + l.podium.height;
      const ordered = [...l.slots].sort((a, b) => a.clip.left - b.clip.left);
      expect(ordered.map((s) => s.place)).toEqual([2, 1, 3]);
      for (const [i, s] of ordered.entries()) {
        expect(s.pedestal.top + s.pedestal.height).toBe(base);
        expect(s.clip.top + s.clip.height).toBe(s.pedestal.top);
        expect(s.label.top + s.label.height).toBe(s.clip.top);
        expect(s.label.top).toBeGreaterThanOrEqual(l.podium.top);
        const next = ordered[i + 1];
        if (next)
          expect(s.clip.left + s.clip.width).toBeLessThan(next.clip.left);
      }
      expect(ordered[0].clip.left).toBeGreaterThanOrEqual(l.podium.left);
    }
  });

  it('lineup row shrinks with the roster and stays centered', () => {
    const one = lineupLayout(FHD, 1);
    const six = lineupLayout(FHD, 6);
    expect(six.tileSize).toBeLessThan(one.tileSize);
    for (const [l, n] of [
      [one, 1],
      [six, 6],
    ] as const) {
      const rowW = n * l.tileSize + l.gap * (n - 1);
      expect(l.rowLeft + rowW / 2).toBeCloseTo(FHD.width / 2, -1);
      expect(l.rowLeft).toBeGreaterThanOrEqual(0);
      // Tiles, then the name and character title, then the footer hint.
      expect(l.nameTop).toBeGreaterThanOrEqual(l.rowTop + l.tileSize);
      expect(l.titleTop).toBeGreaterThan(l.nameTop);
      expect(l.footerTop).toBeGreaterThan(l.titleTop);
      expect(l.footerTop).toBeLessThan(FHD.height);
      // The 3-2-1 clears the captions and still fits above the frame edge.
      expect(l.countdownTop).toBeGreaterThan(l.titleTop);
      expect(l.countdownTop + l.countdownFs * 1.4).toBeLessThanOrEqual(
        FHD.height,
      );
    }
  });
});
