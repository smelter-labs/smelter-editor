import { describe, expect, it } from 'vitest';
import {
  STREAK_WINDOW_MS,
  freshStreak,
  myStanding,
  rankRows,
  registerStreakHit,
  reloadProgress,
  streakAt,
  type RankRow,
} from '../gun-stats';

const row = (clientId: string, score: number): RankRow => ({
  clientId,
  name: clientId.toUpperCase(),
  color: '#fff',
  score,
});

describe('registerStreakHit', () => {
  it('chains hits inside the window and stops at the boundary', () => {
    const first = registerStreakHit(freshStreak(), 0);
    expect(first.count).toBe(1);
    // Strictly inside the window — same rule as the server's `<` comparison.
    const chained = registerStreakHit(first, STREAK_WINDOW_MS - 1);
    expect(chained.count).toBe(2);
    // Exactly on the boundary starts over.
    expect(registerStreakHit(first, STREAK_WINDOW_MS).count).toBe(1);
  });

  it('keeps the best chain after the streak breaks', () => {
    let s = registerStreakHit(freshStreak(), 0);
    s = registerStreakHit(s, 500);
    s = registerStreakHit(s, 1000); // ×3
    expect(s).toMatchObject({ count: 3, best: 3 });
    s = registerStreakHit(s, 9000); // cold — new chain
    expect(s).toMatchObject({ count: 1, best: 3 });
  });
});

describe('streakAt', () => {
  it('is empty before the first hit', () => {
    expect(streakAt(freshStreak(), 1234)).toEqual({ count: 0, leftMs: 0 });
  });

  it('decays on the clock alone — no miss event breaks it', () => {
    const s = registerStreakHit(registerStreakHit(freshStreak(), 0), 400);
    expect(streakAt(s, 400)).toEqual({ count: 2, leftMs: STREAK_WINDOW_MS });
    expect(streakAt(s, 1400)).toEqual({ count: 2, leftMs: 1000 });
    // Window elapsed: cold, whatever the stored count says.
    expect(streakAt(s, 400 + STREAK_WINDOW_MS)).toEqual({
      count: 0,
      leftMs: 0,
    });
  });
});

describe('rankRows', () => {
  it('uses competition ranking for ties', () => {
    const ranked = rankRows([row('a', 10), row('b', 10), row('c', 5)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('sorts by score and keeps equal scores in their incoming order', () => {
    const ranked = rankRows([row('c', 5), row('a', 10), row('b', 10)]);
    expect(ranked.map((r) => r.clientId)).toEqual(['a', 'b', 'c']);
    // Same rows in a different order must not reshuffle the tied pair beyond
    // their own incoming order — the broadcast is unsorted and arrives 4×/s.
    const again = rankRows([row('b', 10), row('c', 5), row('a', 10)]);
    expect(again.map((r) => r.clientId)).toEqual(['b', 'a', 'c']);
  });

  it('handles an empty board', () => {
    expect(rankRows([])).toEqual([]);
  });
});

describe('myStanding', () => {
  const board = [row('a', 10), row('b', 10), row('c', 5)];

  it('reports a shared lead as tied with no gap', () => {
    expect(myStanding(board, 'a')).toMatchObject({
      rank: 1,
      of: 3,
      tied: true,
      gapToLead: 0,
      gapToNext: 0,
    });
  });

  it('measures the gap to the leader from behind', () => {
    const s = myStanding(board, 'c');
    expect(s).toMatchObject({ rank: 3, tied: false, gapToLead: 5 });
    expect(s?.leader?.clientId).toBe('a');
  });

  it('measures the lead over the best rival when alone in first', () => {
    expect(myStanding([row('a', 9), row('b', 4)], 'a')).toMatchObject({
      rank: 1,
      tied: false,
      gapToLead: 0,
      gapToNext: 5,
    });
  });

  it('has no lead to report when alone on the board', () => {
    expect(myStanding([row('a', 3)], 'a')).toMatchObject({
      rank: 1,
      of: 1,
      tied: false,
      gapToNext: 0,
    });
  });

  it('is null before the server has told us who we are', () => {
    expect(myStanding(board, null)).toBeNull();
    expect(myStanding(board, 'nobody')).toBeNull();
    expect(myStanding([], 'a')).toBeNull();
  });
});

describe('reloadProgress', () => {
  it('fills as the countdown drains', () => {
    expect(reloadProgress(3000, 3000)).toBe(0);
    expect(reloadProgress(1500, 3000)).toBe(0.5);
    expect(reloadProgress(0, 3000)).toBe(1);
  });

  it('never divides by zero', () => {
    expect(reloadProgress(1000, 0)).toBe(0);
    expect(reloadProgress(1000, -1)).toBe(0);
  });

  it('clamps a countdown longer than the interval (config changed mid-round)', () => {
    expect(reloadProgress(5000, 3000)).toBe(0);
    expect(reloadProgress(-200, 3000)).toBe(1);
  });
});
