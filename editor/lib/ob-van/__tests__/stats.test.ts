import { describe, expect, it } from 'vitest';
import type { ObStats } from '@smelter-editor/types';
import { avgHoldMs, camShare, cutsBySource, pct, showLengthMs } from '../stats';

const stats: ObStats = {
  startedAtMs: 1000,
  endedAtMs: 61000,
  cuts: 5,
  bySource: { operator: 2, auto: 3, llm: 0, system: 0 },
  onAirMsByCam: { a: 30000, b: 10000, gone: 20000 },
  avgHoldMs: 0,
};
const cams = [
  { id: 'a', number: 1, name: 'WIDE' },
  { id: 'b', number: 2, name: 'SPEAKER' },
  { id: 'c', number: 3, name: 'AUDIENCE' },
];

describe('wrap stats', () => {
  it('shares on-air time, biggest first, idle and departed cams included', () => {
    const rows = camShare(stats, cams);
    expect(rows.map((r) => r.camId)).toEqual(['a', 'gone', 'b', 'c']);
    expect(rows[0].share).toBeCloseTo(0.5);
    expect(rows[1].number).toBeNull();
    expect(rows[3]).toMatchObject({ camId: 'c', ms: 0, share: 0 });
  });

  it('mean hold falls back to show length / (cuts + 1)', () => {
    expect(showLengthMs(stats, 0)).toBe(60000);
    expect(avgHoldMs(stats, 0)).toBe(10000);
    expect(avgHoldMs({ ...stats, avgHoldMs: 4200 }, 0)).toBe(4200);
    expect(showLengthMs({ startedAtMs: null, endedAtMs: null }, 5)).toBe(0);
    expect(showLengthMs({ startedAtMs: 0, endedAtMs: null }, 5)).toBe(5);
  });

  it('counts cuts per source in a fixed order', () => {
    const rows = cutsBySource(stats);
    expect(rows.map((r) => r.source)).toEqual([
      'operator',
      'auto',
      'llm',
      'system',
    ]);
    expect(rows[1].share).toBeCloseTo(0.6);
    expect(pct(0.6)).toBe('60 %');
  });
});
