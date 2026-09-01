/**
 * Duck free-flight model — the single source of truth for a duck's footprint and
 * position over time, shared by the server hit-test (DuckHunterController) and
 * the renderer (PacmanBirdsInput) so a shot lands exactly on the drawn sprite.
 *
 * A duck freezes at its spawn point for `pauseMs`, then flies off toward the
 * top-right at 45° (classic Duck Hunt) at `flySpeed` (fraction of the larger
 * output edge per second). Because position is a pure function of elapsed time,
 * both sides compute the same coordinates from the same `spawnAt`/params — the
 * hit-test and the sprite never disagree. All positions are in normalized
 * content space [0,1], the same space as aim/crosshairs/bursts.
 */

/** Sprite footprint vs the detection box; must stay the visual base in sync. */
export const DUCK_SPRITE_SCALE = 1.3;
/** Floor on the sprite side, as a fraction of min(output width, height). */
export const DUCK_MIN_SIDE_FRAC = 0.035;
/** How many ducks may be alive at once. */
export const MAX_DUCKS = 16;

/** Free-flight defaults (operator overrides via the Duck Hunter panel). */
export const DEFAULT_DUCK_PAUSE_MS = 700; // hold in place after appearing
export const DEFAULT_DUCK_FLY_FRAC_PER_SEC = 0.35; // ~2.9s to clear the frame

/** Death beat: hang in the shot pose, then drop off the bottom. */
export const DUCK_HANG_MS = 500;
export const DUCK_FALL_MS = 500;
export const DUCK_DEATH_MS = DUCK_HANG_MS + DUCK_FALL_MS;

/**
 * Hit flash: the shot duck lights up instead of the whole frame going dark.
 * A white-hot pop cools into a glow in the shooting player's color with an
 * expanding halo, and is fully over before the fall starts — so the drop
 * itself looks exactly as it always has. Screen dimming is now reserved for
 * the dog pop-up (two ducks in a row), which has its own envelope in inputs.tsx.
 */
export const HIT_FLASH_MS = 110; // white-hot core
export const HIT_RIM_MS = 320; // expanding halo
export const HIT_GLOW_MS = 460; // tint + brightness lift; < DUCK_HANG_MS
export const HIT_POP_MS = 190; // sprite scale-up settle
export const HIT_POP_SCALE = 0.28; // peak extra size (1.28x at the impact)
/** Shader box padding around the sprite, so the halo has room to spread. */
export const HIT_PAD = 1.45;

/** Per-stage strengths of the hit flash, all in [0,1]. */
export type HitFlashEnvelope = {
  /** Blend toward white — the impact itself. */
  flash: number;
  /** Brightness/saturation lift + player-color tint. */
  glow: number;
  /** Halo opacity. */
  rim: number;
  /** Halo expansion, 0 at the sprite edge → 1 at full reach. */
  rimT: number;
  /** Extra sprite scale. */
  pop: number;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Hit-flash envelope for a duck `elapsed` ms after it was shot. */
export function hitFlashEnvelope(elapsed: number): HitFlashEnvelope {
  if (!(elapsed >= 0) || elapsed >= DUCK_DEATH_MS) {
    return { flash: 0, glow: 0, rim: 0, rimT: 0, pop: 0 };
  }
  // White-hot core: full on at impact, fast quadratic decay.
  const f = 1 - clamp01(elapsed / HIT_FLASH_MS);
  // Halo: expands outward (rimT 0→1) while fading — a shockwave, not a steady
  // glow. Squared falloff so it reads as a snap rather than a slow bloom.
  const rimT = clamp01(elapsed / HIT_RIM_MS);
  // Tint + brightness: holds, then eases out before the fall begins.
  const g = 1 - clamp01(elapsed / HIT_GLOW_MS);
  // Scale pop: a quick overshoot that settles back to the true sprite size.
  const p = 1 - clamp01(elapsed / HIT_POP_MS);
  return {
    flash: f * f,
    glow: g * g * (3 - 2 * g),
    rim: (1 - rimT) * (1 - rimT),
    rimT,
    pop: p * p * p,
  };
}

export type DuckFlightParams = {
  /** Hold-in-place time after spawning, ms. */
  pauseMs: number;
  /** Fly speed as a fraction of the larger output edge per second. */
  flySpeed: number;
};

/** A spawned duck. Spawn state is frozen; position is a function of time. */
export type DuckEntity = {
  id: number;
  /** Palette index from the tracked box (duck-<color%3>-<frame> sprite). */
  color: number;
  /** Effective spawn time, ms. Pushed forward during a hit-stop freeze. */
  spawnAt: number;
  /** Spawn center in normalized content space [0,1]. */
  cx0: number;
  cy0: number;
  /** Sprite side as a fraction of the output width (frozen at spawn). */
  sideFrac: number;
  /** Wall-clock ms this duck was shot, or undefined while still flying. */
  diedAt?: number;
  /** Hex color of the player who shot it; tints the hit flash so the frame
   * says *who* scored. Undefined while still flying. */
  hitColor?: string;
};

/** Output geometry needed to project the 45° flight into content space. */
export type DuckViewport = {
  width: number;
  height: number;
  frameW: number;
  frameH: number;
};

/** True when the viewport dimensions are usable for the cover mapping. */
export function validViewport(v: DuckViewport): boolean {
  return v.width > 0 && v.height > 0 && v.frameW > 0 && v.frameH > 0;
}

function coverScale(v: DuckViewport): number {
  return Math.max(v.width / v.frameW, v.height / v.frameH) || 1;
}

/**
 * Sprite side (in output pixels) for a detection box, matching PacmanBirdsInput:
 * the box footprint scaled up by DUCK_SPRITE_SCALE * `mul`, with an on-screen
 * floor so a small/distant bird still reads as a duck.
 */
export function duckSidePx(
  boxW: number,
  boxH: number,
  mul: number,
  v: DuckViewport,
): number {
  const s = coverScale(v);
  const dispW = v.frameW * s;
  const dispH = v.frameH * s;
  const boxSide = Math.max(boxW * dispW, boxH * dispH);
  const floor = DUCK_MIN_SIDE_FRAC * mul * Math.min(v.width, v.height);
  return Math.max(DUCK_SPRITE_SCALE * mul * boxSide, floor);
}

/**
 * Duck center in normalized content space [0,1] at time `now`. The flight is a
 * pure function of (now - spawnAt), so the server and renderer agree exactly.
 */
export function duckContentPos(
  d: DuckEntity,
  now: number,
  p: DuckFlightParams,
  v: DuckViewport,
): { x: number; y: number } {
  const elapsed = Math.max(0, now - d.spawnAt);
  if (elapsed <= p.pauseMs) return { x: d.cx0, y: d.cy0 };
  const s = coverScale(v);
  const dispW = v.frameW * s;
  const dispH = v.frameH * s;
  // Output px travelled since the pause ended (45° → equal px on both axes).
  const travel =
    ((p.flySpeed * Math.max(v.width, v.height)) / 1000) * (elapsed - p.pauseMs);
  return {
    x: d.cx0 + travel / dispW, // fly right
    y: d.cy0 - travel / dispH, // and up
  };
}

/** Project a content-space point [0,1] to output pixels (cover mapping). */
export function contentToPx(
  x: number,
  y: number,
  v: DuckViewport,
): { px: number; py: number } {
  const s = coverScale(v);
  const dispW = v.frameW * s;
  const dispH = v.frameH * s;
  const offX = (v.width - dispW) / 2;
  const offY = (v.height - dispH) / 2;
  return { px: offX + x * dispW, py: offY + y * dispH };
}
