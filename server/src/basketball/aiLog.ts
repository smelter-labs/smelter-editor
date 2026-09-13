/**
 * The scorer AI's event log ("what it sees and why"): a capped, newest-first
 * list of entries derived from the basketball-scorer worker feed, plus the
 * batch the controller flushes to clients every tick. Pure — no timers, no
 * deps — so the wording and the debounce rules are unit-testable.
 */
import type { BbAiLogEntry, BbAiLogTone } from '@smelter-editor/types';

export const AI_LOG_CAP = 60;
/** A ball gap shorter than this is normal (occlusion, a pass out of view). */
export const BALL_GAP_LOG_MS = 2000;

/** `candidate_end` as the worker sends it (see analysis.py `_finish`). */
export type CandidateMetrics = {
  minDist?: number | null;
  entrySpeed?: number | null;
  netMinSpeed?: number | null;
  netSamples?: number;
  netCentred?: number;
  netLost?: number;
  dwell?: number | null;
  touchedRim?: boolean;
  lostInRim?: boolean;
  rimT?: number | null;
  state?: string;
  zone?: string;
  belowBottom?: boolean;
  exitSlow?: boolean;
  occluded?: boolean;
  passed?: boolean;
};

export type CandidateEndEvent = {
  type: 'candidate_end';
  t?: number;
  made: boolean;
  /** Evidence name for a make, rejection reason otherwise. */
  reason: string;
  attempted: boolean;
  debounced?: boolean;
  metrics?: CandidateMetrics;
};

export type AiLogFrame = {
  state?: string;
  zone?: string;
  src?: string | null;
  tracked: boolean;
  t?: number;
};

const REASON_TEXT: Record<string, string> = {
  // make evidences
  decel: 'slowed down in the net',
  net_dwell: 'stayed in the net',
  exit_slow: 'left the net slower than it came',
  net_occluded: 'seen in the net, hidden by the mesh, out under it',
  lost_in_net: 'vanished inside the net',
  net_pass: 'straight down the net, no slow-down (weak)',
  net_hidden: 'hidden from the rim to under the net (weak)',
  // rejections
  flight_lost: 'lost in flight',
  flight_away: 'flew past the hoop',
  rim_timeout: 'rolled around the rim too long',
  rim_lost_up: 'lost while bouncing up off the rim',
  rim_exit: 'left the rim without dropping',
  net_lost_empty: 'lost near the net, never seen inside it',
  net_exit_no_evidence: 'left the net band, no make evidence',
};

/** Human wording of a make evidence / rejection reason. */
export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason.replace(/_/g, ' ');
}

const n1 = (v: number | null | undefined) =>
  v == null ? null : (Math.round(v * 100) / 100).toFixed(2);

/** One dim line of the measurements behind a verdict. */
export function metricsSummary(m: CandidateMetrics | undefined): string {
  if (!m) return '';
  const parts: string[] = [];
  if (m.dwell != null) parts.push(`dwell ${n1(m.dwell)}s`);
  if (m.netSamples != null)
    parts.push(
      `net ${m.netSamples}/${m.netCentred ?? 0} lost ${m.netLost ?? 0}`,
    );
  if (m.entrySpeed != null || m.netMinSpeed != null)
    parts.push(`v ${n1(m.entrySpeed) ?? '–'}→${n1(m.netMinSpeed) ?? '–'}`);
  if (m.minDist != null) parts.push(`min ${n1(m.minDist)}rx`);
  if (m.touchedRim) parts.push('rim touched');
  if (m.lostInRim) parts.push('lost in rim');
  if (m.belowBottom === false) parts.push('exited above net bottom');
  return parts.join(' · ');
}

const STATE_LABEL: Record<string, { label: string; tone: BbAiLogTone }> = {
  idle: { label: 'IDLE', tone: 'dim' },
  flight: { label: 'FLIGHT', tone: 'electric' },
  rim: { label: 'RIM', tone: 'amber' },
  net: { label: 'NET', tone: 'good' },
  cooldown: { label: 'COOLDOWN', tone: 'dim' },
};

export function stateLabel(state: string): {
  label: string;
  tone: BbAiLogTone;
} {
  return STATE_LABEL[state] ?? { label: state.toUpperCase(), tone: 'chalk' };
}

export class BbAiLog {
  private seq = 0;
  /** Newest first. */
  private entries: BbAiLogEntry[] = [];
  /** Oldest first, drained per tick. */
  private pending: BbAiLogEntry[] = [];
  private prevState: string | null = null;
  private lastSeenAt = 0;

  constructor(private readonly cap = AI_LOG_CAP) {}

  push(e: Omit<BbAiLogEntry, 'id' | 'atMs'>, now: number): BbAiLogEntry {
    const entry: BbAiLogEntry = { id: ++this.seq, atMs: now, ...e };
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    this.pending.push(entry);
    return entry;
  }

  drain(): BbAiLogEntry[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  snapshot(): BbAiLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Forget the per-frame deltas (worker restart / hoop cam gone); entries stay. */
  reset(): void {
    this.prevState = null;
    this.lastSeenAt = 0;
  }

  /**
   * Per analysed frame: one entry per state transition, and one when the
   * ball comes back after a long gap (which detector found it, how long it
   * was gone). Transitions into `idle` are skipped: every one of them is
   * explained by the `candidate_end` verdict (or the cooldown expiring).
   */
  onFrame(d: AiLogFrame, now: number): void {
    const state = d.state ?? 'idle';
    if (state !== this.prevState) {
      const prev = this.prevState;
      this.prevState = state;
      if (prev != null && state !== 'idle') {
        const { label, tone } = stateLabel(state);
        this.push(
          {
            kind: 'state',
            tone,
            label,
            text: `${prev}→${state} · ${d.zone ?? 'none'} · ${d.src ?? '–'}`,
            ...(d.t != null ? { t: d.t } : {}),
          },
          now,
        );
      }
    }
    if (!d.tracked) return;
    const gap = this.lastSeenAt > 0 ? now - this.lastSeenAt : 0;
    this.lastSeenAt = now;
    if (gap >= BALL_GAP_LOG_MS) {
      this.push(
        {
          kind: 'ball',
          tone: 'dim',
          label: 'BALL',
          text: `found · ${d.src ?? '–'} · after ${(gap / 1000).toFixed(1)} s`,
          ...(d.t != null ? { t: d.t } : {}),
        },
        now,
      );
    }
  }

  /** Entry fields for a closed candidate (not pushed). */
  candidateEntry(ev: CandidateEndEvent): Omit<BbAiLogEntry, 'id' | 'atMs'> {
    const detail = metricsSummary(ev.metrics);
    const base = {
      kind: 'candidate' as const,
      ...(ev.t != null ? { t: ev.t } : {}),
      ...(detail ? { detail } : {}),
    };
    if (ev.made) {
      return {
        ...base,
        tone: 'good',
        label: 'MAKE',
        text: `${ev.reason} · ${reasonText(ev.reason)}`,
      };
    }
    if (ev.attempted) {
      return {
        ...base,
        tone: 'amber',
        label: 'MISS',
        text: `${ev.reason} · ${reasonText(ev.reason)}`,
      };
    }
    return {
      ...base,
      tone: 'dim',
      label: 'DROP',
      text: `${ev.reason} · ${reasonText(ev.reason)}${
        ev.debounced ? ' · attempt debounced' : ' · too far for an attempt'
      }`,
    };
  }

  /** The worker closed a shot candidate: MAKE / MISS (attempt) / DROP. */
  onCandidateEnd(ev: CandidateEndEvent, now: number): BbAiLogEntry {
    return this.push(this.candidateEntry(ev), now);
  }
}
