import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, writeFile } from 'fs-extra';
import type {
  ShooterMatchMode,
  ShooterTopScoreEntry,
} from '@smelter-editor/types';
import { DATA_DIR } from '../dataDir';

const MAX_ENTRIES = 10;

/**
 * One TOP SCORES table per round variant, not per mode: scores from rounds of
 * different lengths (or point targets) aren't comparable, so each variant
 * competes only against itself.
 */
export type ShooterScoreVariant = {
  mode: ShooterMatchMode;
  /** Time mode round length; ignored in points mode. */
  durationMs?: number | null;
  /** Points mode target; ignored in time mode. */
  targetScore?: number | null;
};

/** Stable table key for a round variant, e.g. `time:60000` / `points:25`. */
export function variantKey(v: ShooterScoreVariant): string {
  return v.mode === 'time'
    ? `time:${v.durationMs ?? 0}`
    : `points:${v.targetScore ?? 0}`;
}

type TopScoresFile = {
  v: 2;
  tables: Record<string, ShooterTopScoreEntry[]>;
};

/** 3-char arcade initials from a free-form player name. */
export function defaultInitials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned || 'AAA').slice(0, 3).padEnd(3, 'A');
}

/**
 * Global (cross-room) arcade TOP SCORES tables, one JSON file under data/,
 * keyed by round variant (see variantKey). The only writer is the server's
 * idempotent match end, so a round can never record twice. Reads are served
 * from the in-memory copy; persistence is best-effort — a failed write costs
 * durability, never the live tables.
 */
export class TopScoresStore {
  private tables: Record<string, ShooterTopScoreEntry[]> = {};
  private loaded = false;
  /** Serializes file writes so a slow early write can't clobber a later one. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir = path.join(DATA_DIR, 'duck-hunter')) {}

  private get filePath(): string {
    return path.join(this.dir, 'top-scores.json');
  }

  /**
   * Lazy, tolerant load: a missing or corrupt file is an empty table. A v1
   * file (single table per mode) is also empty — its rows never recorded the
   * round length/target they were earned in, so there is no honest variant to
   * assign them to.
   */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf-8'),
      ) as TopScoresFile;
      if (parsed?.v !== 2 || typeof parsed.tables !== 'object') return;
      for (const [key, rows] of Object.entries(parsed.tables ?? {})) {
        if (!Array.isArray(rows)) continue;
        const kept = rows
          .filter(
            (r) => typeof r?.score === 'number' && typeof r?.name === 'string',
          )
          .slice(0, MAX_ENTRIES);
        if (kept.length > 0) this.tables[key] = kept;
      }
    } catch {
      /* first run or unreadable file — start empty */
    }
  }

  /**
   * Insert a finished round's winning score into its variant's table. Returns
   * the 1-based rank when it made the table, or null when it fell off the
   * bottom.
   */
  submit(
    entry: Omit<ShooterTopScoreEntry, 'initials' | 'at'> & {
      initials?: string;
      at?: number;
    },
  ): { rank: number | null } {
    this.ensureLoaded();
    const full: ShooterTopScoreEntry = {
      ...entry,
      initials: entry.initials ?? defaultInitials(entry.name),
      at: entry.at ?? Date.now(),
    };
    const key = variantKey(full);
    const rows = [...(this.tables[key] ?? []), full];
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
    const kept = rows.slice(0, MAX_ENTRIES);
    this.tables[key] = kept;
    this.persist();
    const rank = kept.indexOf(full);
    return { rank: rank === -1 ? null : rank + 1 };
  }

  /** Current table for one round variant (sorted, capped). */
  snapshot(variant: ShooterScoreVariant): ShooterTopScoreEntry[] {
    this.ensureLoaded();
    return [...(this.tables[variantKey(variant)] ?? [])];
  }

  /** Every variant's table, keyed by variantKey (the read-only REST view). */
  snapshotAll(): Record<string, ShooterTopScoreEntry[]> {
    this.ensureLoaded();
    return Object.fromEntries(
      Object.entries(this.tables).map(([k, rows]) => [k, [...rows]]),
    );
  }

  /** Resolves when every queued write has hit the disk (tests/shutdown). */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private persist(): void {
    const payload = JSON.stringify(
      { v: 2, tables: this.tables } satisfies TopScoresFile,
      null,
      2,
    );
    this.writeChain = this.writeChain
      .then(() => ensureDir(this.dir))
      .then(() => writeFile(this.filePath, payload))
      .catch((err) => {
        console.error('[duck-hunter] failed to persist top scores', err);
      });
  }
}

/** Process-wide table: rooms are ephemeral, the arcade cabinet is not. */
export const duckHunterTopScores = new TopScoresStore();
