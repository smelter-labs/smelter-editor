/**
 * Haunting-ghosts model — pure logic for the ambient "haunting ghosts" effect
 * (HaunterGhostsInput). A fixed pool of ghost sprites floats over the video;
 * each ghost latches onto the nearest tracked person within a distance
 * threshold (1:1 — one ghost per person). Latching runs a three-state arc:
 * bored (nobody in range, idle drift) → looking (someone entered range; the
 * ghost notices them but holds still for LOOKING_MS) → hunting (chases above
 * the head and scares). When its person leaves the frame the ghost drops back
 * to bored, idling in place until someone unclaimed drifts into range.
 *
 * All positions are in output pixels: content space is anisotropic (x/y are
 * normalized to different frame edges), so distances are only meaningful after
 * projecting through the cover mapping (`contentToPx`). The functions here are
 * pure/mutating-in-place with no timers or randomness, so the assignment and
 * motion rules are unit-testable.
 */

import type { TrackedPersonBox } from '../app/store';
import { clamp } from '../core/mathUtils';
import { contentToPx, type DuckViewport } from '../duckHunter/duckFlight';

/** Hard cap on the ghost pool (also mirrored by the panel slider). */
export const MAX_HAUNTERS = 8;

/** Operator defaults (Haunter panel overrides, clamped in RoomState). */
export const DEFAULT_HAUNTER_COUNT = 3;
/** Attach threshold as a fraction of min(output width, height). */
export const DEFAULT_HAUNTER_DIST = 0.35;
export const DEFAULT_HAUNTER_SCALE = 1;
export const DEFAULT_HAUNTER_SPEED = 1;

/** How long a ghost only *looks* at a newly-noticed person before hunting. */
export const LOOKING_MS = 1000;

/** Sprite side as a fraction of min(output width, height), before `scale`. */
const BASE_SIDE_FRAC = 0.14;
/** How far above the head the ghost hovers, in sprite sides. */
const HOVER_LIFT = 0.65;
/** Fraction of the remaining distance closed per second (before the cap). */
const EASE_PER_S = 4;
/** Speed cap as a fraction of min(w, h) per second, at speed 1 — the ghost
 * visibly chases a fast-moving person instead of teleporting onto them. */
const MAX_SPEED_FRAC = 0.6;
/** Idle speed cap (no target), same units — a released ghost floats back up
 * to its home row slowly instead of chasing the anchor at hunt speed. */
const IDLE_SPEED_FRAC = 0.05;
/** Always-on vertical bob (the ghost never sits perfectly still). */
const BOB_PERIOD_MS = 2400;
const BOB_AMP_FRAC = 0.015;
/** Idle drift: a slow lissajous wander around the anchor point. */
const DRIFT_X_PERIOD_MS = 5200;
const DRIFT_Y_PERIOD_MS = 3800;
const DRIFT_X_FRAC = 0.03;
const DRIFT_Y_FRAC = 0.02;
/** Spawn/home row, as a fraction of the output height. Ghosts start here and
 * drift back up to it after losing their person. */
const HOME_Y_FRAC = 0.28;

const TAU = Math.PI * 2;

export type HaunterGhost = {
  idx: number;
  /** Current position (sprite center), output px. */
  px: number;
  py: number;
  /** Tracked person id this ghost is haunting, or null while idle. */
  targetId: number | null;
  /** When the current target was noticed (ms); null while idle. Drives the
   * looking → hunting transition (LOOKING_MS after acquisition). */
  targetSince: number | null;
  /** Where the ghost idles, output px: it keeps the x where it lost its
   * person but floats back up to the home row (HOME_Y_FRAC). */
  anchorX: number;
  anchorY: number;
  /** Fixed per-ghost phase so bobs/drifts don't move in lock-step. */
  phase: number;
};

/** Sprite/behavior state: bored (idle) → looking (noticed, holds still for
 * LOOKING_MS) → hunting (chases and scares). Matches the ghost_<state>.png
 * art in imgs/ghosts. */
export type HaunterState = 'bored' | 'looking' | 'hunting';

/** Derive the ghost's arc state at `now` from its target/acquisition time. */
export function haunterState(g: HaunterGhost, now: number): HaunterState {
  if (g.targetId == null) return 'bored';
  if (g.targetSince != null && now - g.targetSince < LOOKING_MS) {
    return 'looking';
  }
  return 'hunting';
}

export function clampHaunterCount(count: number): number {
  return Math.round(clamp(count, 1, MAX_HAUNTERS));
}

/** Sprite side in output px for the operator's size multiplier. */
export function haunterSidePx(
  scale: number,
  width: number,
  height: number,
): number {
  return BASE_SIDE_FRAC * scale * Math.min(width, height);
}

function makeGhost(
  idx: number,
  count: number,
  width: number,
  height: number,
): HaunterGhost {
  // Spread evenly across the top band; golden-angle phase desyncs the motion.
  const px = ((idx + 0.5) / Math.max(1, count)) * width;
  const py = HOME_Y_FRAC * height;
  return {
    idx,
    px,
    py,
    targetId: null,
    targetSince: null,
    anchorX: px,
    anchorY: py,
    phase: idx * 2.399,
  };
}

export function spawnGhosts(
  count: number,
  width: number,
  height: number,
): HaunterGhost[] {
  const n = clampHaunterCount(count);
  return Array.from({ length: n }, (_, i) => makeGhost(i, n, width, height));
}

/**
 * Match the pool to a new operator-set count without disturbing survivors:
 * shrink drops the highest indices, grow appends fresh idle ghosts.
 */
export function reconcileCount(
  ghosts: HaunterGhost[],
  count: number,
  width: number,
  height: number,
): HaunterGhost[] {
  const n = clampHaunterCount(count);
  if (ghosts.length === n) return ghosts;
  if (ghosts.length > n) return ghosts.slice(0, n);
  const grown = ghosts.slice();
  for (let i = ghosts.length; i < n; i++) {
    grown.push(makeGhost(i, n, width, height));
  }
  return grown;
}

/** Hover spot above the person's head, kept on-screen. */
export function hoverTargetPx(
  box: TrackedPersonBox,
  v: DuckViewport,
  sidePx: number,
): { px: number; py: number } {
  const head = contentToPx(box.x + box.w / 2, box.y, v);
  return {
    px: clamp(head.px, sidePx / 2, v.width - sidePx / 2),
    py: clamp(head.py - sidePx * HOVER_LIFT, sidePx / 2, v.height - sidePx / 2),
  };
}

/**
 * Update ghost↔person assignments for a new detection frame (mutates ghosts):
 * 1. Sticky retention — a ghost keeps its person while that track id exists
 *    (even if someone else is closer). When the id disappears the ghost is
 *    released and anchors at its current x on the home row, so it slowly
 *    floats back to the top of the screen.
 * 2. 1:1 greedy assignment — free ghosts × unclaimed people within
 *    `thresholdPx`, closest pair first; ties break on (ghost.idx, person.id)
 *    so the result is deterministic. A fresh assignment stamps `targetSince`
 *    with `now`, starting the looking → hunting timer.
 */
export function assignGhosts(
  ghosts: HaunterGhost[],
  boxes: TrackedPersonBox[],
  v: DuckViewport,
  thresholdPx: number,
  now: number,
): void {
  const present = new Set(boxes.map((b) => b.id));
  for (const g of ghosts) {
    if (g.targetId != null && !present.has(g.targetId)) {
      g.targetId = null;
      g.targetSince = null;
      g.anchorX = g.px;
      g.anchorY = HOME_Y_FRAC * v.height;
    }
  }

  const claimed = new Set<number>();
  for (const g of ghosts) {
    if (g.targetId != null) claimed.add(g.targetId);
  }

  const pairs: { d: number; g: HaunterGhost; b: TrackedPersonBox }[] = [];
  for (const g of ghosts) {
    if (g.targetId != null) continue;
    for (const b of boxes) {
      if (claimed.has(b.id)) continue;
      const c = contentToPx(b.x + b.w / 2, b.y + b.h / 2, v);
      const d = Math.hypot(c.px - g.px, c.py - g.py);
      if (d <= thresholdPx) pairs.push({ d, g, b });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.g.idx - b.g.idx || a.b.id - b.b.id);

  const usedGhosts = new Set<number>();
  for (const { g, b } of pairs) {
    if (usedGhosts.has(g.idx) || claimed.has(b.id)) continue;
    usedGhosts.add(g.idx);
    claimed.add(b.id);
    g.targetId = b.id;
    g.targetSince = now;
  }
}

/**
 * Advance one ghost by `dtMs` toward its hover target (attached) or its idle
 * drift orbit (target null). Idle motion runs under the much lower
 * IDLE_SPEED_FRAC cap, so the trip back to the home row reads as a slow
 * float, not a chase. Mutates `g.px/py`; returns the draw position, which
 * adds the ever-present vertical bob on top.
 */
export function stepGhost(
  g: HaunterGhost,
  target: { px: number; py: number } | null,
  dtMs: number,
  now: number,
  speed: number,
  width: number,
  height: number,
): { px: number; py: number } {
  const minEdge = Math.min(width, height);
  let tx: number;
  let ty: number;
  if (target) {
    tx = target.px;
    ty = target.py;
  } else {
    tx =
      g.anchorX +
      Math.sin((now / DRIFT_X_PERIOD_MS) * TAU + g.phase) *
        DRIFT_X_FRAC *
        minEdge;
    ty =
      g.anchorY +
      Math.sin((now / DRIFT_Y_PERIOD_MS) * TAU + 1.7 * g.phase) *
        DRIFT_Y_FRAC *
        minEdge;
  }

  const k = Math.min(1, (EASE_PER_S * speed * dtMs) / 1000);
  let dx = (tx - g.px) * k;
  let dy = (ty - g.py) * k;
  const maxStep =
    ((target ? MAX_SPEED_FRAC : IDLE_SPEED_FRAC) * speed * minEdge * dtMs) /
    1000;
  const len = Math.hypot(dx, dy);
  if (len > maxStep && len > 0) {
    dx *= maxStep / len;
    dy *= maxStep / len;
  }
  g.px += dx;
  g.py += dy;

  const bob =
    Math.sin((now / BOB_PERIOD_MS) * TAU + g.phase) * BOB_AMP_FRAC * minEdge;
  return { px: g.px, py: g.py + bob };
}
