import { describe, expect, it } from 'vitest';
import { parseBbGroundTruth, selectReplayShots } from '../groundTruth';

const sample = {
  t0Utc: 1207759560,
  events: [
    { tMs: 5000, kind: 'possession', team: 'A' },
    { tMs: 76250, kind: 'throw', made: true, points: 2, team: 'A', shotType: 'layup', basket: 'right' },
    { tMs: 86950, kind: 'throw', made: false, points: 0, team: 'B', shotType: 'three', basket: 'left' },
    { tMs: 232450, kind: 'throw', made: true, points: 3, team: 'A', shotType: 'three', basket: 'right' },
    { tMs: 172150, kind: 'throw', made: true, points: 1, team: 'B', shotType: 'free', basket: 'left' },
    { tMs: 300000, kind: 'throw', made: true, points: 2, team: null },
    { tMs: 90000, kind: 'rebound', team: 'B' },
  ],
};

describe('parseBbGroundTruth', () => {
  it('keeps throws sorted by time and counts the rest', () => {
    const gt = parseBbGroundTruth(sample);
    expect(gt.t0Utc).toBe(1207759560);
    expect(gt.otherEvents).toBe(2);
    expect(gt.throws.map((t) => t.tMs)).toEqual([76250, 86950, 172150, 232450, 300000]);
    expect(gt.throws[0]).toMatchObject({ made: true, points: 2, team: 'A', basket: 'right', shotType: 'layup' });
    expect(gt.throws[1]).toMatchObject({ made: false, points: 0, team: 'B' });
    expect(gt.throws[4].team).toBeNull();
    expect(gt.throws[4].basket).toBeUndefined();
  });

  it('derives made from points when absent', () => {
    const gt = parseBbGroundTruth({ events: [{ tMs: 1, kind: 'throw', points: 2 }] });
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
    expect(selectReplayShots(gt, { basket: 'both', arcPoints: 1 })[3].points).toBe(1);
    const mapped = selectReplayShots(gt, { basket: 'both', arcPoints: 2, pointsMap: { '2': 2 } });
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
    const shots = selectReplayShots(gt, { basket: 'both', arcPoints: 2, teamMap: { A: 'B', B: 'A' } });
    expect(shots.map((s) => s.team)).toEqual(['B', 'A', 'A', 'B', null]);
  });
});
