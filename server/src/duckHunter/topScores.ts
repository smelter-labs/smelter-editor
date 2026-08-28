import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, writeFile } from 'fs-extra';
import type {
  ShooterMatchMode,
  ShooterTopScoreEntry,
} from '@smelter-editor/types';
import { DATA_DIR } from '../dataDir';

const MAX_ENTRIES = 10;

type TopScoresFile = {
  v: 1;
  entries: Record<ShooterMatchMode, ShooterTopScoreEntry[]>;
};

/** 3-char arcade initials from a free-form player name. */
export function defaultInitials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned || 'AAA').slice(0, 3).padEnd(3, 'A');
}

function emptyEntries(): Record<ShooterMatchMode, ShooterTopScoreEntry[]> {
  return { time: [], points: [] };
}

/**
 * Global (cross-room) arcade TOP SCORES table, one JSON file under data/.
 * The only writer is the server's idempotent match end, so a round can never
 * record twice. Reads are served from the in-memory copy; persistence is
 * best-effort — a failed write costs durability, never the live table.
 */
export class TopScoresStore {
  private entries = emptyEntries();
  private loaded = false;
  /** Serializes file writes so a slow early write can't clobber a later one. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir = path.join(DATA_DIR, 'duck-hunter')) {}

  private get filePath(): string {
    return path.join(this.dir, 'top-scores.json');
  }

  /** Lazy, tolerant load: a missing or corrupt file is an empty table. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf-8'),
      ) as TopScoresFile;
      if (parsed?.v !== 1 || typeof parsed.entries !== 'object') return;
      for (const mode of ['time', 'points'] as const) {
        const rows = parsed.entries?.[mode];
        if (!Array.isArray(rows)) continue;
        this.entries[mode] = rows
          .filter(
            (r) => typeof r?.score === 'number' && typeof r?.name === 'string',
          )
          .slice(0, MAX_ENTRIES);
      }
    } catch {
      /* first run or unreadable file — start empty */
    }
  }

  /**
   * Insert a finished round's winning score. Returns the 1-based rank when it
   * made the table, or null when it fell off the bottom.
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
    const rows = [...this.entries[full.mode], full];
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
    const kept = rows.slice(0, MAX_ENTRIES);
    this.entries[full.mode] = kept;
    this.persist();
    const rank = kept.indexOf(full);
    return { rank: rank === -1 ? null : rank + 1 };
  }

  /** Current table for one mode (sorted, capped). */
  snapshot(mode: ShooterMatchMode): ShooterTopScoreEntry[] {
    this.ensureLoaded();
    return [...this.entries[mode]];
  }

  /** Resolves when every queued write has hit the disk (tests/shutdown). */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private persist(): void {
    const payload = JSON.stringify(
      { v: 1, entries: this.entries } satisfies TopScoresFile,
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
