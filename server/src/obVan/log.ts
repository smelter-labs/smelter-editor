/**
 * The OB Van "WHY" log: a capped, newest-first list of entries plus the batch
 * the controller flushes to clients every tick (same shape as the football
 * `FbAiLog`), and the human wording of shots and transitions. Pure — no
 * timers, no deps — so the wording is unit-testable.
 */
import type {
  ObLogEntry,
  ObShot,
  ObTransition,
  ObTransitionType,
} from '@smelter-editor/types';

export const OB_LOG_CAP = 60;

export class ObLog {
  private seq = 0;
  /** Newest first. */
  private entries: ObLogEntry[] = [];
  /** Oldest first, drained per tick. */
  private pending: ObLogEntry[] = [];

  constructor(private readonly cap = OB_LOG_CAP) {}

  push(e: Omit<ObLogEntry, 'id' | 'atMs'>, now: number): ObLogEntry {
    const entry: ObLogEntry = { id: ++this.seq, atMs: now, ...e };
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    this.pending.push(entry);
    return entry;
  }

  drain(): ObLogEntry[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  snapshot(): ObLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Newest `n` entries (newest first). */
  tail(n: number): ObLogEntry[] {
    return this.entries.slice(0, n).map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = [];
    this.pending = [];
  }
}

/** What the wording needs to know about a camera. */
export type ObLogCam = {
  id: string;
  number: number;
  name: string;
  talent: string | null;
};

/** `CAM 2 Anna` — the number plus who is on it (talent, else the camera name). */
export function camLabel(camId: string, cams: readonly ObLogCam[]): string {
  const cam = cams.find((c) => c.id === camId);
  if (!cam) return 'CAM ?';
  const who = (cam.talent ?? cam.name).trim();
  return who ? `CAM ${cam.number} ${who}` : `CAM ${cam.number}`;
}

function camNumber(camId: string, cams: readonly ObLogCam[]): string {
  const cam = cams.find((c) => c.id === camId);
  return cam ? `CAM ${cam.number}` : 'CAM ?';
}

const SHOT_WORD: Record<ObShot['kind'], string> = {
  solo: 'SOLO',
  split: 'SPLIT',
  pip: 'PIP',
  quad: 'QUAD',
  grid: 'GRID',
  'speaker-slides': 'SLIDES',
  virtual: 'VIRTUAL',
};

/** One-line shot wording: `SOLO · CAM 2 Anna`, `SPLIT · CAM 1 + CAM 3`. */
export function describeShot(
  shot: ObShot | null,
  cams: readonly ObLogCam[],
): string {
  if (!shot) return 'BLACK';
  const word = SHOT_WORD[shot.kind];
  switch (shot.kind) {
    case 'solo':
      return `${word} · ${camLabel(shot.cam, cams)}`;
    case 'virtual': {
      const extra = [shot.target, shot.zoom].filter(Boolean).join(' ');
      return `${word} · ${camLabel(shot.cam, cams)}${extra ? ` · ${extra}` : ''}`;
    }
    case 'split':
      return `${word} · ${shot.cams.map((c) => camNumber(c, cams)).join(' + ')}`;
    case 'pip':
      return `${word} · ${camNumber(shot.main, cams)} + ${camNumber(shot.inset, cams)} ${shot.corner ?? 'br'}`;
    case 'quad':
    case 'grid':
      return shot.cams.length
        ? `${word} · ${shot.cams.map((c) => camNumber(c, cams)).join(' + ')}`
        : `${word} · ALL`;
    case 'speaker-slides':
      return `${word} · ${camLabel(shot.speaker, cams)} + ${camNumber(shot.slides, cams)}`;
  }
}

const TRANSITION_WORD: Record<ObTransitionType, string> = {
  cut: 'CUT',
  dissolve: 'DISSOLVE',
  wipe: 'WIPE',
  fade: 'FADE',
  dip: 'DIP',
  'zoom-punch': 'ZOOM PUNCH',
};

/** `CUT`, `DISSOLVE 400 ms`, `DIP 300 ms · hold 400 ms`. */
export function describeTransition(t: ObTransition | null): string {
  if (!t || t.type === 'cut') return 'CUT';
  if (t.type === 'dip')
    return `${TRANSITION_WORD.dip} · hold ${Math.round(t.holdMs ?? 400)} ms`;
  if (t.durationMs <= 0) return 'CUT';
  return `${TRANSITION_WORD[t.type]} ${Math.round(t.durationMs)} ms`;
}
