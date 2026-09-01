import { describe, expect, it } from 'vitest';
import {
  DUCK_DEATH_MS,
  DUCK_HANG_MS,
  HIT_FLASH_MS,
  HIT_GLOW_MS,
  HIT_PAD,
  HIT_POP_MS,
  HIT_POP_SCALE,
  HIT_RIM_MS,
  hitFlashEnvelope,
} from '../duckFlight';

const STAGES = ['flash', 'glow', 'rim', 'pop'] as const;

/** Halo reach as a fraction of the shader box (HIT_RIM_FRAC in the renderer). */
const RIM_FRAC = 0.16;
/** Sprite alpha half-extent within its own box: bbox 3..31 of 36 px. */
const SPRITE_HALF = 15 / 36;
/** Where the shader's edge fade reaches zero (see duck-hit-flash.wgsl). */
const PLANE_HALF = 0.5;

describe('hitFlashEnvelope', () => {
  it('peaks at the instant of impact', () => {
    const e = hitFlashEnvelope(0);
    expect(e.flash).toBe(1);
    expect(e.glow).toBe(1);
    expect(e.rim).toBe(1);
    expect(e.pop).toBe(1);
    expect(e.rimT).toBe(0); // the halo starts hugging the sprite
  });

  it('is silent outside the death beat', () => {
    for (const t of [-1, -1000, DUCK_DEATH_MS, DUCK_DEATH_MS + 500, NaN]) {
      expect(hitFlashEnvelope(t)).toEqual({
        flash: 0,
        glow: 0,
        rim: 0,
        rimT: 0,
        pop: 0,
      });
    }
  });

  it('keeps every stage in [0,1] and monotonically decaying', () => {
    for (const key of STAGES) {
      let prev = Infinity;
      for (let t = 0; t < DUCK_DEATH_MS; t += 10) {
        const v = hitFlashEnvelope(t)[key];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    }
  });

  it('expands the halo outward as it fades', () => {
    let prev = -Infinity;
    for (let t = 0; t <= HIT_RIM_MS; t += 10) {
      const { rimT } = hitFlashEnvelope(t);
      expect(rimT).toBeGreaterThanOrEqual(prev);
      prev = rimT;
    }
    expect(hitFlashEnvelope(HIT_RIM_MS).rimT).toBe(1);
  });

  // The contract behind "a potem niech spada jak teraz": every stage of the
  // flash must be over before the duck starts falling, so the drop renders
  // exactly as it did before the shader existed.
  it('is fully spent before the fall starts', () => {
    for (const ms of [HIT_FLASH_MS, HIT_RIM_MS, HIT_GLOW_MS, HIT_POP_MS]) {
      expect(ms).toBeLessThan(DUCK_HANG_MS);
    }
    for (let t = DUCK_HANG_MS; t < DUCK_DEATH_MS; t += 10) {
      const e = hitFlashEnvelope(t);
      for (const key of STAGES) expect(e[key]).toBe(0);
    }
  });

  // The sprite is zoomed and the halo spreads outward, both inside a plane
  // padded by HIT_PAD. If either outgrows it the effect gets squared off at
  // the box border, which looks like a bug rather than a flash — so pin the
  // geometry here instead of discovering it on a stream.
  it('keeps the zoomed sprite and its halo inside the padded plane', () => {
    // Sprite half-extent expressed in shader-plane units.
    const spriteHalf = SPRITE_HALF / HIT_PAD;
    expect(spriteHalf * (1 + HIT_POP_SCALE)).toBeLessThan(PLANE_HALF);

    for (let t = 0; t < DUCK_DEATH_MS; t += 5) {
      const { pop, rimT } = hitFlashEnvelope(t);
      const edge = spriteHalf * (1 + HIT_POP_SCALE * pop) + RIM_FRAC * rimT;
      expect(edge).toBeLessThan(PLANE_HALF);
    }
  });
});
