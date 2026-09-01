/**
 * Uniform packing for the `duck-hit-flash` shader, shared by everything that can
 * be shot: the ducks (PacmanBirdsInput) and the taunting dog (ShooterHud).
 *
 * The field ORDER here is a contract with server/shaders/duck-hit-flash.wgsl's
 * ShaderOptions struct — a silent mismatch shifts every uniform by one — so it
 * lives in exactly one place rather than being copied per call site.
 */

import type { HitFlashEnvelope } from '../duckHunter/duckFlight';
import { HIT_POP_SCALE } from '../duckHunter/duckFlight';
import { hexToRgb } from '../utils/shaderUtils';

/** Halo reach as a fraction of the sprite's smaller side, at full expansion. */
export const HIT_RIM_FRAC = 0.16;
/**
 * Tint when something died without a recorded shooter (shouldn't happen, but a
 * white flash still reads correctly as a hit).
 */
export const HIT_TINT_FALLBACK = '#FFFFFF';

/**
 * Uniforms for `duck-hit-flash`. `box` is the shader plane's smaller side in
 * pixels — the halo reach is derived from it, so a non-square plane (the dog)
 * spreads evenly instead of stretching along its long axis.
 */
export function hitShaderParam(
  env: HitFlashEnvelope,
  hitColor: string,
  box: number,
) {
  const tint = hexToRgb(hitColor);
  const fields: Array<[string, number]> = [
    // The impact zoom is a UV transform inside the shader, not a resize of the
    // child View: that keeps the shader plane a constant size for the whole
    // death beat, so the render target is never reallocated mid-animation and
    // the box never jitters by a rounded pixel.
    ['scale', 1 + HIT_POP_SCALE * env.pop],
    ['flash', env.flash],
    ['glow', env.glow],
    ['rim', env.rim],
    ['rim_t', env.rimT],
    ['rim_px', box * HIT_RIM_FRAC],
    ['tint_r', tint.r],
    ['tint_g', tint.g],
    ['tint_b', tint.b],
  ];
  return {
    type: 'struct' as const,
    value: fields.map(([fieldName, value]) => ({
      type: 'f32' as const,
      fieldName,
      value,
    })),
  };
}
