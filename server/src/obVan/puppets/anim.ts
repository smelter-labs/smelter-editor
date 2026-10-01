/**
 * Puppet animation maths — pure functions of the clocks, so the renderer
 * stays a thin ticker and everything here is unit-testable.
 *
 * Mouth: the amplitude track (50 Hz RMS of the clip's own audio) picks a
 * viseme per 130 ms "syllable slot"; which open mouth a loud slot gets is a
 * seeded hash, so the flapping looks articulated instead of metronomic.
 * Blinks, sway and head bob run on the wall clock — they do not need to
 * survive loops, only to keep the figure alive.
 */
import type { PuppetMouthTrack } from './types';

export type PuppetViseme = 'rest' | 'm' | 'e' | 'a' | 'o' | 's';

/** Stable small seed from a string (character id / name). */
export function puppetSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b, 40503);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Linear sample of the mouth track at `airMs` into the clip; 0 outside. */
export function sampleMouth(
  track: PuppetMouthTrack | null,
  airMs: number,
): number {
  if (!track || track.v.length === 0 || airMs < 0) return 0;
  const pos = (airMs / 1000) * track.rateHz;
  const i = Math.floor(pos);
  if (i >= track.v.length) return 0;
  const a = track.v[i];
  const b = track.v[Math.min(i + 1, track.v.length - 1)];
  const t = pos - i;
  return a + (b - a) * t;
}

/** One smoothing step: fast attack, slower release (per ~33 ms tick). */
export function smoothAmp(prev: number, target: number): number {
  const k = target > prev ? 0.55 : 0.3;
  return prev + (target - prev) * k;
}

const SLOT_MS = 130;

/**
 * Viseme for the smoothed amplitude. `silenceMs` is how long the amplitude
 * has been under the speech floor — a short dip between words closes to `m`,
 * a real pause relaxes to `rest`.
 */
export function pickViseme(
  amp: number,
  airMs: number,
  seed: number,
  silenceMs: number,
): PuppetViseme {
  if (amp < 0.05) return silenceMs > 260 ? 'rest' : 'm';
  const slot = Math.floor(airMs / SLOT_MS);
  const h = hash2(seed, slot);
  if (amp < 0.2) return h % 4 === 0 ? 'm' : 'e';
  if (amp < 0.52) return (['a', 'e', 'o', 'a'] as const)[h % 4];
  return (['a', 'o', 's', 'a'] as const)[h % 4];
}

/** Open-mouth layers scale up a touch with loudness (anchored on the box). */
export function mouthScale(viseme: PuppetViseme, amp: number): number {
  if (viseme === 'rest' || viseme === 'm') return 1;
  return 1 + 0.16 * Math.min(1, amp);
}

/** Seeded blink: ~every 2.4–4.6 s, closed for 120 ms. */
export function blinkClosed(wallMs: number, seed: number): boolean {
  const cycle = 2400 + (seed % 2200);
  const phase = (((wallMs + seed) % cycle) + cycle) % cycle;
  return phase < 120;
}

export type PuppetSway = {
  bodyX: number;
  headX: number;
  headY: number;
};

/**
 * Idle sway plus talking head-bob, in logical canvas px (scale with the
 * figure). Gentle and incommensurate frequencies so it never looks looped.
 */
export function puppetSway(
  wallMs: number,
  seed: number,
  amp: number,
): PuppetSway {
  const t = (wallMs + (seed % 10000)) / 1000;
  const TAU = Math.PI * 2;
  return {
    bodyX: Math.round(Math.sin(t * TAU * 0.11) * 5),
    headX: Math.round(Math.sin(t * TAU * 0.165 + 1.7) * 6),
    headY: Math.round(
      Math.sin(t * TAU * 0.13 + 0.6) * 3 -
        amp * 9 +
        Math.sin(t * TAU * 1.9) * amp * 3,
    ),
  };
}

/** Speaking glow bucket 0..3 for the pre-rendered glow sprites. */
export function glowLevel(amp: number): 0 | 1 | 2 | 3 {
  if (amp < 0.06) return 0;
  if (amp < 0.25) return 1;
  if (amp < 0.55) return 2;
  return 3;
}

/**
 * Air position inside the looping clip for `wallMs`, from the clip clock.
 * Null while there is no clock (input restarting) or before media 0 airs.
 */
export function clipAirMs(
  clock: { zeroAirMs: number; durationMs: number | null } | null,
  wallMs: number,
): number | null {
  if (!clock) return null;
  let pos = wallMs - clock.zeroAirMs;
  if (clock.durationMs != null && clock.durationMs > 0) {
    pos = ((pos % clock.durationMs) + clock.durationMs) % clock.durationMs;
  } else if (pos < 0) {
    return null;
  }
  return pos;
}

/** Confetti piece layout for the celebration, deterministic per index. */
export function confettiPiece(
  i: number,
  seed: number,
  sinceMs: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number; color: string } {
  const h1 = hash2(seed, i * 7 + 1);
  const h2 = hash2(seed, i * 7 + 2);
  const h3 = hash2(seed, i * 7 + 3);
  const x0 = (h1 % 1000) / 1000;
  const speed = 180 + (h2 % 160); // px/s
  const drift = ((h3 % 100) - 50) / 50; // -1..1
  const phase = (h2 % 1200) - 1200; // start above the frame
  const t = sinceMs / 1000;
  const y = phase + speed * t;
  const x = x0 * width + Math.sin(t * 2 + i) * 24 + drift * 40 * t;
  const size = 10 + (h1 % 9);
  const colors = ['#FFD166', '#38BDF8', '#FF5A5A', '#22C55E', '#F2F4F8'];
  return {
    x: Math.round(x),
    y: Math.round(y % (height + 80)),
    w: size,
    h: Math.round(size * 0.55) + (h3 % 6),
    color: colors[h1 % colors.length],
  };
}
