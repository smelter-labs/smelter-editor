/**
 * The calibration test range: three sample ducks the player bags to confirm the
 * axis mapping feels right before joining a real match. Entirely client-side —
 * nothing here touches the server, which owns hit detection for the actual game.
 *
 * Kept as plain functions rather than inline React state updates because a
 * `setState` updater must be *pure*: React re-invokes it (StrictMode in dev,
 * render restarts in production), and an updater that latched "already hit one"
 * in a closure variable silently dropped the hit on the second pass.
 */

export type PracticeTarget = { id: number; x: number; y: number; hit: boolean };

/**
 * Normalized range coordinates. The range box fills whatever space the viewport
 * gives it, so these are fractions of its width/height, not pixels.
 */
export const PRACTICE_SPOTS = [
  { x: 0.22, y: 0.3 },
  { x: 0.72, y: 0.24 },
  { x: 0.5, y: 0.62 },
] as const;

// Hit radius in normalized aim units, NOT screen pixels: the gyro moves the
// crosshair by an equal fraction of each axis per degree of rotation, so a
// round circle in this space costs the same wrist movement horizontally and
// vertically no matter how tall the range box is. (0.12 ≈ 11° of rotation.)
export const PRACTICE_HIT_RADIUS = 0.12;

export function freshPractice(): PracticeTarget[] {
  return PRACTICE_SPOTS.map((s, i) => ({ id: i, x: s.x, y: s.y, hit: false }));
}

/**
 * Which duck a shot at `aim` bags — the first standing one inside the hit
 * radius, or null for a miss. A pure read, so the caller can also use it to
 * pick the haptic pattern without depending on when React runs an updater.
 */
export function pickPracticeHit(
  targets: readonly PracticeTarget[],
  aim: { x: number; y: number },
): number | null {
  for (const t of targets) {
    if (t.hit) continue;
    if (Math.hypot(aim.x - t.x, aim.y - t.y) <= PRACTICE_HIT_RADIUS)
      return t.id;
  }
  return null;
}

/**
 * Marks one duck down. Pure and idempotent — running it twice on the same input
 * gives the same output, which is what makes it safe as a `setState` updater.
 * Returns the original array when nothing changes, so React can bail out.
 */
export function markPracticeHit(
  targets: PracticeTarget[],
  id: number | null,
): PracticeTarget[] {
  if (id === null) return targets;
  const idx = targets.findIndex((t) => t.id === id);
  if (idx < 0 || targets[idx].hit) return targets;
  const next = targets.slice();
  next[idx] = { ...targets[idx], hit: true };
  return next;
}
