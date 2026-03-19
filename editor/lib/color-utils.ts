const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// ── Packed-integer conversions ──────────────────────────

export function hexToPackedInt(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const fullHex =
    cleanHex.length === 3
      ? cleanHex
          .split('')
          .map((char) => char + char)
          .join('')
      : cleanHex;
  return parseInt(fullHex, 16);
}

export function packedIntToHex(packed: number): string {
  const r = ((packed >> 16) & 0xff).toString(16).padStart(2, '0');
  const g = ((packed >> 8) & 0xff).toString(16).padStart(2, '0');
  const b = (packed & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ── Hex normalisation ───────────────────────────────────

export function normalizeHexColor(color: string): string | null {
  if (!HEX_COLOR_RE.test(color)) return null;
  const raw = color.slice(1).toLowerCase();
  if (raw.length === 6) return `#${raw}`;
  return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
}

// ── RGB 0-1 conversions ─────────────────────────────────

export function hexToRgb01(color: string): {
  r: number;
  g: number;
  b: number;
} {
  const normalized = normalizeHexColor(color)!;
  const int = Number.parseInt(normalized.slice(1), 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  return { r, g, b };
}

export function rgb01ToHex(r: number, g: number, b: number): string {
  const toByte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)));
  const rr = toByte(r).toString(16).padStart(2, '0');
  const gg = toByte(g).toString(16).padStart(2, '0');
  const bb = toByte(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

// ── HSL conversions (s/l in 0-1 range) ──────────────────

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
      break;
  }
  h /= 6;

  return { h: h * 360, s, l };
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return {
    r: hueToRgb(hue + 1 / 3),
    g: hueToRgb(hue),
    b: hueToRgb(hue - 1 / 3),
  };
}

// ── Hex ↔ HSL with percentage s/l (0-100) ───────────────

export function hexToHsl(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb01(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export function hexToHsla(hex: string, alpha: number): string {
  const [h, s, l] = hexToHsl(hex);
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function generateShades(hex: string, count = 7): string[] {
  const [h, s] = hexToHsl(hex);
  const minL = 15;
  const maxL = 90;
  const step = (maxL - minL) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    hslToHex(h, s, Math.round(minL + i * step)),
  );
}

// ── Hue rotation ────────────────────────────────────────

export function rotateHexHue(color: string, deltaDeg: number): string {
  const { r, g, b } = hexToRgb01(color);
  const { h, s, l } = rgbToHsl(r, g, b);
  const rotated = hslToRgb(h + deltaDeg, s, l);
  return rgb01ToHex(rotated.r, rotated.g, rotated.b);
}
