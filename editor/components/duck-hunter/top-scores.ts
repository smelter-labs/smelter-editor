import type { ShooterMatchMode } from '@smelter-editor/types';

/** Local arcade high-score table for the /duck-hunter page. */
export type TopScoreEntry = {
  /** 3-char arcade initials (derived from the player name by default). */
  initials: string;
  name: string;
  characterId: string;
  score: number;
  mode: ShooterMatchMode;
  at: number;
};

type TopScoresV1 = { v: 1; entries: TopScoreEntry[] };

const KEY = 'duck-hunter-top-scores';
const MAX_ENTRIES = 10;

export function readTopScores(): TopScoreEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TopScoresV1;
    if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

export function defaultInitials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned || 'AAA').slice(0, 3).padEnd(3, 'A');
}

/**
 * Insert a finished-round score. Returns the 1-based rank when it made the
 * table, or null when it fell off the bottom.
 */
export function submitTopScore(
  entry: Omit<TopScoreEntry, 'at' | 'initials'> & { initials?: string },
): { rank: number | null } {
  const entries = readTopScores();
  const full: TopScoreEntry = {
    ...entry,
    initials: entry.initials ?? defaultInitials(entry.name),
    at: Date.now(),
  };
  entries.push(full);
  entries.sort((a, b) => b.score - a.score || a.at - b.at);
  const kept = entries.slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, entries: kept } satisfies TopScoresV1),
    );
  } catch {
    /* storage full/blocked — the table just doesn't persist */
  }
  const rank = kept.indexOf(full);
  return { rank: rank === -1 ? null : rank + 1 };
}
