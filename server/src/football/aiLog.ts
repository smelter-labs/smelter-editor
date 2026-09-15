/**
 * The AI EVENTS log ("what fired and why"): a capped, newest-first list of
 * entries plus the batch the controller flushes to clients every tick.
 * Pure — no timers, no deps — so the wording is unit-testable.
 */
import type {
  FbAiLogEntry,
  FbAiLogTone,
  FbEventKind,
} from '@smelter-editor/types';

export const AI_LOG_CAP = 60;

const KIND_LABEL: Record<FbEventKind, { label: string; tone: FbAiLogTone }> = {
  goal: { label: 'GOAL?', tone: 'amber' },
  chance: { label: 'CHANCE', tone: 'grass' },
  shot: { label: 'SHOT', tone: 'good' },
  corner: { label: 'CORNER', tone: 'chalk' },
  goal_kick: { label: 'GOAL KICK', tone: 'dim' },
  sprint: { label: 'SPRINT', tone: 'grass' },
  attack: { label: 'ATTACK', tone: 'chalk' },
  out: { label: 'OUT', tone: 'dim' },
};

export function eventLabel(kind: FbEventKind): {
  label: string;
  tone: FbAiLogTone;
} {
  return KIND_LABEL[kind] ?? { label: kind.toUpperCase(), tone: 'chalk' };
}

/** On-air wording of an event kind. */
export function eventTitle(kind: FbEventKind): string {
  switch (kind) {
    case 'goal':
      return 'GOAL';
    case 'chance':
      return 'CHANCE';
    case 'shot':
      return 'SHOT';
    case 'corner':
      return 'CORNER';
    case 'goal_kick':
      return 'GOAL KICK';
    case 'sprint':
      return 'SPRINT';
    case 'attack':
      return 'ATTACK';
    case 'out':
      return 'OUT OF PLAY';
    default:
      return String(kind).toUpperCase();
  }
}

export class FbAiLog {
  private seq = 0;
  /** Newest first. */
  private entries: FbAiLogEntry[] = [];
  /** Oldest first, drained per tick. */
  private pending: FbAiLogEntry[] = [];

  constructor(private readonly cap = AI_LOG_CAP) {}

  push(e: Omit<FbAiLogEntry, 'id' | 'atMs'>, now: number): FbAiLogEntry {
    const entry: FbAiLogEntry = { id: ++this.seq, atMs: now, ...e };
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    this.pending.push(entry);
    return entry;
  }

  drain(): FbAiLogEntry[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  snapshot(): FbAiLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
