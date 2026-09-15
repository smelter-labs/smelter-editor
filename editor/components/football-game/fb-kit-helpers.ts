import type { FbEventKind } from '@smelter-editor/types';
import { parseHex } from '@/lib/arcade/color';

// Pure helpers of the Touchline kit (fb-kit.tsx re-exports them) — kept in a
// .ts file so the node vitest config can cover them.

/** Plate shape: a single cut top-right corner. */
export const cut = (px = 18): string =>
  `polygon(0 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% 100%, 0 100%)`;

/** Relative luminance (sRGB) of a hex colour, 0..1. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** Light colours take dark badge text, everything else chalk (apps only). */
export function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.4;
}

/** Very dark team colours get a hairline outline so the stripe still reads. */
export function needsOutline(hex: string): boolean {
  return luminance(hex) < 0.05;
}

/** Plex Mono advance is 0.6 em: predictable label widths without measuring. */
export const monoWidth = (text: string, fontSize: number): number =>
  text.length * 0.6 * fontSize;

/** On-panel wording of an event kind. */
export function eventLabel(kind: FbEventKind): string {
  switch (kind) {
    case 'goal':
      return 'GOAL';
    case 'chance':
      return 'CHANCE';
    case 'shot':
      return 'SHOT';
    case 'corner':
      return 'CORNER';
    case 'goal_kick':
      return 'GOAL KICK';
    case 'sprint':
      return 'SPRINT';
    case 'attack':
      return 'ATTACK';
    case 'out':
      return 'OUT';
    default:
      return String(kind).toUpperCase();
  }
}

/** Kinds the moderator can add by hand (the rest come from the telemetry). */
export const MANUAL_EVENT_KINDS: readonly FbEventKind[] = [
  'goal',
  'chance',
  'shot',
  'corner',
];
