import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Smelterionaire look — same tokens as server/scripts/ob-render-assets.mjs
// and server/src/inputs/ObQuizHud.tsx, so the fake reads as the real show.
export const CHALK = '#F2F4F8';
export const DIM = '#F2F4F8B3';
export const GOLD = '#FFD166';
export const RED = '#FF2D2D';
export const GREEN = '#22C55E';
export const SKY = '#38BDF8';
export const INK = '#0A0C10';
export const NAVY = 'rgba(7,11,24,.95)';

// Fonts are copied into public/fonts by server/scripts/smelterionaire-fake.mjs
// (from server/fonts) before a render; loadFont blocks until ready.
loadFont({
  family: 'BSD',
  url: staticFile('fonts/BigShouldersDisplay-Black.ttf'),
  weight: '900',
});
loadFont({
  family: 'BSD',
  url: staticFile('fonts/BigShouldersDisplay-ExtraBold.ttf'),
  weight: '800',
});
loadFont({
  family: 'BSD',
  url: staticFile('fonts/BigShouldersDisplay-Bold.ttf'),
  weight: '700',
});
loadFont({
  family: 'Plex',
  url: staticFile('fonts/IBMPlexMono-Regular.ttf'),
  weight: '400',
});
loadFont({
  family: 'Plex',
  url: staticFile('fonts/IBMPlexMono-Medium.ttf'),
  weight: '500',
});
loadFont({
  family: 'Plex',
  url: staticFile('fonts/IBMPlexMono-SemiBold.ttf'),
  weight: '600',
});

export const DISPLAY = 'BSD';
export const MONO = 'Plex';

/** `1500000` → `1,500,000 TOK` (same as obQuizFormatMoney in @smelter-editor/types). */
export const formatTok = (amount: number): string => {
  const abs = Math.abs(Math.round(amount));
  const digits = abs.toLocaleString('en-US');
  return `${amount < 0 ? '−' : ''}${digits} TOK`;
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// ── Shared prop shapes ─────────────────────────────────────────────────────

export type PuppetCharacterId = 'host' | 'nova' | 'bit' | 'prof' | 'lux';

/** 50 Hz RMS envelope of one spoken clip (sidecar of the TTS cache). */
export type MouthTrack = { rateHz: number; v: number[] };

/** One spoken line inside a scene, in seconds from the scene start. */
export type SpeechCue = {
  character: PuppetCharacterId;
  startS: number;
  durS: number;
  mouth: MouthTrack;
};

/** A host text plate (top bar) shown over a beat; audio lives on the guide track. */
export type HostPlateCue = { text: string; atS: number; untilS: number };

export type RailPlayer = {
  name: string;
  amount: number;
  /** Count-up origin once `changeAtS` passes; equal to `amount` = no count. */
  amountFrom: number;
  /** Scene-time seconds when the amount change (and tint) starts, if any. */
  changeAtS: number | null;
  verdict: 'correct' | 'wrong' | null;
  active: boolean;
  cashedOut: boolean;
  /** Scene-time seconds when the cash-out dimming starts (default: from 0). */
  cashOutAtS?: number;
};

export type QuizLetter = 'A' | 'B' | 'C' | 'D';
export const LETTERS: readonly QuizLetter[] = ['A', 'B', 'C', 'D'];
