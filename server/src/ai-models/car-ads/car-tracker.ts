import type {
  CarAdDetection,
  CarQuad,
  CarWheel,
  PersonBox,
  TrackedCarAd,
} from '../../app/store';

type Track = {
  id: number;
  /** Last raw detected box (used for matching — never extrapolated). */
  box: PersonBox;
  /** EMA-smoothed ad quad, or null while the wheels haven't been seen yet. */
  quad: CarQuad | null;
  /** Responses since the quad was last confirmed by an actual wheel pair. */
  quadStale: number;
  /** Last raw wheels (debug overlay). */
  wheels: CarWheel[] | null;
  /** Consecutive detection responses this track went unmatched. */
  missed: number;
};

/** Number of responses a track survives without a matching detection. */
const DEFAULT_MAX_MISSES = 4;
/**
 * Wheel detection is flakier than the car detection itself (Hough drops the
 * pair when a wheel blurs or occludes), so a confirmed quad is held — translated
 * along with the car — for this many responses before the ad is taken down.
 */
const QUAD_HOLD_RESPONSES = 8;
/** EMA weight of the previous quad on a fresh wheel confirmation. */
const QUAD_SMOOTH = 0.5;

// Matching gates — same scheme as PeopleTracker: a track may only match a
// detection within a radius that scales with its own box size, hard-capped so
// it can never reach across a large part of the frame.
const MATCH_SIZE_FACTOR = 1.5;
const MATCH_MIN_DIST = 0.03;
const MATCH_MAX_DIST = 0.15; // cars are bigger/faster than people — wider cap

const center = (b: PersonBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

const allowedDist = (box: PersonBox) =>
  Math.max(
    MATCH_MIN_DIST,
    Math.min(MATCH_MAX_DIST, MATCH_SIZE_FACTOR * Math.max(box.w, box.h)),
  );

const translateQuad = (quad: CarQuad, dx: number, dy: number): CarQuad =>
  quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as CarQuad;

const emaQuad = (prev: CarQuad, next: CarQuad): CarQuad =>
  prev.map((p, i) => ({
    x: QUAD_SMOOTH * p.x + (1 - QUAD_SMOOTH) * next[i].x,
    y: QUAD_SMOOTH * p.y + (1 - QUAD_SMOOTH) * next[i].y,
  })) as CarQuad;

/**
 * Tracks detected vehicles across detection responses so each keeps a stable
 * identity, and smooths/holds its ad quad:
 *
 * - Detections match tracks by nearest box center (greedy), like PeopleTracker.
 * - A fresh wheel-confirmed quad is EMA-blended into the track's quad so the
 *   ad doesn't jitter with per-frame Hough noise.
 * - A response whose wheels dropped out keeps the last quad, translated along
 *   with the car's box, for up to QUAD_HOLD_RESPONSES — brief wheel dropouts
 *   don't blink the ad, but a stale quad can't drift wrongly forever.
 *
 * No motion lead here: the renderer (CarAdsInput) dead-reckons the drawn quad
 * between responses itself via MotionPredictor, so this tracker returns raw
 * positions — leading them too would predict the same motion twice.
 */
export class CarTracker {
  private tracks: Track[] = [];
  private nextId = 0;

  constructor(private readonly maxMisses = DEFAULT_MAX_MISSES) {}

  update(detections: CarAdDetection[], _nowMs: number): TrackedCarAd[] {
    const pairs: { ti: number; di: number; dist: number }[] = [];
    this.tracks.forEach((t, ti) => {
      const tc = center(t.box);
      const gate = allowedDist(t.box);
      detections.forEach((d, di) => {
        const dc = center(d.box);
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
      this.refreshTrack(this.tracks[p.ti], detections[p.di]);
    }

    // Unmatched existing tracks lose a life but keep their last-known state.
    this.tracks.forEach((t, ti) => {
      if (!usedT.has(ti)) t.missed += 1;
    });

    // Unmatched detections become new tracks.
    detections.forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({
        id: this.nextId++,
        box: d.box,
        quad: d.quad ?? null,
        quadStale: 0,
        wheels: d.wheels ?? null,
        missed: 0,
      });
    });

    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMisses);

    return this.tracks.map((t) => ({
      id: t.id,
      box: t.box,
      quad: t.quad ?? undefined,
      wheels: t.wheels ?? undefined,
    }));
  }

  private refreshTrack(t: Track, det: CarAdDetection): void {
    const oc = center(t.box);
    const dc = center(det.box);

    if (det.quad) {
      t.quad = t.quad ? emaQuad(t.quad, det.quad) : det.quad;
      t.quadStale = 0;
    } else if (t.quad) {
      // Wheels dropped out this response: carry the quad with the car until
      // the hold budget runs out.
      t.quadStale += 1;
      if (t.quadStale > QUAD_HOLD_RESPONSES) {
        t.quad = null;
      } else {
        t.quad = translateQuad(t.quad, dc.x - oc.x, dc.y - oc.y);
      }
    }
    t.wheels = det.wheels ?? t.wheels;
    t.box = det.box;
    t.missed = 0;
  }
}
