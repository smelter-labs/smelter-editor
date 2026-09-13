import type {
  BbAiLogEntry,
  BbAiLogEvent,
  BbAiLogTone,
  BbBallEvent,
} from '@smelter-editor/types';

// Pure helpers of the moderator panel's AI LOG plate — kept in a .ts file so
// the node vitest config can cover them (bb-kit-helpers.ts convention).

/**
 * Fold a `bb_ai_log` event into the panel's newest-first list: a reset
 * replaces it (the server's snapshot on spectate / reconnect), a batch
 * (oldest first) is prepended, entries already known by id are dropped.
 */
export function mergeAiLog(
  prev: BbAiLogEntry[],
  ev: BbAiLogEvent,
  cap: number,
): BbAiLogEntry[] {
  if (ev.reset) return ev.entries.slice(0, cap);
  const known = new Set(prev.map((e) => e.id));
  const fresh = ev.entries.filter((e) => !known.has(e.id)).reverse();
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev].slice(0, cap);
}

/** Compact age for a log row: "3s", "1m12s", "14m", "2h". */
export function aiLogTime(atMs: number, now: number): string {
  const d = Math.max(0, now - atMs);
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** Kit token behind a log tone (index into `BB`). */
export function aiLogToneKey(
  tone: BbAiLogTone,
): 'dim' | 'chalk' | 'electric' | 'good' | 'amber' | 'bad' {
  return tone;
}

export type AiStatus = {
  text: string;
  tone: 'live' | 'paused' | 'idle' | 'electric';
};

/** Seconds without a `bb_ball` after which the feed counts as stale. */
export const AI_FEED_STALE_MS = 2500;

/**
 * The live status pill: whether the worker feed is up and what the state
 * machine is doing right now (from the debounced `bb_ball` broadcast).
 */
export function aiStatus(
  ball: BbBallEvent | null,
  ballAt: number,
  now: number,
  armed: boolean,
): AiStatus {
  if (!armed) return { text: 'AI IDLE · NO HOOP CAM', tone: 'idle' };
  if (!ball) return { text: 'WAITING FOR WORKER', tone: 'idle' };
  const age = now - ballAt;
  if (age > AI_FEED_STALE_MS)
    return { text: `NO FEED · ${Math.round(age / 1000)}s`, tone: 'paused' };
  const ms = ball.procMs != null ? ` · ${Math.round(ball.procMs)} MS` : '';
  const state = (ball.state ?? 'idle').toUpperCase();
  if (ball.tracked) {
    return {
      text: `TRACKING · ${state} · ${ball.zone.toUpperCase()} · ${(
        ball.source ?? '?'
      ).toUpperCase()}${ms}`,
      tone: 'live',
    };
  }
  if (state !== 'IDLE')
    return { text: `${state} · BALL HIDDEN${ms}`, tone: 'electric' };
  return { text: `IDLE · NO BALL${ms}`, tone: 'idle' };
}
