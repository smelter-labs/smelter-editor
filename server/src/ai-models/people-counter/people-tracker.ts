import type { PersonBox, TrackedPersonBox } from '../../app/store';

type Track = {
  id: number;
  color: number;
  /** Last raw detected box (used for matching — never extrapolated). */
  box: PersonBox;
  /** Smoothed center velocity, normalized units per ms. */
  vx: number;
  vy: number;
  /** Wall-clock time (ms) of the last matched detection. */
  lastMs: number;
  /** Consecutive detection responses this track went unmatched. */
  missed: number;
  /** Detections matched so far (1 = only the one that started the track). */
  hits: number;
};

/** Number of responses a track survives without a matching detection. */
const DEFAULT_MAX_MISSES = 5;
/**
 * A track may only match a detection within this radius of its last center, so
 * a person can't "teleport" onto a different, far-away person between responses.
 * The gate scales with the person's own box size (they move roughly in
 * proportion to how big/close they are) but is hard-capped so it can never
 * reach across a large part of the frame.
 */
const MATCH_SIZE_FACTOR = 1.5; // ~1.5× the person's own box size per response
const MATCH_MIN_DIST = 0.03; // floor for tiny/distant boxes (normalized units)
const MATCH_MAX_DIST = 0.12; // hard cap: never match across >12% of the frame

// ── Fast movers (birds) ──────────────────────────────────────────
// A small bird crossing the frame moves several times its own box size
// between responses (~200–400 ms apart), so the size-scaled gate above loses
// it on every response and it gets a fresh id — and a fresh duck — each time.
// The fast-mover profile makes the gate a function of TIME since the track was
// last seen, predicts where the track is now from its velocity, and remembers
// a lost track's identity for a while so a bird that dips out of detection
// comes back as itself.

/** Gate growth per ms while the track's velocity is still unknown (1 hit). */
const SIGMA_UNKNOWN_VEL = 0.0008; // ≈0.25 per 300 ms
/** Gate growth per ms once the velocity is known (prediction absorbs most). */
const SIGMA_KNOWN_VEL = 0.0003;
/** Widest any gate ever gets (normalized units). */
const FAST_MAX_GATE = 0.25;
/** Coast the prediction at most this far into a gap; beyond it the point holds
 * still and only the gate keeps growing (birds turn — a stale velocity is more
 * likely wrong than right after a couple of intervals). */
const COAST_CAP_MS = 600;
/** Detections outside this size ratio of a track are never the same bird. A
 * wing flap doubles a box's height, so no tighter than 3×. */
const SIZE_RATIO_MAX = 3;
/** Cost weight of the size mismatch term (per unit of |ln ratio|). */
const SIZE_COST = 0.3;

// ── Motion prediction ────────────────────────────────────────────
// Detections arrive only ~4–6×/s (worker frame-skip + inference cost) and the
// rendered box is frozen between responses, so a fast target visibly outruns
// its box. We estimate each track's velocity from consecutive detections and
// lead the rendered box forward toward where the target will be while the box
// sits frozen, which cancels most of the "box trails the object" lag.

/** EMA weight for the previous velocity (higher = smoother, laggier). */
const VEL_SMOOTH = 0.5;
/** EMA weight for the previous inter-detection interval estimate. */
const INTERVAL_SMOOTH = 0.6;
/**
 * Fraction of the refresh interval to lead by. The box is frozen for ~one
 * interval after each apply, so leading by half of it centers the error
 * (±interval/2) instead of always lagging (0..interval).
 */
const LEAD_FACTOR = 0.6;
/** Never extrapolate further ahead than this, however stale the cadence. */
const LEAD_CAP_MS = 220;
/** Ignore dt outside this band when estimating velocity (startup / long gaps). */
const MIN_DT_MS = 10;
const MAX_DT_MS = 500;

const center = (b: PersonBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

const maxSide = (b: PersonBox) => Math.max(b.w, b.h);

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Max distance this track is allowed to move to accept a detection. */
const allowedDist = (box: PersonBox) =>
  Math.max(
    MATCH_MIN_DIST,
    Math.min(MATCH_MAX_DIST, MATCH_SIZE_FACTOR * Math.max(box.w, box.h)),
  );

export type PeopleTrackerOptions = {
  /** Responses a track is still reported after its last match (default 5). */
  maxMisses?: number;
  /**
   * Extrapolate returned boxes forward along their velocity (see "Motion
   * prediction") — right for renderers that freeze the box between responses.
   * Pass false when the renderer dead-reckons on its own (e.g. the car-hue
   * overlay), so motion isn't predicted twice. Default true.
   */
  withLead?: boolean;
  /**
   * Fast-mover association (see "Fast movers"): time-based gates, velocity
   * prediction, tiered assignment and a size-consistency guard. Off by
   * default — the people profile keeps its nearest-center matching.
   */
  fastMovers?: boolean;
  /**
   * Identity memory: a track unmatched for more than `maxMisses` responses is
   * no longer reported, but is kept (hidden) for this long after its last
   * match, and a detection that lands in its gate re-adopts its id. 0 (default)
   * retires the track as soon as it is hidden, as before.
   */
  identityMs?: number;
  /**
   * Don't start a new track for a detection whose center lies inside a box
   * that matched an existing track in the same response (a YOLO double box or
   * a motion-fusion halo of the same bird). Off by default.
   */
  mergeOverlapping?: boolean;
  /** Longest gap a velocity estimate is taken across (default 500 ms). */
  maxVelDtMs?: number;
};

/**
 * Tracks detected people across detection responses so a box/ghost keeps a
 * stable identity (and color) even when the model briefly drops a detection.
 *
 * Each response, detections are matched to existing tracks by nearest center
 * (greedy). A matched track refreshes (life restored, box updated, velocity
 * re-estimated); an unmatched track loses a life but holds its last-known box;
 * once a track has gone unmatched for more than `maxMisses` responses it is
 * retired (or, with identity memory, hidden for a while first). New detections
 * start fresh tracks with a stable, never-changing color.
 *
 * The returned boxes are extrapolated forward along each track's velocity (see
 * "Motion prediction" above) so they lead a moving target instead of trailing
 * it. Matching still uses the raw last-detected box, so prediction never feeds
 * back into association — except in the fast-mover profile, where the match
 * center IS the prediction (that is what makes a bird trackable at all).
 */
export class PeopleTracker {
  private tracks: Track[] = [];
  private nextId = 0;
  private colorSeq = 0;
  /** Smoothed interval between detection responses (ms); drives lead time. */
  private avgIntervalMs = 0;
  /** Time of the previous update() call, for the interval estimate. */
  private lastUpdateMs = 0;

  private readonly maxMisses: number;
  private readonly withLead: boolean;
  private readonly fastMovers: boolean;
  private readonly identityMs: number;
  private readonly mergeOverlapping: boolean;
  private readonly maxVelDtMs: number;

  constructor(opts: PeopleTrackerOptions = {}) {
    this.maxMisses = opts.maxMisses ?? DEFAULT_MAX_MISSES;
    this.withLead = opts.withLead ?? true;
    this.fastMovers = opts.fastMovers ?? false;
    this.identityMs = opts.identityMs ?? 0;
    this.mergeOverlapping = opts.mergeOverlapping ?? false;
    this.maxVelDtMs = opts.maxVelDtMs ?? MAX_DT_MS;
  }

  update(detections: PersonBox[], nowMs: number): TrackedPersonBox[] {
    // Track the response cadence so lead time follows the real refresh rate.
    if (this.lastUpdateMs > 0) {
      const gap = nowMs - this.lastUpdateMs;
      if (gap >= MIN_DT_MS && gap <= MAX_DT_MS) {
        this.avgIntervalMs =
          this.avgIntervalMs === 0
            ? gap
            : INTERVAL_SMOOTH * this.avgIntervalMs +
              (1 - INTERVAL_SMOOTH) * gap;
      }
    }
    this.lastUpdateMs = nowMs;

    // Tiered greedy assignment: each tier claims detections closest-first and
    // later tiers only see what is left. Established, visible tracks go first
    // so a fresh speck with a wide initiation gate can never out-bid the bird
    // it appeared next to, and hidden (remembered) tracks go last so a ghost
    // can never steal a live bird's detection. The people profile keeps its
    // single flat pass over visible tracks, exactly as before.
    const hidden = (t: Track) => t.missed > this.maxMisses;
    const tiers: Track[][] = this.fastMovers
      ? [
          this.tracks.filter((t) => !hidden(t) && t.hits >= 2),
          this.tracks.filter((t) => !hidden(t) && t.hits < 2),
          this.tracks.filter(hidden),
        ]
      : [this.tracks.filter((t) => !hidden(t)), this.tracks.filter(hidden)];

    const usedD = new Set<number>();
    const matched = new Set<Track>();
    for (const tier of tiers) {
      if (tier.length === 0) continue;
      const pairs: { t: Track; di: number; cost: number }[] = [];
      for (const t of tier) {
        const ref = this.matchCenter(t, nowMs);
        const gate = this.gate(t, nowMs);
        detections.forEach((d, di) => {
          if (usedD.has(di)) return;
          const dc = center(d);
          const dist = Math.hypot(ref.x - dc.x, ref.y - dc.y);
          if (dist > gate) return;
          if (!this.fastMovers) {
            pairs.push({ t, di, cost: dist });
            return;
          }
          const ratio = maxSide(d) / Math.max(1e-6, maxSide(t.box));
          if (ratio > SIZE_RATIO_MAX || ratio < 1 / SIZE_RATIO_MAX) return;
          pairs.push({
            t,
            di,
            cost: dist / gate + SIZE_COST * Math.abs(Math.log(ratio)),
          });
        });
      }
      pairs.sort((a, b) => a.cost - b.cost);
      for (const p of pairs) {
        if (matched.has(p.t) || usedD.has(p.di)) continue;
        matched.add(p.t);
        usedD.add(p.di);
        this.refreshVelocity(p.t, detections[p.di], nowMs);
        p.t.box = detections[p.di];
        p.t.missed = 0;
        p.t.hits += 1;
      }
    }

    // Unmatched existing tracks lose a life but keep their last-known box.
    for (const t of this.tracks) {
      if (!matched.has(t)) t.missed += 1;
    }

    // Unmatched detections become new tracks with a stable color — unless
    // they are a second box on a bird that already matched this response.
    detections.forEach((d, di) => {
      if (usedD.has(di)) return;
      if (this.mergeOverlapping && this.isDuplicateOf(d, matched)) return;
      this.tracks.push({
        id: this.nextId++,
        color: this.colorSeq++ % 4,
        box: d,
        vx: 0,
        vy: 0,
        lastMs: nowMs,
        missed: 0,
        hits: 1,
      });
    });

    // Retire tracks that have gone unmatched for too long. With identity
    // memory a hidden track lingers (still matchable) until identityMs after
    // its last match.
    this.tracks = this.tracks.filter(
      (t) =>
        !hidden(t) ||
        (this.identityMs > 0 && nowMs - t.lastMs <= this.identityMs),
    );

    const lead = this.withLead
      ? Math.min(LEAD_CAP_MS, this.avgIntervalMs * LEAD_FACTOR)
      : 0;
    return this.tracks
      .filter((t) => !hidden(t))
      .map((t) => this.render(t, lead));
  }

  /** Where the track is expected to be now, for matching. */
  private matchCenter(t: Track, nowMs: number): { x: number; y: number } {
    const c = center(t.box);
    if (!this.fastMovers || t.hits < 2) return c;
    const gap = Math.max(0, nowMs - t.lastMs);
    const byCadence =
      this.avgIntervalMs > 0 ? 2 * this.avgIntervalMs : COAST_CAP_MS;
    const coast = Math.min(gap, byCadence, COAST_CAP_MS);
    return { x: c.x + t.vx * coast, y: c.y + t.vy * coast };
  }

  /** How far from matchCenter a detection may be and still be this track. */
  private gate(t: Track, nowMs: number): number {
    const base = allowedDist(t.box);
    if (!this.fastMovers) return base;
    const sigma = t.hits < 2 ? SIGMA_UNKNOWN_VEL : SIGMA_KNOWN_VEL;
    return Math.min(
      FAST_MAX_GATE,
      base + sigma * Math.max(0, nowMs - t.lastMs),
    );
  }

  /**
   * A detection centered inside the (freshly matched) box of a like-sized
   * track is that track's second box, not a new target. A much smaller box
   * inside a big one still counts — a bird crossing in front of a flock.
   */
  private isDuplicateOf(d: PersonBox, matched: Set<Track>): boolean {
    const dc = center(d);
    for (const t of matched) {
      const b = t.box;
      if (dc.x < b.x || dc.x > b.x + b.w || dc.y < b.y || dc.y > b.y + b.h) {
        continue;
      }
      const ratio = maxSide(d) / Math.max(1e-6, maxSide(b));
      if (ratio <= SIZE_RATIO_MAX && ratio >= 1 / SIZE_RATIO_MAX) return true;
    }
    return false;
  }

  /** Re-estimate a track's velocity from its center displacement since matched. */
  private refreshVelocity(t: Track, det: PersonBox, nowMs: number): void {
    const dt = nowMs - t.lastMs;
    if (dt >= MIN_DT_MS && dt <= this.maxVelDtMs) {
      const oc = center(t.box);
      const dc = center(det);
      const instVx = (dc.x - oc.x) / dt;
      const instVy = (dc.y - oc.y) / dt;
      if (t.hits <= 1) {
        // First displacement: take it as is — smoothing against the initial
        // zero would halve the first prediction and land it short.
        t.vx = instVx;
        t.vy = instVy;
      } else {
        t.vx = VEL_SMOOTH * t.vx + (1 - VEL_SMOOTH) * instVx;
        t.vy = VEL_SMOOTH * t.vy + (1 - VEL_SMOOTH) * instVy;
      }
    }
    t.lastMs = nowMs;
  }

  /** Lead the box forward along its velocity, capped so it can't fly off. */
  private render(t: Track, lead: number): TrackedPersonBox {
    let dx = t.vx * lead;
    let dy = t.vy * lead;
    // Cap the predicted jump to the same gate that bounds a real move, so an
    // erratic velocity estimate can never throw the box across the frame.
    const cap = allowedDist(t.box);
    const mag = Math.hypot(dx, dy);
    if (mag > cap) {
      dx = (dx / mag) * cap;
      dy = (dy / mag) * cap;
    }
    const x = clamp(t.box.x + dx, 0, 1 - t.box.w);
    const y = clamp(t.box.y + dy, 0, 1 - t.box.h);
    // src follows the last matched detection — a motion-only track that YOLO
    // later confirms correctly becomes a yolo track.
    return {
      x,
      y,
      w: t.box.w,
      h: t.box.h,
      id: t.id,
      color: t.color,
      conf: t.box.conf,
      src: t.box.src,
    };
  }
}
