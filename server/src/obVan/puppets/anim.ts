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

const ATTACK_TAU_MS = 41;
const RELEASE_TAU_MS = 92;

/** One smoothing step: fast attack, slower release. Time-based so the result
 * is the same whatever the tick rate; dt 0 is a no-op (the second output
 * root re-advancing at the same instant must not double the step). */
export function smoothAmp(prev: number, target: number, dtMs: number): number {
  const tau = target > prev ? ATTACK_TAU_MS : RELEASE_TAU_MS;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
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
    bodyX: Math.sin(t * TAU * 0.11) * 5,
    headX: Math.sin(t * TAU * 0.165 + 1.7) * 6,
    headY:
      Math.sin(t * TAU * 0.13 + 0.6) * 3 -
      amp * 9 +
      Math.sin(t * TAU * 1.9) * amp * 3,
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

/** Longest step the dynamics will integrate in one go: a figure waking up
 * after a stall (or after being parked off-air) snaps near its current
 * target instead of replaying the gap. */
const MAX_DT_MS = 500;

/** Slow envelope for sway/bob/glow: the fast `amp` flaps per syllable and
 * would churn the pose key (→ scene updates) at the tick rate. */
const BOB_TAU_MS = 200;

/** Per-figure smoothing state carried across ticks (and across remounts —
 * the renderer keys it by input + character in a module-level map). */
export type FigureDynamicsState = {
  amp: number;
  bobAmp: number;
  lastVoicedMs: number;
  lastTickMs: number;
};

export function createFigureDynamics(): FigureDynamicsState {
  return { amp: 0, bobAmp: 0, lastVoicedMs: 0, lastTickMs: 0 };
}

/**
 * Advance a figure's smoothed amplitude to `nowMs`. Re-advancing at the same
 * instant is a no-op, so the two output roots (program + recording) can share
 * one state without doubling the smoothing step.
 */
export function advanceFigure(
  st: FigureDynamicsState,
  track: PuppetMouthTrack | null,
  airMs: number | null,
  nowMs: number,
): { amp: number; bobAmp: number; airMs: number; silenceMs: number } {
  const dtMs =
    st.lastTickMs === 0
      ? MAX_DT_MS
      : Math.min(Math.max(0, nowMs - st.lastTickMs), MAX_DT_MS);
  st.lastTickMs = nowMs;
  const raw = airMs == null ? 0 : sampleMouth(track, airMs);
  if (raw >= 0.05) st.lastVoicedMs = nowMs;
  st.amp = smoothAmp(st.amp, raw, dtMs);
  st.bobAmp += (raw - st.bobAmp) * (1 - Math.exp(-dtMs / BOB_TAU_MS));
  return {
    amp: st.amp,
    bobAmp: st.bobAmp,
    airMs: airMs ?? 0,
    silenceMs: st.lastVoicedMs === 0 ? 10_000 : nowMs - st.lastVoicedMs,
  };
}

/** Sway finer than this many output px does not warrant a scene update. */
const SWAY_QUANT_PX = 0.75;
/** A silent figure only drifts; it can move in coarser steps. The studio
 * holds 5 figures × 3 sway axes, and every fine quantum crossing on any of
 * them costs a full engine render-graph rebuild. */
const IDLE_SWAY_QUANT_PX = 2;

/** Everything a drawn figure depends on, pre-quantized, plus the pose key.
 * The renderer draws exactly these values, so ticks that leave the key
 * unchanged are guaranteed to leave the picture unchanged too. */
export type FigureVisual = {
  viseme: PuppetViseme;
  eyesClosed: boolean;
  glow: 0 | 1 | 2 | 3;
  /** Slow envelope bucket used for mouth scale and head bob. */
  bob: number;
  /** Sway in canvas px, snapped to the output-px grid. */
  sway: PuppetSway;
  browsUp: boolean;
  key: string;
};

export function figureVisual(args: {
  seed: number;
  /** Fast envelope: picks the viseme (syllable flapping). */
  amp: number;
  /** Slow envelope: sway, bob, glow, brows — see BOB_TAU_MS. */
  bobAmp: number;
  airMs: number;
  silenceMs: number;
  wallMs: number;
  /** Canvas→output px scale of this figure (studio guests are smaller). */
  kOut: number;
  active: boolean;
  cheer: boolean;
  sad: boolean;
}): FigureVisual {
  const { seed, amp, bobAmp, airMs, silenceMs, wallMs, kOut } = args;
  const viseme = pickViseme(amp, airMs, seed, silenceMs);
  const eyesClosed = args.sad || blinkClosed(wallMs, seed);
  const bobQ = Math.round(bobAmp / 0.15);
  const bob = Math.min(1, bobQ * 0.15);
  const glow = glowLevel(bob);
  const idle = bobAmp < 0.05;
  const quantCanvas =
    (idle ? IDLE_SWAY_QUANT_PX : SWAY_QUANT_PX) / Math.max(kOut, 1e-6);
  const raw = puppetSway(wallMs, seed, bob);
  const qBody = Math.round(raw.bodyX / quantCanvas);
  const qHeadX = Math.round(raw.headX / quantCanvas);
  const qHeadY = Math.round(raw.headY / quantCanvas);
  const sway: PuppetSway = {
    bodyX: qBody * quantCanvas,
    headX: qHeadX * quantCanvas,
    headY: qHeadY * quantCanvas,
  };
  const browsUp = (args.active && bobAmp < 0.08) || args.cheer;
  const key =
    `${viseme}|${eyesClosed ? 1 : 0}|${glow}|${bobQ}|` +
    `${idle ? 'i' : 's'}${qBody}|${qHeadX}|${qHeadY}|` +
    `${browsUp ? 1 : 0}|${args.cheer ? 1 : 0}`;
  return { viseme, eyesClosed, glow, bob, sway, browsUp, key };
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
