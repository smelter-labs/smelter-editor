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

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Max distance this track is allowed to move to accept a detection. */
const allowedDist = (box: PersonBox) =>
  Math.max(
    MATCH_MIN_DIST,
    Math.min(MATCH_MAX_DIST, MATCH_SIZE_FACTOR * Math.max(box.w, box.h)),
  );

/**
 * Tracks detected people across detection responses so a box/ghost keeps a
 * stable identity (and color) even when the model briefly drops a detection.
 *
 * Each response, detections are matched to existing tracks by nearest center
 * (greedy). A matched track refreshes (life restored, box updated, velocity
 * re-estimated); an unmatched track loses a life but holds its last-known box;
 * once a track has gone unmatched for more than `maxMisses` responses it is
 * retired. New detections start fresh tracks with a stable, never-changing
 * color.
 *
 * The returned boxes are extrapolated forward along each track's velocity (see
 * "Motion prediction" above) so they lead a moving target instead of trailing
 * it. Matching still uses the raw last-detected box, so prediction never feeds
 * back into association.
 */
export class PeopleTracker {
  private tracks: Track[] = [];
  private nextId = 0;
  private colorSeq = 0;
  /** Smoothed interval between detection responses (ms); drives lead time. */
  private avgIntervalMs = 0;
  /** Time of the previous update() call, for the interval estimate. */
  private lastUpdateMs = 0;

  /**
   * `withLead` extrapolates returned boxes forward along their velocity (see
   * "Motion prediction" above) — right for renderers that freeze the box
   * between responses. Pass false when the renderer dead-reckons on its own
   * (e.g. the car-hue overlay), so motion isn't predicted twice.
   */
  constructor(
    private readonly maxMisses = DEFAULT_MAX_MISSES,
    private readonly withLead = true,
  ) {}

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

    // Build all candidate (track, detection) pairs within the match radius,
    // then assign greedily from closest to farthest so each side is used once.
    const pairs: { ti: number; di: number; dist: number }[] = [];
    this.tracks.forEach((t, ti) => {
      const tc = center(t.box);
      const gate = allowedDist(t.box);
      detections.forEach((d, di) => {
        const dc = center(d);
        const dist = Math.hypot(tc.x - dc.x, tc.y - dc.y);
        if (dist <= gate) pairs.push({ ti, di, dist });
      });
    });
    pairs.sort((a, b) => a.dist - b.dist);

    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      usedT.add(p.ti);
      usedD.add(p.di);
      const t = this.tracks[p.ti];
      this.refreshVelocity(t, detections[p.di], nowMs);
      t.box = detections[p.di];
      t.missed = 0;
    }

    // Unmatched existing tracks lose a life but keep their last-known box.
    this.tracks.forEach((t, ti) => {
      if (!usedT.has(ti)) t.missed += 1;
    });

    // Unmatched detections become new tracks with a stable color.
    detections.forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({
        id: this.nextId++,
        color: this.colorSeq++ % 4,
        box: d,
        vx: 0,
        vy: 0,
        lastMs: nowMs,
        missed: 0,
      });
    });

    // Retire tracks that have gone unmatched for too long.
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMisses);

    const lead = this.withLead
      ? Math.min(LEAD_CAP_MS, this.avgIntervalMs * LEAD_FACTOR)
      : 0;
    return this.tracks.map((t) => this.render(t, lead));
  }

  /** Re-estimate a track's velocity from its center displacement since matched. */
  private refreshVelocity(t: Track, det: PersonBox, nowMs: number): void {
    const dt = nowMs - t.lastMs;
    if (dt >= MIN_DT_MS && dt <= MAX_DT_MS) {
      const oc = center(t.box);
      const dc = center(det);
      const instVx = (dc.x - oc.x) / dt;
      const instVy = (dc.y - oc.y) / dt;
      t.vx = VEL_SMOOTH * t.vx + (1 - VEL_SMOOTH) * instVx;
      t.vy = VEL_SMOOTH * t.vy + (1 - VEL_SMOOTH) * instVy;
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
    return { x, y, w: t.box.w, h: t.box.h, id: t.id, color: t.color };
  }
}
