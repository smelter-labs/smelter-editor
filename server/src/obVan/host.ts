/**
 * OB Van — host recognition lifecycle (the `follow` preset's core).
 *
 * Driven by the controller: `tick()` every 100 ms with the drained new-person
 * events and the current signal view, `onSnapshot()` for `capture` answers.
 * The tracker asks for a snapshot of each debounced candidate, runs the LLM
 * vision identify on it, and on a confident yes binds the host to that
 * camera's person track. The `host` signal it sets is what the priority-90
 * `host-follow` rule cuts on; losing the track clears it again.
 *
 * Pure state machine: no timers (timeouts are resolved inside `tick()`), no
 * I/O of its own — snapshots, identify calls and the host signal go through
 * injected deps, so the whole flow is unit-testable with a fake clock.
 */
import type { ObHostState, ObHostStatus } from '@smelter-editor/types';
import type { ObSignalState } from './contracts';
import { isObLlmError } from './llm/errors';

/** At most one identify in flight, and per camera no more often than this. */
export const OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS = 8000;
/** A requested snapshot that never answers frees the slot after this. */
export const OB_SNAPSHOT_TIMEOUT_MS = 4000;
/** An identify call that never settles frees the slot after this (belt). */
export const OB_IDENTIFY_HARD_TIMEOUT_MS = 20_000;
/** The host's track must be gone this long before the host counts as lost. */
export const OB_HOST_LOST_MS = 3000;
/** Right after a confirm the binding may rebind to the largest track. */
export const OB_REBIND_GRACE_MS = 2000;
/** While confirmed, re-verify the host cam this often. */
export const OB_REVERIFY_MS = 25_000;
/** A denied track gets ONE second look this long after the no. */
export const OB_DENIED_RECHECK_MS = 10_000;
/** …and is forgotten entirely after this. */
export const OB_DENIED_TTL_MS = 30_000;
/** Candidates wait at most this long for the identify slot. */
export const OB_CANDIDATE_TTL_MS = 15_000;
export const OB_CONFIRM_MIN_CONF = 0.6;
/** A re-verify no must be at least this sure to un-confirm the host. */
export const OB_DENY_MIN_CONF = 0.7;

export type ObHostCandidate = { camId: string; trackId: number; airMs: number };

export type ObHostIdentify = {
  isHost: boolean;
  confidence: number;
  reason: string;
};

export type ObHostTrackerDeps = {
  /** Ask the worker for a snapshot of this camera; false = not connected. */
  requestSnapshot: (camId: string, requestId: string) => boolean;
  /** The LLM vision identify (null = model answered without the tool). */
  identify: (camId: string, imageB64: string) => Promise<ObHostIdentify | null>;
  /** The confirmed host's camera changed (null = lost / cleared). */
  setHost: (
    camId: string | null,
    info?: { trackId: number | null; confidence: number },
  ) => void;
  log: (text: string, opts?: { camId?: string; warn?: boolean }) => void;
  /** State shown in the UI changed. */
  onChange: () => void;
  now?: () => number;
};

export type ObHostTickContext = {
  /** `config.host.enabled` and the phase allows it (setup / on-air). */
  active: boolean;
  /** An LLM client exists (`llm.status().available`). */
  llmAvailable: boolean;
  events: ObHostCandidate[];
  view: Record<string, ObSignalState>;
};

type InFlight = {
  camId: string;
  trackId: number;
  requestId: string;
  startedMs: number;
  /** Snapshot answered, identify promise running. */
  identifying: boolean;
  reverify: boolean;
};

type Denied = { atMs: number; rechecked: boolean };

export class ObHostTracker {
  private readonly now: () => number;
  private confirmed: {
    camId: string;
    trackId: number | null;
    confidence: number;
    sinceMs: number;
  } | null = null;
  private inFlight: InFlight | null = null;
  private queue: ObHostCandidate[] = [];
  private readonly lastIdentifyAt = new Map<string, number>();
  private readonly denied = new Map<string, Map<number, Denied>>();
  private queuedAt = new Map<string, number>();
  private hostMissingSinceMs: number | null = null;
  private lastReverifyMs = 0;
  /** Budget spent / LLM gone for this event: stop asking until reset. */
  private blocked = false;
  private wasActive = false;
  private seq = 0;

  constructor(private readonly deps: ObHostTrackerDeps) {
    this.now = deps.now ?? Date.now;
  }

  state(): Pick<
    ObHostState,
    'camId' | 'trackId' | 'confidence' | 'sinceMs' | 'status'
  > {
    const status: ObHostStatus =
      this.blocked || !this.wasActive
        ? 'off'
        : this.confirmed
          ? 'confirmed'
          : this.inFlight
            ? 'identifying'
            : 'idle';
    return {
      camId: this.confirmed?.camId ?? null,
      trackId: this.confirmed?.trackId ?? null,
      confidence: this.confirmed?.confidence ?? 0,
      sinceMs: this.confirmed?.sinceMs ?? null,
      status,
    };
  }

  /** The camera the confirmed host is on (gestures are enabled there). */
  hostCamId(): string | null {
    return this.confirmed?.camId ?? null;
  }

  tick(ctx: ObHostTickContext): void {
    const now = this.now();
    const active = ctx.active && ctx.llmAvailable && !this.blocked;
    if (active !== this.wasActive) {
      this.wasActive = active;
      if (!active) this.clearConfirmed('host detection off');
      this.deps.onChange();
    }
    if (!active) {
      this.queue = [];
      return;
    }
    this.expireInFlight(now);
    this.enqueue(ctx.events, now);
    this.checkHostPresence(ctx.view, now);
    this.enqueueDeniedRechecks(ctx.view, now);
    this.maybeStartReverify(now);
    this.maybeStartNext(now);
  }

  /** A `{kind:'snapshot'}` worker result for this camera. */
  onSnapshot(camId: string, d: Record<string, unknown>): void {
    const f = this.inFlight;
    if (!f || f.identifying || f.camId !== camId) return;
    if (typeof d.requestId !== 'string' || d.requestId !== f.requestId) return;
    const jpegB64 = typeof d.jpegB64 === 'string' ? d.jpegB64 : null;
    if (!jpegB64) {
      this.deps.log(`snapshot failed (${String(d.error ?? 'empty')})`, {
        camId,
        warn: true,
      });
      this.inFlight = null;
      this.deps.onChange();
      return;
    }
    f.identifying = true;
    void this.runIdentify(f, jpegB64);
  }

  reset(): void {
    this.confirmed = null;
    this.inFlight = null;
    this.queue = [];
    this.queuedAt.clear();
    this.lastIdentifyAt.clear();
    this.denied.clear();
    this.hostMissingSinceMs = null;
    this.lastReverifyMs = 0;
    this.blocked = false;
  }

  /** A camera left the show. */
  removeCam(camId: string): void {
    this.queue = this.queue.filter((c) => c.camId !== camId);
    this.denied.delete(camId);
    if (this.inFlight?.camId === camId) this.inFlight = null;
    if (this.confirmed?.camId === camId)
      this.clearConfirmed('host camera removed');
  }

  // ── Candidates ──────────────────────────────────────────────────────

  private enqueue(events: ObHostCandidate[], now: number): void {
    for (const e of events) {
      if (this.confirmed?.camId === e.camId) continue;
      if (this.isDenied(e.camId, e.trackId, now)) continue;
      const key = `${e.camId}:${e.trackId}`;
      if (this.queuedAt.has(key)) continue;
      this.queuedAt.set(key, now);
      this.queue.push(e);
    }
    this.queue = this.queue.filter((c) => {
      const at = this.queuedAt.get(`${c.camId}:${c.trackId}`) ?? now;
      const keep = now - at <= OB_CANDIDATE_TTL_MS;
      if (!keep) this.queuedAt.delete(`${c.camId}:${c.trackId}`);
      return keep;
    });
  }

  private isDenied(camId: string, trackId: number, now: number): boolean {
    const d = this.denied.get(camId)?.get(trackId);
    if (!d) return false;
    if (now - d.atMs > OB_DENIED_TTL_MS) {
      this.denied.get(camId)?.delete(trackId);
      return false;
    }
    // One second look after the recheck delay; before it, still denied.
    return d.rechecked || now - d.atMs < OB_DENIED_RECHECK_MS;
  }

  private enqueueDeniedRechecks(
    view: Record<string, ObSignalState>,
    now: number,
  ): void {
    for (const [camId, tracks] of this.denied) {
      const present = new Set(
        (view[camId]?.people.tracks ?? []).map((t) => t.id),
      );
      for (const [trackId, d] of tracks) {
        if (d.rechecked || now - d.atMs < OB_DENIED_RECHECK_MS) continue;
        if (now - d.atMs > OB_DENIED_TTL_MS || !present.has(trackId)) {
          tracks.delete(trackId);
          continue;
        }
        d.rechecked = true;
        const key = `${camId}:${trackId}`;
        if (!this.queuedAt.has(key)) {
          this.queuedAt.set(key, now);
          this.queue.push({ camId, trackId, airMs: now });
        }
      }
    }
  }

  private maybeStartNext(now: number): void {
    if (this.inFlight) return;
    for (let i = 0; i < this.queue.length; i++) {
      const c = this.queue[i];
      if (this.confirmed?.camId === c.camId) {
        this.queue.splice(i--, 1);
        this.queuedAt.delete(`${c.camId}:${c.trackId}`);
        continue;
      }
      const last = this.lastIdentifyAt.get(c.camId) ?? -Infinity;
      // Inside the camera's cooldown the candidate stays queued (its TTL in
      // `enqueue` still applies) — only one slot is in flight at a time.
      if (now - last < OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS) continue;
      this.queue.splice(i, 1);
      this.queuedAt.delete(`${c.camId}:${c.trackId}`);
      this.start(c.camId, c.trackId, now, false);
      return;
    }
  }

  private maybeStartReverify(now: number): void {
    if (!this.confirmed || this.inFlight) return;
    if (now - this.lastReverifyMs < OB_REVERIFY_MS) return;
    this.lastReverifyMs = now;
    this.start(this.confirmed.camId, this.confirmed.trackId ?? -1, now, true);
  }

  private start(
    camId: string,
    trackId: number,
    now: number,
    reverify: boolean,
  ): void {
    const requestId = `host-${++this.seq}`;
    this.lastIdentifyAt.set(camId, now);
    if (!this.deps.requestSnapshot(camId, requestId)) {
      this.deps.log('snapshot request failed (worker not connected)', {
        camId,
        warn: true,
      });
      return;
    }
    this.inFlight = {
      camId,
      trackId,
      requestId,
      startedMs: now,
      identifying: false,
      reverify,
    };
    this.deps.onChange();
  }

  private expireInFlight(now: number): void {
    const f = this.inFlight;
    if (!f) return;
    const limit = f.identifying
      ? OB_IDENTIFY_HARD_TIMEOUT_MS
      : OB_SNAPSHOT_TIMEOUT_MS;
    if (now - f.startedMs > limit) {
      this.deps.log(
        f.identifying ? 'identify timed out' : 'snapshot timed out',
        { camId: f.camId, warn: true },
      );
      this.inFlight = null;
      this.deps.onChange();
    }
  }

  // ── Identify ────────────────────────────────────────────────────────

  private async runIdentify(f: InFlight, jpegB64: string): Promise<void> {
    let result: ObHostIdentify | null = null;
    try {
      result = await this.deps.identify(f.camId, jpegB64);
    } catch (e) {
      if (this.inFlight === f) this.inFlight = null;
      if (
        isObLlmError(e) &&
        (e.code === 'budget' || e.code === 'llm_unavailable')
      ) {
        this.blocked = true;
        this.wasActive = false;
        this.clearConfirmed('LLM unavailable');
        this.deps.log(`host detection off: ${e.message}`, { warn: true });
      }
      // busy / rate / net / aborted: dropped — cooldowns gate the retry.
      this.deps.onChange();
      return;
    }
    if (this.inFlight !== f) return; // expired meanwhile
    this.inFlight = null;
    if (!result) {
      this.deps.log('identify gave no answer', { camId: f.camId, warn: true });
      this.deps.onChange();
      return;
    }
    if (result.isHost && result.confidence >= OB_CONFIRM_MIN_CONF) {
      this.confirm(f, result);
    } else if (f.reverify) {
      if (!result.isHost && result.confidence >= OB_DENY_MIN_CONF) {
        this.clearConfirmed(`re-verify: ${result.reason || 'host not seen'}`);
      } else {
        // A soft no: look again sooner than the normal cadence.
        this.lastReverifyMs = this.now() - Math.round(OB_REVERIFY_MS / 2);
      }
    } else {
      this.deny(f.camId, f.trackId, result);
    }
    this.deps.onChange();
  }

  private confirm(f: InFlight, result: ObHostIdentify): void {
    const now = this.now();
    const moved = this.confirmed?.camId !== f.camId;
    this.confirmed = {
      camId: f.camId,
      trackId: f.trackId >= 0 ? f.trackId : (this.confirmed?.trackId ?? null),
      confidence: result.confidence,
      sinceMs: moved ? now : (this.confirmed?.sinceMs ?? now),
    };
    this.hostMissingSinceMs = null;
    this.lastReverifyMs = now;
    if (moved) {
      this.deps.setHost(f.camId, {
        trackId: this.confirmed.trackId,
        confidence: result.confidence,
      });
      this.deps.log(
        `host confirmed (${Math.round(result.confidence * 100)}%): ${result.reason || 'match'}`,
        { camId: f.camId },
      );
    }
  }

  private deny(camId: string, trackId: number, result: ObHostIdentify): void {
    let tracks = this.denied.get(camId);
    if (!tracks) {
      tracks = new Map();
      this.denied.set(camId, tracks);
    }
    const prior = tracks.get(trackId);
    tracks.set(trackId, {
      atMs: this.now(),
      rechecked: prior?.rechecked ?? false,
    });
    this.deps.log(
      `not the host (${Math.round(result.confidence * 100)}%): ${result.reason || 'no match'}`,
      { camId },
    );
  }

  // ── Presence ────────────────────────────────────────────────────────

  private checkHostPresence(
    view: Record<string, ObSignalState>,
    now: number,
  ): void {
    const c = this.confirmed;
    if (!c) return;
    const cam = view[c.camId];
    if (!cam || cam.offline) {
      this.clearConfirmed('host camera went offline');
      return;
    }
    const tracks = cam.people.tracks;
    const present =
      c.trackId !== null && tracks.some((t) => t.id === c.trackId);
    if (present) {
      this.hostMissingSinceMs = null;
      return;
    }
    // The candidate track can evaporate between the event and the confirm —
    // right after a confirm, adopt the largest track instead of losing it.
    if (now - c.sinceMs <= OB_REBIND_GRACE_MS && tracks.length) {
      const largest = cam.people.largest ?? tracks[0];
      c.trackId = largest.id;
      this.deps.setHost(c.camId, {
        trackId: c.trackId,
        confidence: c.confidence,
      });
      this.hostMissingSinceMs = null;
      return;
    }
    this.hostMissingSinceMs ??= now;
    if (now - this.hostMissingSinceMs >= OB_HOST_LOST_MS)
      this.clearConfirmed('host left the frame');
  }

  private clearConfirmed(reason: string): void {
    if (!this.confirmed) return;
    const camId = this.confirmed.camId;
    this.confirmed = null;
    this.hostMissingSinceMs = null;
    this.deps.setHost(null);
    this.deps.log(`host cleared: ${reason}`, { camId });
    this.deps.onChange();
  }
}
