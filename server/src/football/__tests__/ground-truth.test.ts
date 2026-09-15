import { describe, expect, it } from 'vitest';
import {
  aiConfidence,
  parseFbGroundTruth,
  selectAiEvents,
} from '../groundTruth';

const FILE = {
  source: 'alfheim pano test',
  t0Utc: 1385661834.47,
  durationMs: 2301000,
  session: 'pano',
  kickoffMs: -221000,
  teams: {
    A: { name: 'Tromsø', attacks: 'left' },
    B: { name: 'Tottenham', attacks: 'right' },
  },
  events: [
    { tMs: 5000, kind: 'kickoff' },
    { tMs: 12000, kind: 'chance', side: 'right', team: 'B' },
    {
      tMs: 20000,
      kind: 'shot',
      side: 'left',
      team: 'A',
      speedMs: 21.7,
      onTarget: true,
    },
    {
      tMs: 30000,
      kind: 'sprint',
      team: 'A',
      tag: 8,
      topKmh: 31.7,
      meters: 11.3,
    },
    { tMs: 40000, kind: 'goal', side: 'left', team: 'A', candidate: true },
    { tMs: 50000, kind: 'goal_kick', side: 'right', team: 'A' },
    { tMs: 1000, kind: 'out', edge: 'far' },
  ],
};

describe('parseFbGroundTruth', () => {
  it('reads the plays, the kick-off and the sides', () => {
    const gt = parseFbGroundTruth(FILE);
    expect(gt.kickoffMs).toBe(-221000);
    expect(gt.attacks).toEqual({ A: 'left', B: 'right' });
    expect(gt.events.map((e) => e.kind)).toEqual([
      'out',
      'chance',
      'shot',
      'sprint',
      'goal',
      'goal_kick',
    ]);
    expect(gt.otherEvents).toBe(1);
    expect(gt.events[2]).toMatchObject({ onTarget: true, speedMs: 21.7 });
  });
  it('rejects a file without events', () => {
    expect(() => parseFbGroundTruth({})).toThrow();
    expect(() => parseFbGroundTruth({ events: [{ kind: 'shot' }] })).toThrow(
      /tMs/,
    );
  });
});

describe('selectAiEvents', () => {
  const gt = parseFbGroundTruth(FILE);
  it('filters by kind', () => {
    expect(
      selectAiEvents(gt, ['shot', 'goal'], null).map((e) => e.kind),
    ).toEqual(['shot', 'goal']);
  });
  it('re-derives the team from the side when the host overrides the ends', () => {
    const swapped = selectAiEvents(
      gt,
      ['chance', 'shot', 'goal_kick', 'sprint'],
      'B',
    );
    expect(swapped.find((e) => e.kind === 'chance')!.team).toBe('A'); // right goal now attacked by A
    expect(swapped.find((e) => e.kind === 'shot')!.team).toBe('B');
    expect(swapped.find((e) => e.kind === 'goal_kick')!.team).toBe('B'); // defender of the right goal
    expect(swapped.find((e) => e.kind === 'sprint')!.team).toBe('A'); // tagged team, never remapped
  });
});

describe('aiConfidence', () => {
  it('keeps goal candidates at 0.5 and plays high', () => {
    expect(aiConfidence('goal', 1234)).toBe(0.5);
    expect(aiConfidence('shot', 1234)).toBeGreaterThanOrEqual(0.86);
    expect(aiConfidence('shot', 1234)).toBe(aiConfidence('shot', 1234));
    expect(aiConfidence('sprint', 0)).toBe(0.99);
  });
});
