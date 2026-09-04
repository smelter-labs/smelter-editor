/**
 * Readouts for the phone's gun panel — the fullscreen control surface shown
 * when the player has the video feed switched off.
 *
 * Pure functions, like `practice.ts` / `axis.ts` / `translation.ts`: the panel
 * re-derives every number on each tick (clock, streak decay, reload), so the
 * arithmetic has to be cheap, side-effect free and testable without a DOM.
 */

/** Mirrors STREAK_WINDOW_MS in server/src/duckHunter/DuckHunterController.ts. */
export const STREAK_WINDOW_MS = 2000;

export type StreakState = {
  /** Hits chained so far (0 before the first one). */
  count: number;
  /** Longest chain this session — survives the window expiring. */
  best: number;
  /** performance.now() of the last chaining hit, or null before any. */
  lastHitAt: number | null;
  /**
   * Server-authoritative combo multiplier of the last hit (shooter_hit.combo),
   * 1 when the server sent none (older server) or the chain is fresh. The
   * server is the one place the per-character combo equation runs; the phone
   * only echoes the value.
   */
  combo: number;
};

export function freshStreak(): StreakState {
  return { count: 0, best: 0, lastHitAt: null, combo: 1 };
}

/**
 * Fold one duck hit into the streak. The window test is a strict `<`, exactly
 * like the server's `now - p.lastHitAt < STREAK_WINDOW_MS`, so a hit landing at
 * the window boundary starts a fresh chain rather than extending the old one.
 *
 * `combo` is the multiplier the server scored this hit at; absent (older
 * server) it falls back to the local chain length, matching the old display.
 *
 * NOT idempotent — running it twice on the same hit counts it twice — so the
 * caller must compute the next state outside a `setState` updater (React may
 * re-run an updater; see the same warning in practice.ts).
 */
export function registerStreakHit(
  s: StreakState,
  now: number,
  combo?: number,
): StreakState {
  const chained = s.lastHitAt != null && now - s.lastHitAt < STREAK_WINDOW_MS;
  const count = chained ? s.count + 1 : 1;
  return {
    count,
    best: Math.max(s.best, count),
    lastHitAt: now,
    combo: combo ?? count,
  };
}

/**
 * The streak as it reads *right now*: it goes cold on its own once the window
 * passes, with no event to drive it (misses don't break it — the server only
 * moves `missStreak` on a miss, and dogs never touch `streak` at all), so the
 * decay has to be computed from the clock.
 */
export function streakAt(
  s: StreakState,
  now: number,
): { count: number; leftMs: number; combo: number } {
  if (s.lastHitAt == null) return { count: 0, leftMs: 0, combo: 1 };
  const left = STREAK_WINDOW_MS - (now - s.lastHitAt);
  if (left <= 0) return { count: 0, leftMs: 0, combo: 1 };
  return { count: s.count, leftMs: left, combo: s.combo };
}

export type RankRow = {
  clientId: string;
  name: string;
  color: string;
  score: number;
  dogScore?: number;
};

export type RankedRow = RankRow & { rank: number };

/**
 * Scoreboard order + competition ranking (`1, 1, 3` for a tie at the top).
 *
 * `shooter_state.players` arrives **unsorted** — the server's `stateSnapshot()`
 * hands back its player map as-is — so the phone sorts it itself. The sort is
 * stable by construction (index tiebreak): a plain score comparison would let
 * equal-scoring rows swap places on every broadcast, i.e. four times a second.
 */
export function rankRows(rows: readonly RankRow[]): RankedRow[] {
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.score - a.row.score || a.i - b.i)
    .map(({ row }) => row);

  const out: RankedRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = out[i - 1];
    const rank =
      prev && sorted[i].score === sorted[i - 1].score ? prev.rank : i + 1;
    out.push({ ...sorted[i], rank });
  }
  return out;
}

export type Standing = {
  rank: number;
  /** Hunters on the board, i.e. the "OF n" under the placement badge. */
  of: number;
  /** Someone else holds the same score. */
  tied: boolean;
  /** Points to the leader (0 when that's us). */
  gapToLead: number;
  /**
   * Points we lead the best rival by — 0 unless we are alone in first. Not
   * derivable from `gapToLead`, which is 0 for the leader whether they are 1
   * point clear or 20.
   */
  gapToNext: number;
  /** Top row, which may be us. Null only when the board is empty. */
  leader: RankRow | null;
};

/** Where this phone stands, or null when we're not on the board yet. */
export function myStanding(
  rows: readonly RankRow[],
  clientId: string | null,
): Standing | null {
  if (!clientId) return null;
  const ranked = rankRows(rows);
  const me = ranked.find((r) => r.clientId === clientId);
  if (!me) return null;
  const leader = ranked[0] ?? null;
  const best = ranked.find((r) => r.clientId !== clientId);
  return {
    rank: me.rank,
    of: ranked.length,
    tied: ranked.some((r) => r.clientId !== clientId && r.score === me.score),
    gapToLead: leader ? Math.max(0, leader.score - me.score) : 0,
    gapToNext: me.rank === 1 && best ? Math.max(0, me.score - best.score) : 0,
    leader,
  };
}

/**
 * How full the reload is, 0..1. Guards every way the two numbers can disagree:
 * a missing/zero `reloadMs` (no division by zero) and a countdown longer than
 * the interval itself, which happens for one tick when the operator raises the
 * reload time mid-round.
 */
export function reloadProgress(reloadLeftMs: number, reloadMs: number): number {
  if (!(reloadMs > 0)) return 0;
  const p = 1 - reloadLeftMs / reloadMs;
  return Math.max(0, Math.min(1, p));
}
