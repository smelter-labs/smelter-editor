import type {
  FbAiLogEntry,
  FbAiLogEvent,
  FbAiLogTone,
} from '@smelter-editor/types';

// Pure helpers of the moderator panel's AI LOG plate — kept in a .ts file so
// the node vitest config can cover them (fb-kit-helpers.ts convention).

/**
 * Fold a `fb_ai_log` event into the panel's newest-first list: a reset
 * replaces it (the server's snapshot on spectate / reconnect), a batch
 * (oldest first) is prepended, entries already known by id are dropped.
 */
export function mergeAiLog(
  prev: FbAiLogEntry[],
  ev: FbAiLogEvent,
  cap: number,
): FbAiLogEntry[] {
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

/** Kit token behind a log tone (index into `FB`); `grass` is the kit's accent. */
export function aiLogToneKey(
  tone: FbAiLogTone,
): 'dim' | 'chalk' | 'electric' | 'good' | 'amber' | 'bad' {
  return tone === 'grass' ? 'electric' : tone;
}
