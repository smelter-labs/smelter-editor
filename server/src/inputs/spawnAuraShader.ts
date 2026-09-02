/**
 * Uniform packing for the `duck-spawn-aura` shader — the mark drawn on the real
 * bird a duck hatched from (PacmanBirdsInput).
 *
 * The field ORDER here is a contract with server/shaders/duck-spawn-aura.wgsl's
 * ShaderOptions struct — a silent mismatch shifts every uniform by one — so it
 * lives in exactly one place rather than being spelled out at the call site.
 */

import type { SpawnAuraEnvelope } from '../duckHunter/duckFlight';

/**
 * Aura slots in the shader struct. Fewer than MAX_DUCKS on purpose: the mark
 * matters most on the freshest spawns, and 8 rings is already the most a frame
 * can carry before it stops reading as "look at these" and starts reading as
 * noise. The renderer fills the slots youngest-duck-first.
 */
export const MAX_AURAS = 8;

/** One bird → duck link, in tile uv (already cover-mapped) plus its envelope. */
export type AuraSlot = {
  /** Bird box center and half-extents, tile uv. */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  /** Duck palette index (0..2) — picks the aura color in the shader. */
  tone: number;
  /** Animation phase in turns, derived from the duck id so a flock of rings
   * breathes out of step. Stable for the duck's whole life. */
  phase: number;
  /** Where the duck is right now, tile uv — the far end of the tether. */
  dx: number;
  dy: number;
  env: SpawnAuraEnvelope;
};

const EMPTY: Array<[string, number]> = [
  ['cx', 0],
  ['cy', 0],
  ['hw', 0],
  ['hh', 0],
  ['tone', 0],
  ['phase', 0],
  ['glow', 0],
  ['pulse', 0],
  ['pulse_t', 0],
  ['link', 0],
  ['dx', 0],
  ['dy', 0],
];

/** Stable per-duck phase in [0,1) from its tracker id. */
export function auraPhase(id: number): number {
  // Golden-ratio stride: consecutive tracker ids land far apart, so ducks that
  // spawn together never animate in lockstep.
  const v = (id * 0.6180339887) % 1;
  return v < 0 ? v + 1 : v;
}

/**
 * Uniforms for `duck-spawn-aura`. Every slot is always emitted (zeroed when
 * unused) so the struct layout is constant — an all-zero slot is a no-op, and
 * an all-zero uniform block is an exact video passthrough.
 */
export function spawnAuraParam(slots: AuraSlot[]) {
  const fields: Array<[string, number]> = [
    ['aura_count', Math.min(slots.length, MAX_AURAS)],
  ];
  for (let i = 0; i < MAX_AURAS; i++) {
    const s = slots[i];
    const slot: Array<[string, number]> = s
      ? [
          ['cx', s.cx],
          ['cy', s.cy],
          ['hw', s.hw],
          ['hh', s.hh],
          ['tone', s.tone],
          ['phase', s.phase],
          ['glow', s.env.glow],
          ['pulse', s.env.pulse],
          ['pulse_t', s.env.pulseT],
          ['link', s.env.link],
          ['dx', s.dx],
          ['dy', s.dy],
        ]
      : EMPTY;
    for (const [name, value] of slot) fields.push([`a${i}_${name}`, value]);
  }
  return {
    type: 'struct' as const,
    value: fields.map(([fieldName, value]) => ({
      type: 'f32' as const,
      fieldName,
      value,
    })),
  };
}
