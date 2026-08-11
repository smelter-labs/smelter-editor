import type { TrackedPersonBox } from '../../app/store';

/**
 * Hard cap on the wobble, well below PeopleTracker's MATCH_MIN_DIST (0.03) —
 * see the note on ordering below for why that matters even though this runs
 * after association.
 */
const MAX_AMP = 0.01;
/** Golden angle: consecutive track ids never land in phase with each other. */
const PHASE_STEP = 2.3999632;
/** Peak size wobble, as a fraction of the box (breathing, not pulsing). */
const BREATH = 0.06;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Adds a slight, continuous wobble to tracked boxes so a replayed/keyed
 * detection reads as a live detector rather than a rigid animation.
 *
 * Applied *after* tracking, deliberately. PeopleTracker associates detections
 * against each track's last raw box, so jitter added downstream can never
 * perturb matching or the velocity estimate — jittering in the worker instead
 * would feed the wobble back into the tracker's motion lead, which amplifies
 * it into visible swimming. Keying off the stable track id (rather than time
 * alone) also keeps each box's wobble coherent frame to frame; white noise per
 * response reads as static, not as life.
 *
 * Two incommensurate frequencies per axis keep the drift from visibly looping.
 */
export function jitterBoxes(
  boxes: TrackedPersonBox[],
  amp: number,
  nowMs: number,
): TrackedPersonBox[] {
  if (!(amp > 0)) return boxes;
  const a = Math.min(MAX_AMP, amp);
  const t = nowMs / 1000;
  return boxes.map((b) => {
    const p = b.id * PHASE_STEP;
    const dx =
      a * (0.6 * Math.sin(2.1 * t + p) + 0.4 * Math.sin(3.7 * t + 1.7 * p));
    const dy =
      a *
      (0.6 * Math.sin(1.9 * t + 1.3 * p) + 0.4 * Math.sin(4.3 * t + 0.7 * p));
    // Breathing scales with the slider too, so turning jitter down tightens the
    // box on the marker instead of leaving it pulsing at full depth.
    const scale = 1 + BREATH * (a / MAX_AMP) * Math.sin(1.3 * t + p);
    // Capped at the frame: breathing a box that already spans the whole width
    // would otherwise push its outline off-screen.
    const w = Math.min(1, b.w * scale);
    const h = Math.min(1, b.h * scale);
    return {
      ...b,
      w,
      h,
      // Grow around the centre, then keep the box inside the frame.
      x: clamp(b.x + dx - (w - b.w) / 2, 0, Math.max(0, 1 - w)),
      y: clamp(b.y + dy - (h - b.h) / 2, 0, Math.max(0, 1 - h)),
    };
  });
}
