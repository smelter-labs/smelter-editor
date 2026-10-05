import { describe, expect, it } from 'vitest';
import {
  advanceFigure,
  blinkClosed,
  clipAirMs,
  confettiPiece,
  createFigureDynamics,
  figureVisual,
  glowLevel,
  mouthScale,
  pickViseme,
  puppetSeed,
  puppetSway,
  sampleMouth,
  smoothAmp,
  type PuppetViseme,
} from '../puppets/anim';
import {
  isPuppetCharacterId,
  PUPPET_CHARACTER_IDS,
  type PuppetMouthTrack,
} from '../puppets/types';

const track = (v: number[], rateHz = 50): PuppetMouthTrack => ({ rateHz, v });

describe('puppet types', () => {
  it('accepts every cast member and rejects strangers', () => {
    for (const id of PUPPET_CHARACTER_IDS)
      expect(isPuppetCharacterId(id)).toBe(true);
    expect(isPuppetCharacterId('studio')).toBe(false);
    expect(isPuppetCharacterId('clippy')).toBe(false);
  });
});

describe('sampleMouth', () => {
  it('samples and interpolates at the track rate', () => {
    const t = track([0, 1, 0.5]);
    expect(sampleMouth(t, 0)).toBe(0);
    expect(sampleMouth(t, 20)).toBe(1); // sample 1 at 20 ms of 50 Hz
    expect(sampleMouth(t, 10)).toBeCloseTo(0.5); // halfway 0→1
    expect(sampleMouth(t, 30)).toBeCloseTo(0.75); // halfway 1→0.5
  });

  it('is silent outside the clip and without a track', () => {
    const t = track([1, 1]);
    expect(sampleMouth(t, -5)).toBe(0);
    expect(sampleMouth(t, 10_000)).toBe(0);
    expect(sampleMouth(null, 10)).toBe(0);
    expect(sampleMouth(track([]), 10)).toBe(0);
  });
});

describe('smoothAmp', () => {
  it('attacks faster than it releases', () => {
    const up = smoothAmp(0, 1, 33);
    const down = 1 - smoothAmp(1, 0, 33);
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(up);
  });

  it('is time-consistent: two small steps equal one big step', () => {
    const twoSteps = smoothAmp(smoothAmp(0.1, 1, 33), 1, 33);
    expect(twoSteps).toBeCloseTo(smoothAmp(0.1, 1, 66), 6);
  });

  it('does nothing over zero time', () => {
    expect(smoothAmp(0.4, 1, 0)).toBe(0.4);
  });
});

describe('advanceFigure', () => {
  const loud = track(Array(500).fill(1));

  it('approaches the target over time and tracks voicing', () => {
    const st = createFigureDynamics();
    const a = advanceFigure(st, loud, 100, 1000);
    const b = advanceFigure(st, loud, 133, 1033);
    expect(a.amp).toBeGreaterThan(0.9); // first call integrates a full MAX_DT
    expect(b.amp).toBeGreaterThan(a.amp);
    expect(b.silenceMs).toBe(0);
    // The bob envelope trails the fast one (slower tau).
    expect(b.bobAmp).toBeGreaterThan(a.bobAmp);
    expect(b.bobAmp).toBeLessThan(b.amp);
  });

  it('re-advancing at the same instant is a no-op (shared output roots)', () => {
    const st = createFigureDynamics();
    advanceFigure(st, loud, 100, 1000);
    const a = advanceFigure(st, loud, 133, 1033);
    const b = advanceFigure(st, loud, 133, 1033);
    expect(b.amp).toBe(a.amp);
    expect(b.silenceMs).toBe(a.silenceMs);
  });

  it('reports silence without a clock or a voiced sample', () => {
    const st = createFigureDynamics();
    const quiet = advanceFigure(st, loud, null, 1000);
    expect(quiet.amp).toBe(0);
    expect(quiet.silenceMs).toBe(10_000); // never voiced
    advanceFigure(st, loud, 100, 2000); // voiced
    const later = advanceFigure(st, null, 100, 2500);
    expect(later.silenceMs).toBe(500);
  });
});

describe('figureVisual', () => {
  const seed = puppetSeed('nova');
  const base = {
    seed,
    amp: 0,
    bobAmp: 0,
    airMs: 1000,
    silenceMs: 1000,
    wallMs: 5000,
    kOut: 1,
    active: false,
    cheer: false,
    sad: false,
  };

  it('is deterministic and the key fingerprints the drawn values', () => {
    const a = figureVisual(base);
    const b = figureVisual(base);
    expect(a).toEqual(b);
    // Same key ⇒ same drawn pose (sway comes out pre-quantized).
    expect(a.key).toBe(b.key);
    expect(a.sway).toEqual(b.sway);
  });

  it('varies with the viseme slot when loud', () => {
    const keys = new Set<string>();
    for (let airMs = 0; airMs < 1300; airMs += 130)
      keys.add(
        figureVisual({ ...base, amp: 0.8, bobAmp: 0.8, silenceMs: 0, airMs })
          .key,
      );
    expect(keys.size).toBeGreaterThan(1);
  });

  // An instant where the seeded blink keeps the eyes open for a while, so
  // the fx/sway assertions below are not confounded by a blink edge.
  let openEyesMs = 5000;
  while (blinkClosed(openEyesMs, seed) || blinkClosed(openEyesMs + 20, seed))
    openEyesMs += 50;
  const openBase = { ...base, wallMs: openEyesMs };

  it('flips on the fx that change the drawing', () => {
    expect(figureVisual({ ...openBase, sad: true }).key).not.toBe(
      figureVisual(openBase).key,
    );
    expect(figureVisual({ ...openBase, cheer: true }).key).not.toBe(
      figureVisual(openBase).key,
    );
    expect(figureVisual({ ...openBase, active: true }).key).not.toBe(
      figureVisual(openBase).key,
    );
  });

  it('ignores sway finer than the output-px quantum', () => {
    // A tiny figure (kOut→0) collapses all sway buckets to 0: between two
    // nearby blink-free instants nothing in the key moves.
    const a = figureVisual({ ...openBase, kOut: 0.001 });
    const b = figureVisual({
      ...openBase,
      kOut: 0.001,
      wallMs: openEyesMs + 20,
    });
    expect(a.key).toBe(b.key);
    expect(a.sway).toEqual(b.sway);
  });

  it('moves in coarser steps while idle than while speaking', () => {
    // Same instant: idle buckets are IDLE_SWAY_QUANT_PX (2), speaking 0.75.
    const idle = figureVisual(openBase);
    const talking = figureVisual({ ...openBase, amp: 0.8, bobAmp: 0.8 });
    expect(idle.key.includes('|i')).toBe(true);
    expect(talking.key.includes('|s')).toBe(true);
  });
});

describe('pickViseme', () => {
  const seed = puppetSeed('host');

  it('rests only after a real pause', () => {
    expect(pickViseme(0, 1000, seed, 1000)).toBe('rest');
    expect(pickViseme(0, 1000, seed, 100)).toBe('m'); // inter-word dip
  });

  it('opens the mouth when loud, varying by slot', () => {
    const open = new Set<PuppetViseme>(['a', 'o', 's', 'e']);
    const seen = new Set<PuppetViseme>();
    for (let ms = 0; ms < 4000; ms += 130) {
      const v = pickViseme(0.8, ms, seed, 0);
      expect(open.has(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(1); // articulated, not a metronome
  });

  it('is deterministic for a slot and seed', () => {
    expect(pickViseme(0.4, 777, seed, 0)).toBe(pickViseme(0.4, 777, seed, 0));
  });
});

describe('mouthScale / glowLevel', () => {
  it('scales only open visemes', () => {
    expect(mouthScale('rest', 1)).toBe(1);
    expect(mouthScale('m', 1)).toBe(1);
    expect(mouthScale('a', 1)).toBeGreaterThan(1);
  });

  it('buckets the glow by amplitude', () => {
    expect(glowLevel(0)).toBe(0);
    expect(glowLevel(0.1)).toBe(1);
    expect(glowLevel(0.4)).toBe(2);
    expect(glowLevel(0.9)).toBe(3);
  });
});

describe('clipAirMs', () => {
  it('is null without a clock or before media zero airs', () => {
    expect(clipAirMs(null, 1000)).toBeNull();
    expect(clipAirMs({ zeroAirMs: 5000, durationMs: null }, 4000)).toBeNull();
  });

  it('tracks the clip position and wraps native loops', () => {
    const clock = { zeroAirMs: 1000, durationMs: 10_000 };
    expect(clipAirMs(clock, 1000)).toBe(0);
    expect(clipAirMs(clock, 4500)).toBe(3500);
    expect(clipAirMs(clock, 11_000)).toBe(0); // second loop
    expect(clipAirMs(clock, 14_200)).toBe(3200);
    // before zero on a looping clip: previous loop's tail
    expect(clipAirMs(clock, 500)).toBe(9500);
  });
});

describe('blink & sway & confetti', () => {
  it('blinks briefly and deterministically', () => {
    const seed = puppetSeed('nova');
    let closed = 0;
    const span = 60_000;
    for (let ms = 0; ms < span; ms += 20)
      if (blinkClosed(ms, seed)) closed += 20;
    // ~120 ms per 2.4–4.6 s cycle → a few % of the time
    expect(closed).toBeGreaterThan(span * 0.01);
    expect(closed).toBeLessThan(span * 0.08);
  });

  it('sways gently and bobs with speech', () => {
    const quiet = puppetSway(1234, 7, 0);
    const loud = puppetSway(1234, 7, 1);
    expect(Math.abs(quiet.bodyX)).toBeLessThanOrEqual(5);
    expect(Math.abs(quiet.headY)).toBeLessThanOrEqual(3);
    expect(loud.headY).toBeLessThan(quiet.headY); // bob lifts the head
  });

  it('rains deterministic confetti inside the frame', () => {
    const a = confettiPiece(3, 42, 1500, 1920, 1080);
    const b = confettiPiece(3, 42, 1500, 1920, 1080);
    expect(a).toEqual(b);
    expect(a.w).toBeGreaterThan(0);
    expect(a.color).toMatch(/^#/);
  });
});

// ── Live TTS mouth (computePuppetPose) ─────────────────────────────────────

import { computePuppetPose } from '../puppets/PuppetInput';
import type { ObPuppetConfig, PuppetLiveMouth } from '../puppets/types';

const RES = { width: 1920, height: 1080 };
const LOUD: PuppetLiveMouth = {
  track: track(new Array(100).fill(0.9)),
  startWallMs: 10_000,
  durationMs: 2_000,
};

const soloCfg = (
  live: PuppetLiveMouth | null,
  calls?: string[],
): ObPuppetConfig => ({
  character: 'nova',
  name: 'OPUS',
  mouth: null,
  getClock: () => null,
  getLiveMouth: (character) => {
    calls?.push(character);
    return live;
  },
});

/** Same pose twice so the amp smoothing settles before fingerprinting. */
function settledKey(cfg: ObPuppetConfig, inputId: string, now: number): string {
  computePuppetPose(cfg, RES, inputId, undefined, now - 200);
  return computePuppetPose(cfg, RES, inputId, undefined, now).key;
}

describe('computePuppetPose · live TTS mouth', () => {
  it('a live clip opens the mouth of a silent carrier, then expires to rest', () => {
    const rest = settledKey(soloCfg(null), 'in-rest', 10_500);
    const talking = settledKey(soloCfg(LOUD), 'in-live', 10_500);
    expect(talking).not.toBe(rest);
    // Past startWallMs + durationMs (+300 grace) the override is ignored.
    const expired = settledKey(soloCfg(LOUD), 'in-expired', 13_000);
    const restLater = settledKey(soloCfg(null), 'in-rest-2', 13_000);
    expect(expired).toBe(restLater);
    // Before the clip starts it is ignored too.
    const early = settledKey(soloCfg(LOUD), 'in-early', 9_000);
    const restEarly = settledKey(soloCfg(null), 'in-rest-3', 9_000);
    expect(early).toBe(restEarly);
  });

  it('works without a getLiveMouth closure (older configs)', () => {
    const cfg = soloCfg(null);
    delete cfg.getLiveMouth;
    expect(() =>
      computePuppetPose(cfg, RES, 'in-legacy', undefined, 10_500),
    ).not.toThrow();
  });

  it('the studio set asks per cast character, so one puppet can talk alone', () => {
    const calls: string[] = [];
    const cfg: ObPuppetConfig = {
      character: 'studio',
      name: 'STUDIO',
      mouth: null,
      getClock: () => null,
      getLiveMouth: (character) => {
        calls.push(character);
        return character === 'bit' ? LOUD : null;
      },
      cast: [
        { character: 'host', name: 'Max Smelter', mouth: null },
        { character: 'nova', name: 'OPUS', mouth: null },
        { character: 'bit', name: 'GPT', mouth: null },
      ],
    };
    const withLive = settledKey(cfg, 'in-studio', 10_500);
    expect(calls).toContain('host');
    expect(calls).toContain('nova');
    expect(calls).toContain('bit');
    const silent = settledKey(
      { ...cfg, getLiveMouth: () => null },
      'in-studio-2',
      10_500,
    );
    expect(withLive).not.toBe(silent);
  });
});
