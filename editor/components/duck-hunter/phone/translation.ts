// Translation ("parallax") term of the aim, added on top of the gyro-mouse
// rotation accumulator in the shoot page's motion listener.
//
// Physically a phone IMU cannot recover absolute position: double-integrating
// linear acceleration drifts within seconds and the crosshair runs off into a
// corner. So this is deliberately NOT a position tracker — it is a leaky double
// integrator, a band-pass on movement. A shove of the phone throws the
// crosshair, and the offset then relaxes back to zero on its own. Drift is
// impossible because both integrators bleed toward zero every step.
//
// The offset must be added to the rotation accumulator at send time and never
// folded back into it — feeding it back would reintroduce exactly the drift
// this design exists to avoid.

/** Screen fraction of offset per metre of (leaky) displacement, at sens 1. */
export const MOVE_GAIN = 1.6;
/** Accelerometer noise floor (m/s²) — below this the sample reads as "still". */
export const MOVE_ACC_DEADZONE = 0.15;
/** Rotation rate (deg/s) at which the translation term is fully suppressed. */
export const MOVE_ROT_GATE_DEG_S = 150;
/**
 * Tighter gate for the fallback path (linear acceleration derived by
 * subtracting low-passed gravity). That estimate degrades fast under rotation:
 * the gravity low-pass lags ~75 ms, so turning at only 30 deg/s already leaves
 * the gravity vector ~2 deg stale — worth ~0.4 m/s² of phantom acceleration,
 * well above the deadzone. When the phone is turning we trust the gyro instead.
 */
export const MOVE_ROT_GATE_DERIVED_DEG_S = 45;
// Both constants are short on purpose. Velocity keeps pumping displacement for
// roughly its own time constant after the hand stops, so the offset's tail runs
// far longer than either number suggests: at 0.35/0.5 s a hard shove still left
// ~3% of screen offset two seconds later, which reads as the crosshair being
// stuck rather than as recoil.
/** Velocity leak time constant (s). */
export const MOVE_VEL_TAU = 0.18;
/** Displacement leak time constant (s). */
export const MOVE_POS_TAU = 0.25;
/** Offset cap as a screen fraction, per unit of sensitivity. */
export const MOVE_MAX_OFFSET = 0.12;

/** Leaky velocity + displacement, in the screen's right/up axes. */
export type MoveState = {
  vRight: number;
  vUp: number;
  pRight: number;
  pUp: number;
};

export function freshMoveState(): MoveState {
  return { vRight: 0, vUp: 0, pRight: 0, pUp: 0 };
}

export function resetMoveState(s: MoveState): void {
  s.vRight = 0;
  s.vUp = 0;
  s.pRight = 0;
  s.pUp = 0;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Advance the translation integrator by one motion sample and return the aim
 * offset it contributes, in normalized screen units.
 *
 * Mutates `s`. `acc` is linear acceleration (m/s², gravity removed) projected
 * onto the screen's right/up axes; `rotMagDegS` is the total angular rate used
 * to gate the term; `gateDegS` picks how aggressively (see the two constants).
 *
 * Both integrators decay by `exp(-dt/tau)` rather than a fixed per-sample
 * factor, so the feel does not change when the sample rate does — devicemotion
 * runs at ~60 Hz but is throttled hard in some states, and the caller's dt
 * guard admits anything up to 100 ms.
 */
export function stepTranslation(
  s: MoveState,
  acc: { right: number; up: number },
  rotMagDegS: number,
  dt: number,
  moveSens: number,
  gateDegS: number = MOVE_ROT_GATE_DEG_S,
): { offX: number; offY: number } {
  // Sensitivity 0 is a hard off switch: no state accumulates, so turning the
  // slider back up starts from rest instead of from a stale shove.
  if (!(moveSens > 0) || !(dt > 0)) {
    resetMoveState(s);
    return { offX: 0, offY: 0 };
  }

  const gate = clamp01(1 - Math.abs(rotMagDegS) / gateDegS);
  const live = (v: number) => (Math.abs(v) < MOVE_ACC_DEADZONE ? 0 : v) * gate;
  const aRight = live(acc.right);
  const aUp = live(acc.up);

  const velDecay = Math.exp(-dt / MOVE_VEL_TAU);
  const posDecay = Math.exp(-dt / MOVE_POS_TAU);

  // Trapezoidal step for displacement (average of the old and new velocity),
  // which keeps coarse and fine sample rates much closer than plain Euler.
  const vRight0 = s.vRight;
  const vUp0 = s.vUp;
  s.vRight = (s.vRight + aRight * dt) * velDecay;
  s.vUp = (s.vUp + aUp * dt) * velDecay;
  s.pRight = (s.pRight + ((vRight0 + s.vRight) / 2) * dt) * posDecay;
  s.pUp = (s.pUp + ((vUp0 + s.vUp) / 2) * dt) * posDecay;

  const k = MOVE_GAIN * moveSens;
  const lim = MOVE_MAX_OFFSET * moveSens;
  return {
    offX: clamp(s.pRight * k, -lim, lim),
    // Screen y grows downward, so moving the phone up moves the crosshair up.
    offY: clamp(-s.pUp * k, -lim, lim),
  };
}
