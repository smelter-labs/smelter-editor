import type {
  ObActionSource,
  ObLogEntry,
  ObLogTone,
} from '@smelter-editor/types';

// The WHY log: `ob_log` batches (and the full `state.log` snapshot) merged
// into one newest-first list, capped, deduplicated by entry id.

export const OB_LOG_CAP = 80;

/**
 * Merge a batch into the list. `reset` (a new event / a server restart)
 * replaces it. Ids are the server's monotonic counter: newest first.
 */
export function mergeObLog(
  prev: readonly ObLogEntry[],
  entries: readonly ObLogEntry[],
  reset = false,
  cap = OB_LOG_CAP,
): ObLogEntry[] {
  const base = reset ? [] : prev;
  if (entries.length === 0) return reset ? [] : (prev as ObLogEntry[]);
  const byId = new Map<number, ObLogEntry>();
  for (const e of base) byId.set(e.id, e);
  for (const e of entries) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap);
}

/** Badge tone per source: operator chalk, auto green, LLM accent, system dim. */
export function sourceTone(
  source: ObActionSource,
): 'chalk' | 'good' | 'ai' | 'dim' {
  switch (source) {
    case 'operator':
      return 'chalk';
    case 'auto':
      return 'good';
    case 'llm':
      return 'ai';
    case 'system':
      return 'dim';
  }
}

/** Entry reasons as one line: `speech 2.4 s · faces 1 · held CAM 1 12 s`. */
export function reasonsLine(
  entry: Pick<ObLogEntry, 'reasons' | 'text'>,
  max = 4,
): string {
  const reasons = (entry.reasons ?? []).filter((r) => r.trim().length > 0);
  if (reasons.length === 0) return '';
  const shown = reasons.slice(0, max).join(' · ');
  return reasons.length > max ? `${shown} · +${reasons.length - max}` : shown;
}

/** Cuts only (take / cut / shot on program), for the WHY list and the ticker. */
export function isCutEntry(entry: Pick<ObLogEntry, 'kind'>): boolean {
  return entry.kind === 'take' || entry.kind === 'cut' || entry.kind === 'shot';
}

export const LOG_TONE_COLOR_KEY: Record<
  ObLogTone,
  'dim' | 'chalk' | 'good' | 'amber' | 'bad' | 'accent'
> = {
  dim: 'dim',
  chalk: 'chalk',
  good: 'good',
  amber: 'amber',
  bad: 'bad',
  ai: 'accent',
};

/** `12:04:31` from a wall-clock ms. */
export function logTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
