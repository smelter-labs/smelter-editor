/**
 * Dead-reckoning between AI detection responses.
 *
 * Detections arrive only ~4–6×/s while the output renders at ~60fps, so a
 * renderer that merely eases toward the latest detection sits still for most
 * of each interval and a moving car visibly outruns its overlay. This
 * predictor keeps a per-track velocity estimate (EMA over consecutive
 * updates) and extrapolates the target forward every render tick; each new AI
 * response then corrects the estimate — driving, turning and stopping are all
 * near-linear at the 150–250ms response scale, so the correction stays small.
 *
 * Targets are plain numeric vectors, so the same predictor serves box rects
 * (cx, cy, hw, hh) and ad quads (8 corner coords) alike.
 */

type Entry = {
  /** Last observed target vector. */
  target: number[];
  /** Wall-clock ms of the last update. */
  at: number;
  /** Per-component velocity (units/ms), EMA-smoothed. */
  vel: number[];
  /** Smoothed spacing between updates (ms); bounds the extrapolation. */
  intervalMs: number;
};

/** EMA weight of the previous velocity (higher = smoother, laggier). */
const VEL_SMOOTH = 0.5;
/** EMA weight of the previous inter-update interval estimate. */
const INTERVAL_SMOOTH = 0.6;
/** Ignore dt outside this band when estimating velocity (startup / gaps). */
const MIN_DT_MS = 10;
const MAX_DT_MS = 800;
/**
 * Never extrapolate further than this many observed intervals past the last
 * update (hard-capped in ms) — when responses stop coming the overlay freezes
 * in place instead of flying off along stale velocity.
 */
const MAX_EXTRAP_INTERVALS = 1.5;
const MAX_EXTRAP_MS = 600;

export class MotionPredictor {
  private readonly entries = new Map<number, Entry>();

  /** Feed the latest observed target for a track (call once per AI response). */
  update(id: number, target: number[], nowMs: number): void {
    const prev = this.entries.get(id);
    if (!prev || prev.target.length !== target.length) {
      this.entries.set(id, {
        target: [...target],
        at: nowMs,
        vel: target.map(() => 0),
        intervalMs: 0,
      });
      return;
    }
    const dt = nowMs - prev.at;
    if (dt >= MIN_DT_MS && dt <= MAX_DT_MS) {
      prev.intervalMs =
        prev.intervalMs === 0
          ? dt
          : INTERVAL_SMOOTH * prev.intervalMs + (1 - INTERVAL_SMOOTH) * dt;
      for (let i = 0; i < target.length; i++) {
        const inst = (target[i] - prev.target[i]) / dt;
        prev.vel[i] = VEL_SMOOTH * prev.vel[i] + (1 - VEL_SMOOTH) * inst;
      }
    } else if (dt > MAX_DT_MS) {
      // Long gap — the stale velocity says nothing about where the car is now.
      prev.vel.fill(0);
    }
    prev.target = [...target];
    prev.at = nowMs;
  }

  /**
   * The track's expected position at `nowMs`: last target led forward along
   * the estimated velocity, capped so it can't run ahead of what one-or-so
   * missed responses could plausibly explain.
   */
  predict(id: number, nowMs: number): number[] | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    const cap =
      e.intervalMs > 0
        ? Math.min(MAX_EXTRAP_MS, e.intervalMs * MAX_EXTRAP_INTERVALS)
        : 0;
    const horizon = Math.min(Math.max(0, nowMs - e.at), cap);
    return e.target.map((t, i) => t + e.vel[i] * horizon);
  }

  /** Drop state for tracks that no longer exist. */
  prune(liveIds: ReadonlySet<number>): void {
    for (const id of [...this.entries.keys()]) {
      if (!liveIds.has(id)) this.entries.delete(id);
    }
  }
}
