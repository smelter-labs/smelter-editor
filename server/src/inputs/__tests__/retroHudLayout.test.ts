import { describe, expect, it } from 'vitest';
import {
  DOG_ICONS_MAX,
  chamferClipCut,
  chipRect,
  dogIconPitch,
  dotoTextWidth,
  hudScale,
  hunterRowMetrics,
  lineupLayout,
  openingLayout,
  resultsLayout,
  scoreboardRect,
} from '../retroHudLayout';

const FHD = { width: 1920, height: 1080 };
const RESOLUTIONS = [
  FHD,
  { width: 2560, height: 1440 },
  { width: 1280, height: 720 },
];

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

  it('chamferClipCut erodes by inset*(2 - sqrt2) and never goes negative', () => {
    expect(chamferClipCut(36, 13)).toBeCloseTo(36 - 13 * (2 - Math.SQRT2), 6);
    expect(chamferClipCut(36, 0)).toBe(36);
    // A deeply inset box has no corner left to cut.
    expect(chamferClipCut(10, 30)).toBe(0);
    // The point of the erosion: the reveal of the panel stroke is `inset` wide
    // all the way around, diagonals included. The panel's top-left cut line is
    // x + y = panelCut; the inner box's is x + y = inner + 2*inset in the same
    // coords, and two 45° lines that far apart sit inset px from each other.
    const [panelCut, inset] = [36, 13];
    const inner = chamferClipCut(panelCut, inset);
    expect((inner + 2 * inset - panelCut) / Math.SQRT2).toBeCloseTo(inset, 6);
    // Leaving the cut un-eroded is today's bug in reverse: an un-clipped square
    // corner (x + y = 2*inset) falls inside the panel's cut and pokes out.
    expect(2 * inset).toBeLessThan(panelCut);
  });

  it('hunterRowMetrics scales linearly and pips never collapse', () => {
    expect(hunterRowMetrics(32).av).toBe(Math.round(32 * 1.9));
    expect(hunterRowMetrics(64).av).toBe(2 * hunterRowMetrics(32).av);
    expect(hunterRowMetrics(4).pipSize).toBe(5); // floor
    // The sub-label is smaller than the name it hangs under.
    expect(hunterRowMetrics(32).subFs).toBeLessThan(32);
  });

  it('opening columns tile the row without overlap and stay in frame', () => {
    for (const res of RESOLUTIONS) {
      const l = openingLayout(res, 6, 'TIME ATTACK · 1:00');
      expect(l.join.left + l.join.width).toBeLessThan(l.howTo.left);
      expect(l.howTo.left + l.howTo.width).toBeLessThan(l.tops.left);
      expect(l.tops.left + l.tops.width).toBeLessThanOrEqual(res.width);
      expect(l.howTo.width).toBeGreaterThan(l.tops.width);
      // Header → banner → columns → tiles → captions → footer, in that order.
      expect(l.titleTop).toBeGreaterThan(l.eyebrowTop);
      expect(l.banner.top).toBeGreaterThan(l.starTop);
      expect(l.join.top).toBeGreaterThanOrEqual(l.banner.top + l.banner.height);
      expect(l.rowTop).toBeGreaterThanOrEqual(l.join.top + l.join.height);
      expect(l.nameTop).toBeGreaterThanOrEqual(l.rowTop + l.tileSize);
      expect(l.captionTop).toBeGreaterThan(l.nameTop);
      expect(l.footerTop).toBeGreaterThan(l.captionTop + l.captionFs * 1.45);
      expect(l.footerTop + l.footerFs * 1.45).toBeLessThanOrEqual(res.height);
      // Every list column's rows clear the title and fit its padded box.
      for (const col of [l.howTo, l.tops]) {
        expect(col.rowTop).toBeGreaterThan(col.titleTop);
        expect(col.rowTop + col.rows * col.rowH).toBeLessThanOrEqual(
          col.height,
        );
      }
      // The QR sits inside the join column, above its address label.
      expect(l.join.qr.left).toBeGreaterThanOrEqual(l.join.pad);
      expect(l.join.qr.left + l.join.qr.width).toBeLessThanOrEqual(
        l.join.width - l.join.pad,
      );
      expect(l.join.qr.top).toBeGreaterThan(l.join.titleTop);
      expect(l.join.qr.top + l.join.qr.height).toBeLessThanOrEqual(
        l.join.labelTop,
      );
      expect(l.join.hintTop).toBeGreaterThan(l.join.labelTop);
      expect(l.join.hintTop).toBeLessThan(l.join.height);
    }
  });

  it('opening banner is centered and grows with the label', () => {
    const a = openingLayout(FHD, 6, 'FIRST TO 10');
    const b = openingLayout(FHD, 6, 'SCORE RUSH · FIRST TO 200');
    expect(b.banner.width).toBeGreaterThanOrEqual(a.banner.width);
    for (const l of [a, b]) {
      expect(l.banner.left + l.banner.width / 2).toBeCloseTo(FHD.width / 2, -1);
      expect(l.banner.left).toBeGreaterThan(0);
    }
  });

  it('opening tile row is capped, centered and never overflows', () => {
    const one = openingLayout(FHD, 1, 'X');
    const six = openingLayout(FHD, 6, 'X');
    // Capped, unlike lineupLayout — the tiles are one band among several here.
    expect(one.tileSize).toBe(six.tileSize);
    for (const [l, n] of [
      [one, 1],
      [six, 6],
    ] as const) {
      const rowW = n * l.tileSize + l.gap * (n - 1);
      expect(l.rowLeft + rowW / 2).toBeCloseTo(FHD.width / 2, -1);
      expect(l.rowLeft).toBeGreaterThanOrEqual(0);
      expect(l.rowLeft + rowW).toBeLessThanOrEqual(FHD.width);
    }
    // A 720p frame still fits six tiles across.
    const small = openingLayout({ width: 1280, height: 720 }, 6, 'X');
    expect(small.rowLeft).toBeGreaterThanOrEqual(0);
    expect(
      small.rowLeft + 6 * small.tileSize + small.gap * 5,
    ).toBeLessThanOrEqual(1280);
  });
});

describe('dog tally strip', () => {
  // The strip lives in the score column, which is fs*3.8 wide once any player
  // has bagged a dog (see ShooterScoreboard).
  const stripFor = (fs: number) => Math.round(fs * 3.8);

  it('scales the icon with the row font', () => {
    for (const res of RESOLUTIONS) {
      const { fontSize: fs } = scoreboardRect(res, 3);
      const m = hunterRowMetrics(fs);
      expect(m.dogIconH).toBeGreaterThanOrEqual(6);
      expect(m.dogIconW).toBeGreaterThanOrEqual(m.dogIconH); // 29x28 source
      expect(m.dogIconGap).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves the icon within the row height', () => {
    for (const res of RESOLUTIONS) {
      const { fontSize: fs, rowH } = scoreboardRect(res, 3);
      const { dogIconH } = hunterRowMetrics(fs);
      // The strip is drawn at fs*1.85 and must not spill out of the row.
      expect(Math.round(fs * 1.85) + dogIconH).toBeLessThanOrEqual(rowH);
    }
  });

  it('never lets the pile escape the strip, at any count', () => {
    for (const res of RESOLUTIONS) {
      const { fontSize: fs } = scoreboardRect(res, 3);
      const { dogIconW, dogIconGap } = hunterRowMetrics(fs);
      const stripW = stripFor(fs);
      for (let n = 1; n <= DOG_ICONS_MAX; n++) {
        const pitch = dogIconPitch(n, stripW, dogIconW, dogIconGap);
        // Icons are laid out right-to-left from the strip's right edge.
        const leftmost = stripW - dogIconW - (n - 1) * pitch;
        expect(leftmost).toBeGreaterThanOrEqual(0);
        expect(pitch).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('shingles rather than shrinking once the pile stops fitting', () => {
    const { fontSize: fs } = scoreboardRect(FHD, 3);
    const { dogIconW, dogIconGap } = hunterRowMetrics(fs);
    const stripW = stripFor(fs);
    const pitches = Array.from({ length: DOG_ICONS_MAX }, (_, i) =>
      dogIconPitch(i + 1, stripW, dogIconW, dogIconGap),
    );
    // Monotonically tightening, never wider than a full icon + gap.
    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i]).toBeLessThanOrEqual(pitches[i - 1]);
    }
    expect(pitches[0]).toBe(dogIconW + dogIconGap);
    // The icon itself never changes size — only the step between icons does.
    expect(hunterRowMetrics(fs).dogIconW).toBe(dogIconW);
  });
});
