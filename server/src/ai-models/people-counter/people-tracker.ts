import type { PersonBox, TrackedPersonBox } from '../../app/store';

type Track = {
  id: number;
  color: number;
  box: PersonBox;
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

const center = (b: PersonBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

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
 * (greedy). A matched track refreshes (life restored, box updated); an
 * unmatched track loses a life but holds its last-known box; once a track has
 * gone unmatched for more than `maxMisses` responses it is retired. New
 * detections start fresh tracks with a stable, never-changing color.
 */
export class PeopleTracker {
  private tracks: Track[] = [];
  private nextId = 0;
  private colorSeq = 0;

  constructor(private readonly maxMisses = DEFAULT_MAX_MISSES) {}

  update(detections: PersonBox[]): TrackedPersonBox[] {
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
        missed: 0,
      });
    });

    // Retire tracks that have gone unmatched for too long.
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMisses);

    return this.tracks.map((t) => ({ ...t.box, id: t.id, color: t.color }));
  }
}
