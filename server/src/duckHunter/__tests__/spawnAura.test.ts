import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  AURA_IN_MS,
  AURA_LINK_MS,
  AURA_OUT_MS,
  AURA_PULSE_MS,
  spawnAuraEnvelope,
} from '../duckFlight';
import type { AuraSlot } from '../../inputs/spawnAuraShader';
import {
  MAX_AURAS,
  auraPhase,
  spawnAuraParam,
} from '../../inputs/spawnAuraShader';

const WGSL = fs.readFileSync(
  path.join(__dirname, '../../../shaders/duck-spawn-aura.wgsl'),
  'utf8',
);

/** Field names of `struct ShaderOptions`, in declaration order. */
function wgslStructFields(): string[] {
  const body = /struct ShaderOptions \{([\s\S]*?)\n\};/.exec(WGSL);
  if (!body) throw new Error('ShaderOptions not found in the shader');
  return [...body[1].matchAll(/(\w+)\s*:\s*f32/g)].map((m) => m[1]);
}

const PAUSE = 700;
const STAGES = ['glow', 'pulse', 'link'] as const;

function slot(over: Partial<AuraSlot> = {}): AuraSlot {
  return {
    cx: 0.4,
    cy: 0.3,
    hw: 0.05,
    hh: 0.04,
    tone: 1,
    phase: 0.25,
    dx: 0.6,
    dy: 0.2,
    env: { glow: 1, pulse: 0.5, pulseT: 0.25, link: 0.75 },
    ...over,
  };
}

describe('spawnAuraEnvelope', () => {
  it('opens with the shockwave hugging the ring, before the halo fades in', () => {
    const e = spawnAuraEnvelope(0, PAUSE, null);
    expect(e.pulse).toBe(1);
    expect(e.pulseT).toBe(0); // the shockwave starts at the ring
    expect(e.glow).toBe(0); // …and the steady ring eases in behind it
    expect(e.link).toBe(0); // the duck is still sitting on the bird
  });

  it('is silent before the spawn', () => {
    for (const t of [-1, -1000, NaN]) {
      expect(spawnAuraEnvelope(t, PAUSE, null)).toEqual({
        glow: 0,
        pulse: 0,
        pulseT: 0,
        link: 0,
      });
    }
  });

  it('keeps every stage in [0,1]', () => {
    for (let t = 0; t < 6000; t += 10) {
      const e = spawnAuraEnvelope(t, PAUSE, null);
      for (const key of [...STAGES, 'pulseT'] as const) {
        expect(e[key]).toBeGreaterThanOrEqual(0);
        expect(e[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('expands the shockwave outward as it fades, then stops', () => {
    let prevT = -Infinity;
    let prevPulse = Infinity;
    for (let t = 0; t <= AURA_PULSE_MS; t += 10) {
      const e = spawnAuraEnvelope(t, PAUSE, null);
      expect(e.pulseT).toBeGreaterThanOrEqual(prevT);
      expect(e.pulse).toBeLessThanOrEqual(prevPulse + 1e-9);
      prevT = e.pulseT;
      prevPulse = e.pulse;
    }
    expect(spawnAuraEnvelope(AURA_PULSE_MS, PAUSE, null).pulse).toBe(0);
    expect(spawnAuraEnvelope(AURA_PULSE_MS + 500, PAUSE, null).pulse).toBe(0);
  });

  it('holds the steady ring for the whole flight once it has eased in', () => {
    expect(spawnAuraEnvelope(AURA_IN_MS / 2, PAUSE, null).glow).toBeCloseTo(
      0.5,
    );
    for (const t of [AURA_IN_MS, 1000, 3000, 10_000]) {
      expect(spawnAuraEnvelope(t, PAUSE, null).glow).toBe(1);
    }
  });

  it('shows the tether only once the duck has left the bird', () => {
    for (let t = 0; t <= PAUSE; t += 50) {
      expect(spawnAuraEnvelope(t, PAUSE, null).link).toBe(0);
    }
    // No fade-in needed: at the instant of detach the duck is still on the
    // bird, so the line has zero length and only becomes visible as it flies.
    expect(spawnAuraEnvelope(PAUSE + 1, PAUSE, null).link).toBeGreaterThan(0);
    let prev = Infinity;
    for (let t = PAUSE + 1; t <= PAUSE + AURA_LINK_MS; t += 10) {
      const link = spawnAuraEnvelope(t, PAUSE, null).link;
      expect(link).toBeLessThanOrEqual(prev + 1e-9);
      prev = link;
    }
    expect(spawnAuraEnvelope(PAUSE + AURA_LINK_MS, PAUSE, null).link).toBe(0);
  });

  it('takes the mark off the bird when the duck is shot', () => {
    const alive = spawnAuraEnvelope(1000, PAUSE, null);
    expect(alive.glow).toBe(1);
    const half = spawnAuraEnvelope(1000, PAUSE, AURA_OUT_MS / 2);
    expect(half.glow).toBeCloseTo(0.5);
    // Gone well before the shot duck stops hanging, so the bird is unmarked
    // by the time the duck starts to fall.
    for (const t of [AURA_OUT_MS, AURA_OUT_MS + 200]) {
      expect(spawnAuraEnvelope(1000, PAUSE, t)).toEqual({
        glow: 0,
        pulse: 0,
        pulseT: 0,
        link: 0,
      });
    }
  });
});

describe('auraPhase', () => {
  it('is stable per id, inside [0,1), and spreads consecutive ids apart', () => {
    for (let id = 0; id < 200; id++) {
      const p = auraPhase(id);
      expect(p).toBe(auraPhase(id));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      // Neighbouring tracker ids must not breathe in lockstep.
      expect(Math.abs(p - auraPhase(id + 1))).toBeGreaterThan(0.3);
    }
  });
});

describe('spawnAuraParam', () => {
  it('emits exactly the shader struct, in declaration order', () => {
    const params = spawnAuraParam([slot(), slot()]);
    expect(params.value.map((f) => f.fieldName)).toEqual(wgslStructFields());
    expect(params.value.every((f) => f.type === 'f32')).toBe(true);
  });

  it('always fills every slot, and zeroes the unused ones', () => {
    const params = spawnAuraParam([slot()]);
    const byName = new Map(params.value.map((f) => [f.fieldName, f.value]));
    expect(byName.get('aura_count')).toBe(1);
    expect(byName.get('a0_cx')).toBe(0.4);
    expect(byName.get('a0_glow')).toBe(1);
    expect(byName.get('a0_pulse_t')).toBe(0.25);
    expect(byName.get('a0_dy')).toBe(0.2);
    for (let i = 1; i < MAX_AURAS; i++) {
      for (const f of ['cx', 'cy', 'hw', 'hh', 'glow', 'pulse', 'link']) {
        expect(byName.get(`a${i}_${f}`)).toBe(0);
      }
    }
  });

  it('is an exact passthrough with nothing to mark', () => {
    const params = spawnAuraParam([]);
    expect(params.value).toHaveLength(1 + MAX_AURAS * 12);
    expect(params.value.every((f) => f.value === 0)).toBe(true);
  });

  it('never reports more slots than the shader has', () => {
    const params = spawnAuraParam(new Array(MAX_AURAS + 5).fill(slot()));
    const byName = new Map(params.value.map((f) => [f.fieldName, f.value]));
    expect(byName.get('aura_count')).toBe(MAX_AURAS);
    expect(params.value).toHaveLength(1 + MAX_AURAS * 12);
  });
});
