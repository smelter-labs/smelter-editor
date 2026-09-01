/**
 * Taunting-dog model — the single source of truth for where the dog is drawn and
 * when it can be shot, shared by the server hit-test (DuckHunterController) and
 * the renderer (ShooterHud) so a shot lands exactly on the drawn sprite. Same
 * discipline as duckFlight.ts: spawn state is frozen and everything visible is a
 * pure function of elapsed time, so both sides compute identical pixels.
 *
 * After two misses in a row the dog springs up from the bottom edge, laughs at
 * the player for a couple of seconds, then sinks back down. It is shootable
 * *only* while laughing — that window is the whole feature, so it is expressed
 * once here (`dogShootable`) rather than re-derived at each call site.
 *
 * This is deliberately NOT the same type as the `DogReveal` celebration pop-up
 * (the "got two" dog): that one has no hitbox and must never gain one, so
 * keeping them separate makes "only the laughing dog is a target" true by
 * construction rather than by a discriminant every consumer has to respect.
 */

import {
  contentToPx,
  DUCK_FALL_MS,
  DUCK_HANG_MS,
  type DuckViewport,
} from './duckFlight';

/** Spring up from below the bottom edge. */
export const DOG_RISE_MS = 260;
/** The shootable window: how long the dog stands there laughing. */
export const DOG_LAUGH_MS = 2000;
/** Sink back down, unshot. */
export const DOG_DROP_MS = 300;
/** Total on-screen time when nobody hits it. */
export const DOG_TAUNT_MS = DOG_RISE_MS + DOG_LAUGH_MS + DOG_DROP_MS;
/** Cadence of the two-frame laugh animation. */
export const DOG_FLAP_MS = 190;

/**
 * Death beat: the duck's hang + fall, with a yelp head on the front. The yelp is
 * the extra breath the shot is supposed to land on — it is also what makes the
 * dog's hit-stop longer than a duck's (see DOG_FREEZE_MS).
 */
export const DOG_YELP_MS = 260;
export const DOG_HANG_MS = DUCK_HANG_MS;
export const DOG_FALL_MS = DUCK_FALL_MS;
export const DOG_DEATH_MS = DOG_YELP_MS + DOG_HANG_MS + DOG_FALL_MS;
/** How long a dog hit freezes the flock — ends exactly as the dog starts to fall. */
export const DOG_FREEZE_MS = DOG_YELP_MS + DOG_HANG_MS;

/** Sprite width as a fraction of the output width. */
export const DOG_WIDTH_FRAC = 0.12;
/** Height/width of each pose, straight off the PNGs scripts/slice-dog.py emits. */
export const DOG_POSE_ASPECT = {
  laugh: 40 / 29,
  yelp: 30 / 21,
  shot: 33 / 19,
} as const;
/**
 * Hitbox as a fraction of the drawn rect, about its center. The sprite is tall
 * and narrow with empty corners, so a circle would either miss the head or
 * over-cover the air beside the paws; this is a rect, pulled in a little.
 */
export const DOG_HIT_FACTOR = 0.8;

export type DogPhase =
  | 'rise'
  | 'laugh'
  | 'drop'
  | 'yelp'
  | 'hang'
  | 'fall'
  | 'gone';

/** A taunting dog. Frozen at spawn; the pose is a function of (now - at). */
export type DogEntity = {
  id: number;
  /** Pop-up column in normalized content space [0,1] — same space as crosshairs. */
  x: number;
  /** Effective spawn ms. Pushed forward during a hit-stop, like DuckEntity.spawnAt. */
  at: number;
  /** Wall-clock ms it was shot, or undefined while it is still taunting. */
  diedAt?: number;
  /** Hex color of the player who shot it; tints the hit flash. */
  hitColor?: string;
};

export function dogPhase(d: DogEntity, now: number): DogPhase {
  if (d.diedAt != null) {
    const e = now - d.diedAt;
    if (e < 0) return 'laugh';
    if (e < DOG_YELP_MS) return 'yelp';
    if (e < DOG_FREEZE_MS) return 'hang';
    if (e < DOG_DEATH_MS) return 'fall';
    return 'gone';
  }
  const e = now - d.at;
  if (e < 0) return 'rise';
  if (e < DOG_RISE_MS) return 'rise';
  if (e < DOG_RISE_MS + DOG_LAUGH_MS) return 'laugh';
  if (e < DOG_TAUNT_MS) return 'drop';
  return 'gone';
}

/**
 * The whole product rule in one place: you can only shoot the dog while it is
 * standing there laughing at you — not on the way up, not on the way down, and
 * not twice.
 */
export function dogShootable(d: DogEntity, now: number): boolean {
  return d.diedAt == null && dogPhase(d, now) === 'laugh';
}

/** True once the dog has finished its taunt (or its death beat) and can be dropped. */
export function dogExpired(d: DogEntity, now: number): boolean {
  return dogPhase(d, now) === 'gone';
}

/** Which of the two laugh frames is showing. */
export function dogLaughFrame(d: DogEntity, now: number): 0 | 1 {
  const e = Math.max(0, now - d.at);
  return (Math.floor(e / DOG_FLAP_MS) % 2) as 0 | 1;
}

/** Sprite pose to draw for the dog's current phase. */
export function dogPose(d: DogEntity, now: number): 'laugh' | 'yelp' | 'shot' {
  const phase = dogPhase(d, now);
  if (phase === 'yelp') return 'yelp';
  if (phase === 'hang' || phase === 'fall') return 'shot';
  return 'laugh';
}

/**
 * The dog's drawn rect in output pixels.
 *
 * Note the pre-existing approximation this inherits from the ducks: the server
 * builds its viewport from the *output* resolution while the renderer passes the
 * *tile* size. They agree whenever the shooter target fills the frame, which is
 * the only configuration duck mode is used in — the same assumption every duck
 * hit-test already makes.
 */
export function dogRectPx(
  d: DogEntity,
  now: number,
  v: DuckViewport,
): { left: number; top: number; width: number; height: number } {
  const phase = dogPhase(d, now);
  // The box keeps the LAUGH aspect through the whole beat: the shot poses are
  // narrower, and letting the box change shape mid-animation would make the dog
  // visibly jump at the moment of impact. `rescaleMode: 'fit'` centers the
  // smaller poses inside it instead.
  const width = Math.round(v.width * DOG_WIDTH_FRAC);
  const height = Math.round(width * DOG_POSE_ASPECT.laugh);
  const restTop = v.height - height; // stands on the bottom edge
  const cx = contentToPx(d.x, 0, v).px;
  const left = Math.round(
    Math.max(0, Math.min(v.width - width, cx - width / 2)),
  );

  let top = restTop;
  if (phase === 'rise') {
    const t = Math.min(1, Math.max(0, (now - d.at) / DOG_RISE_MS));
    top = restTop + height * (1 - t) * (1 - t); // ease-out rise
  } else if (phase === 'drop') {
    const t = Math.min(
      1,
      Math.max(0, (now - d.at - DOG_RISE_MS - DOG_LAUGH_MS) / DOG_DROP_MS),
    );
    top = restTop + height * t * t; // accelerating sink
  } else if (phase === 'fall') {
    const t = Math.min(
      1,
      Math.max(0, (now - (d.diedAt ?? 0) - DOG_FREEZE_MS) / DOG_FALL_MS),
    );
    top = restTop + (v.height + height - restTop) * t * t;
  } else if (phase === 'gone') {
    top = v.height + height;
  }
  return { left, top: Math.round(top), width, height };
}
