/**
 * Small colour helpers shared by the arcade games (team colour pickers,
 * jersey sampling, "these two colours are too close" warnings). Pure — no
 * DOM — so they are unit-testable; the video sampler lives in color-sample.ts.
 */

export type Rgb = { r: number; g: number; b: number };
export type Hsv = { h: number; s: number; v: number };

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Parse `#rgb` / `#rrggbb` (case-insensitive); null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const p = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** RGB 0..255 → HSV with h in degrees 0..360, s/v in 0..1. */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Shortest angular distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Perceptual-ish distance used for "are these team colours distinguishable
 * on camera": hue difference dominates for saturated colours, value/sat
 * differences carry greys/whites/blacks. Range roughly 0..1.
 */
export function colorDistance(aHex: string, bHex: string): number {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  if (!a || !b) return 1;
  const ha = rgbToHsv(a);
  const hb = rgbToHsv(b);
  // Hue only counts when both colours actually have a hue.
  const satWeight = Math.min(ha.s, hb.s);
  const hue = (hueDistance(ha.h, hb.h) / 180) * satWeight;
  const sat = Math.abs(ha.s - hb.s) * 0.5;
  const val = Math.abs(ha.v - hb.v) * 0.5;
  return Math.min(1, Math.sqrt(hue * hue + sat * sat + val * val));
}

/** Below this the AI's jersey classifier will struggle (warn in the lobby). */
export const TEAM_COLOR_MIN_DISTANCE = 0.22;

export function colorsTooClose(aHex: string, bHex: string): boolean {
  return colorDistance(aHex, bHex) < TEAM_COLOR_MIN_DISTANCE;
}

/** Median of a list of RGB samples (per channel — robust to a stray pixel). */
export function medianRgb(samples: Rgb[]): Rgb | null {
  if (samples.length === 0) return null;
  const pick = (key: keyof Rgb) => {
    const sorted = samples.map((s) => s[key]).sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return { r: pick('r'), g: pick('g'), b: pick('b') };
}
