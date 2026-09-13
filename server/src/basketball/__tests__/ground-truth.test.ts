import { describe, expect, it } from 'vitest';
import {
  deriveClipBasket,
  parseBbGroundTruth,
  selectReplayShots,
  selectUltraShots,
  ultraConfidence,
} from '../groundTruth';

const sample = {
  t0Utc: 1207759560,
  events: [
    { tMs: 5000, kind: 'possession', team: 'A' },
    {
      tMs: 76250,
      kind: 'throw',
      made: true,
      points: 2,
      team: 'A',
      shotType: 'layup',
      basket: 'right',
    },
    {
      tMs: 86950,
      kind: 'throw',
      made: false,
      points: 0,
      team: 'B',
      shotType: 'three',
      basket: 'left',
    },
    {
      tMs: 232450,
      kind: 'throw',
      made: true,
      points: 3,
      team: 'A',
      shotType: 'three',
      basket: 'right',
    },
    {
      tMs: 172150,
      kind: 'throw',
      made: true,
      points: 1,
      team: 'B',
      shotType: 'free',
      basket: 'left',
    },
    { tMs: 300000, kind: 'throw', made: true, points: 2, team: null },
    { tMs: 90000, kind: 'rebound', team: 'B' },
  ],
};

describe('parseBbGroundTruth', () => {
  it('keeps throws sorted by time and counts the rest', () => {
    const gt = parseBbGroundTruth(sample);
    expect(gt.t0Utc).toBe(1207759560);
    expect(gt.otherEvents).toBe(2);
    expect(gt.throws.map((t) => t.tMs)).toEqual([
      76250, 86950, 172150, 232450, 300000,
    ]);
    expect(gt.throws[0]).toMatchObject({
      made: true,
      points: 2,
      team: 'A',
      basket: 'right',
      shotType: 'layup',
    });
    expect(gt.throws[1]).toMatchObject({ made: false, points: 0, team: 'B' });
    expect(gt.throws[4].team).toBeNull();
    expect(gt.throws[4].basket).toBeUndefined();
  });

  it('derives made from points when absent', () => {
    const gt = parseBbGroundTruth({
      events: [{ tMs: 1, kind: 'throw', points: 2 }],
    });
    expect(gt.throws[0].made).toBe(true);
    expect(gt.t0Utc).toBeNull();
  });

  it.each([
    [null],
    [{}],
    [{ events: {} }],
    [{ events: [1] }],
    [{ events: [{ kind: 'throw' }] }],
    [{ events: [{ kind: 'throw', tMs: -1 }] }],
    [{ events: [{ kind: 'throw', tMs: 1, points: 5 }] }],
  ])('rejects %j', (bad) => {
    expect(() => parseBbGroundTruth(bad)).toThrow(/events\.json/);
  });
});

describe('selectReplayShots', () => {
  const gt = parseBbGroundTruth(sample);

  it('maps annotated points onto the 3x3 ledger', () => {
    const shots = selectReplayShots(gt, { basket: 'both', arcPoints: 2 });
    expect(shots.map((s) => [s.tMs, s.made, s.points, s.gtPoints])).toEqual([
      [76250, true, 1, 2],
      [86950, false, 2, 3],
      [172150, true, 1, 1],
      [232450, true, 2, 3],
      [300000, true, 1, 2],
    ]);
  });

  it('honours arcPoints 1 and a pointsMap override', () => {
    expect(
      selectReplayShots(gt, { basket: 'both', arcPoints: 1 })[3].points,
    ).toBe(1);
    const mapped = selectReplayShots(gt, {
      basket: 'both',
      arcPoints: 2,
      pointsMap: { '2': 2 },
    });
    expect(mapped[0].points).toBe(2);
    expect(mapped[2].points).toBe(1);
  });

  it('filters by basket but keeps unlabelled throws', () => {
    const left = selectReplayShots(gt, { basket: 'left', arcPoints: 2 });
    expect(left.map((s) => s.tMs)).toEqual([86950, 172150, 300000]);
    const right = selectReplayShots(gt, { basket: 'right', arcPoints: 2 });
    expect(right.map((s) => s.tMs)).toEqual([76250, 232450, 300000]);
  });

  it('remaps team letters', () => {
    const shots = selectReplayShots(gt, {
      basket: 'both',
      arcPoints: 2,
      teamMap: { A: 'B', B: 'A' },
    });
    expect(shots.map((s) => s.team)).toEqual(['B', 'A', 'A', 'B', null]);
  });
});

const withBaskets = {
  ...sample,
  baskets: {
    left: { cams: [7, 5, 1, 2], courtX: 157 },
    right: { cams: ['3', 6, 4] },
  },
};

describe('parseBbGroundTruth · baskets', () => {
  it('keeps the camera numbers per basket', () => {
    expect(parseBbGroundTruth(withBaskets).basketCams).toEqual({
      left: [7, 5, 1, 2],
      right: [3, 6, 4],
    });
    expect(parseBbGroundTruth(sample).basketCams).toEqual({
      left: [],
      right: [],
    });
  });
});

describe('deriveClipBasket', () => {
  const gt = parseBbGroundTruth(withBaskets);
  it('reads the basket off the clip cam number', () => {
    expect(deriveClipBasket(gt, 'demo/left-3-loop/cam7.mp4')).toBe('left');
    expect(deriveClipBasket(gt, 'apidis/q2/cam6.mp4')).toBe('right');
    expect(deriveClipBasket(gt, 'cam1.mp4')).toBe('left');
  });
  it('falls back to a left / right token in the folder, else both', () => {
    const bare = parseBbGroundTruth(sample);
    expect(deriveClipBasket(bare, 'demo/right-make-76s/cam6.mp4')).toBe(
      'right',
    );
    expect(deriveClipBasket(bare, 'demo/left-q4-4-makes/cam9.mp4')).toBe(
      'left',
    );
    expect(deriveClipBasket(bare, 'bb-synth.mp4')).toBe('both');
    expect(deriveClipBasket(bare, 'copyright/hoop.mp4')).toBe('both');
  });
});

describe('selectUltraShots', () => {
  const gt = parseBbGroundTruth(withBaskets);
  it('selects the plays of the basket the clip shows', () => {
    const left = selectUltraShots(gt, 'demo/x/cam7.mp4', 2);
    expect(left.basket).toBe('left');
    expect(left.shots.map((s) => s.tMs)).toEqual([86950, 172150, 300000]);
    const right = selectUltraShots(gt, 'demo/x/cam6.mp4', 2);
    expect(right.basket).toBe('right');
    expect(right.shots.map((s) => s.tMs)).toEqual([76250, 232450, 300000]);
  });
  it('falls back to both baskets when the derived side has no plays', () => {
    const rightOnly = parseBbGroundTruth({
      baskets: { left: { cams: [7] }, right: { cams: [6] } },
      events: [
        {
          tMs: 1000,
          kind: 'throw',
          made: true,
          points: 2,
          team: 'A',
          basket: 'right',
        },
      ],
    });
    expect(selectUltraShots(rightOnly, 'demo/x/cam7.mp4', 2)).toMatchObject({
      basket: 'both',
    });
    expect(
      selectUltraShots(rightOnly, 'demo/x/cam7.mp4', 2).shots,
    ).toHaveLength(1);
  });
});

describe('ultraConfidence', () => {
  it('is deterministic per play, 0.90–0.99 with a team, 0.5 without', () => {
    for (const t of [0, 8950, 44_000, 67_600, 79_000, 1_234_567]) {
      const c = ultraConfidence(t, 'A');
      expect(c).toBeGreaterThanOrEqual(0.9);
      expect(c).toBeLessThan(1);
      expect(ultraConfidence(t, 'B')).toBe(c);
    }
    expect(ultraConfidence(8950, null)).toBe(0.5);
  });
});
