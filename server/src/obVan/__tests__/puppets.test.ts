import { describe, expect, it } from 'vitest';
import {
  blinkClosed,
  clipAirMs,
  confettiPiece,
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
    const up = smoothAmp(0, 1);
    const down = 1 - smoothAmp(1, 0);
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(up);
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
