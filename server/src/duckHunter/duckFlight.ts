/**
 * Duck free-flight model — the single source of truth for a duck's footprint and
 * position over time, shared by the server hit-test (DuckHunterController) and
 * the renderer (PacmanBirdsInput) so a shot lands exactly on the drawn sprite.
 *
 * A spawn is telegraphed first: the aura marks the source bird for
 * `auraLeadMs` before the duck itself appears (drawn + shootable). The duck
 * then freezes at its spawn point for `pauseMs` more, and flies off toward the
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
export const DEFAULT_DUCK_FLY_FRAC_PER_SEC = 0.15; // ~6.7s to clear the frame

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

/**
 * Spawn aura — the mark on the *real bird* a duck hatched from, so a viewer can
 * see which detection in the video turned into which sprite. Drawn by the
 * `duck-spawn-aura` shader on the video underneath the ducks.
 *
 * It is a telegraph: a shockwave ring plus a soft lock-on ring mark the bird
 * for `auraLeadMs` *before* the duck exists on screen. The moment the duck
 * appears, the mark has done its job and fades out.
 */
/** Telegraph default: how long the aura marks the bird before the duck
 * appears (operator override via the Duck Hunter panel — `duckAuraLeadMs`). */
export const DEFAULT_DUCK_AURA_LEAD_MS = 1500;
/** Birth shockwave: how long the ring takes to reach full expansion. */
export const AURA_PULSE_MS = 620;
/** Fade-in of the steady lock-on ring, so a spawn doesn't snap on. */
export const AURA_IN_MS = 160;
/** Tether lifetime, measured from the moment the duck starts flying. */
export const AURA_LINK_MS = 900;
/** Fade-out once the duck has appeared (or been shot) — the mark's job is
 * done, so it leaves the bird. */
export const AURA_OUT_MS = 380;

/** Per-stage strengths of a bird's spawn aura, all in [0,1]. */
export type SpawnAuraEnvelope = {
  /** Steady lock-on ring + bloom + subject lift. */
  glow: number;
  /** Birth shockwave opacity. */
  pulse: number;
  /** Shockwave expansion, 0 at the ring → 1 at full reach. */
  pulseT: number;
  /** Tether opacity (bird → duck). */
  link: number;
};

const AURA_SILENT: SpawnAuraEnvelope = {
  glow: 0,
  pulse: 0,
  pulseT: 0,
  link: 0,
};

/**
 * Aura envelope for a duck `age` ms after it spawned (spawn = the start of the
 * telegraph; the duck itself appears at `p.auraLeadMs`). `p.pauseMs` is the
 * duck's hold-in-place time after appearing (the tether only means something
 * once the duck has actually left the bird), and `sinceDeath` is ms since it
 * was shot, or null while it is still flying.
 */
export function spawnAuraEnvelope(
  age: number,
  p: Pick<DuckFlightParams, 'auraLeadMs' | 'pauseMs'>,
  sinceDeath: number | null,
): SpawnAuraEnvelope {
  if (!(age >= 0)) return AURA_SILENT;
  // The mark fades the moment its duck appears — the telegraph is over. A shot
  // duck takes it along even sooner (only possible with a fade still running).
  const appearFade = 1 - clamp01((age - p.auraLeadMs) / AURA_OUT_MS);
  const dying = sinceDeath != null && sinceDeath >= 0;
  const deathFade = dying ? 1 - clamp01(sinceDeath / AURA_OUT_MS) : 1;
  const fade = Math.min(appearFade, deathFade);
  if (fade <= 0) return AURA_SILENT;

  // Shockwave: races outward while fading, squared so it reads as a snap.
  const pulseT = clamp01(age / AURA_PULSE_MS);
  const pulse = (1 - pulseT) * (1 - pulseT) * fade;
  // Steady ring: eases in, then holds until the duck appears.
  const glow = clamp01(age / AURA_IN_MS) * fade;
  // Tether: nothing while the duck still sits on the bird, then a quick decay
  // once it detaches. With the aura already fading by then, it only shows for
  // short pauses (pauseMs < AURA_OUT_MS), where the lingering mark gets a line
  // to the duck that just left it.
  const flown = age - p.auraLeadMs - Math.max(0, p.pauseMs);
  const l = flown <= 0 ? 0 : 1 - clamp01(flown / AURA_LINK_MS);
  return { glow, pulse, pulseT, link: l * l * fade };
}

export type DuckFlightParams = {
  /** Telegraph: how long the aura marks the bird before the duck appears, ms. */
  auraLeadMs: number;
  /** Hold-in-place time after appearing (i.e. after the aura lead), ms. */
  pauseMs: number;
  /** Fly speed as a fraction of the larger output edge per second. */
  flySpeed: number;
};

/** A spawned duck. Spawn state is frozen; position is a function of time. */
export type DuckEntity = {
  id: number;
  /** Palette index from the tracked box (duck-<color%3>-<frame> sprite). */
  color: number;
  /** Effective spawn time (start of the aura telegraph — the sprite appears
   * `auraLeadMs` later), ms. Pushed forward during a hit-stop freeze. */
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
 * True once the duck sprite is actually on screen — for the first `auraLeadMs`
 * after spawnAt only the aura telegraphs it. An unappeared duck is neither
 * drawn nor shootable.
 */
export function duckAppeared(
  d: DuckEntity,
  now: number,
  auraLeadMs: number,
): boolean {
  return now - d.spawnAt >= auraLeadMs;
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
  // Telegraph, then hold: the duck sits at its spawn point through the aura
  // lead and the pause that follows its appearance.
  const holdMs = p.auraLeadMs + p.pauseMs;
  if (elapsed <= holdMs) return { x: d.cx0, y: d.cy0 };
  const s = coverScale(v);
  const dispW = v.frameW * s;
  const dispH = v.frameH * s;
  // Output px travelled since the pause ended (45° → equal px on both axes).
  const travel =
    ((p.flySpeed * Math.max(v.width, v.height)) / 1000) * (elapsed - holdMs);
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

/** Inverse of contentToPx: output pixels back to content space [0,1]. */
export function pxToContent(
  px: number,
  py: number,
  v: DuckViewport,
): { x: number; y: number } {
  const s = coverScale(v);
  const dispW = v.frameW * s;
  const dispH = v.frameH * s;
  const offX = (v.width - dispW) / 2;
  const offY = (v.height - dispH) / 2;
  return { x: (px - offX) / dispW, y: (py - offY) / dispH };
}
