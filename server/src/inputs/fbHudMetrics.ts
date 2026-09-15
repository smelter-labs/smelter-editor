/**
 * Layout helpers for the Touchline broadcast chrome (FbHud.tsx), kept
 * DOM/engine-free so the position maths is unit-testable.
 */

/** Plex Mono advance is 0.6 em: label widths are predictable without measuring. */
export function monoWidth(text: string, fontSize: number): number {
  return text.length * 0.6 * fontSize;
}

/** A runtime tag chip: the block hugs the text with 8 px side padding, centred on `cx`. */
export function tagChipRect(
  text: string,
  fontSize: number,
  cx: number,
  y: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.round(monoWidth(text, fontSize) + 16);
  return { x: Math.round(cx - w / 2), y, w, h: height };
}

export type ClockFace = {
  main: string;
  mainColor: 'chalk' | 'amber' | 'bad' | 'grass' | 'dim';
  tag: string;
  tagTone: 'grass' | 'amber' | 'chalk' | 'outline';
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Score-bug clock face: the match minute counts up; past the half length it
 * keeps counting with an ADDED TIME tag (a real referee's watch).
 */
export function clockFace(clock: {
  phase: 'lobby' | 'live' | 'paused' | 'halftime' | 'ended';
  period: 1 | 2;
  elapsedMs: number;
  halfMs: number;
}): ClockFace {
  const halfLabel = clock.period === 2 ? '2ND HALF' : '1ST HALF';
  const shown =
    clock.period === 2 ? clock.elapsedMs + clock.halfMs : clock.elapsedMs;
  switch (clock.phase) {
    case 'lobby':
      return {
        main: 'PRE-MATCH',
        mainColor: 'dim',
        tag: `2 × ${Math.round(clock.halfMs / 60000)}'`,
        tagTone: 'outline',
      };
    case 'paused':
      return {
        main: formatClock(shown),
        mainColor: 'amber',
        tag: 'PAUSED',
        tagTone: 'amber',
      };
    case 'halftime':
      return {
        main: 'HT',
        mainColor: 'chalk',
        tag: 'HALF TIME',
        tagTone: 'chalk',
      };
    case 'ended':
      return {
        main: 'FT',
        mainColor: 'chalk',
        tag: 'FULL TIME',
        tagTone: 'chalk',
      };
    default: {
      const over = clock.elapsedMs - clock.halfMs;
      if (over >= 0) {
        return {
          main: formatClock(shown),
          mainColor: 'amber',
          tag: `+${Math.floor(over / 60000)}' ADDED`,
          tagTone: 'amber',
        };
      }
      return {
        main: formatClock(shown),
        mainColor: 'chalk',
        tag: halfLabel,
        tagTone: 'grass',
      };
    }
  }
}

// ── Minimap ─────────────────────────────────────────────────────────────────

/** The pitch drawing inside the minimap plate (design px, plate-local). */
export const MINIMAP_PLATE = { w: 336, h: 218 };
export const MINIMAP_PITCH = { x: 14, y: 26, w: 308, h: 178 };

/** Pitch metres (X 0..105, Y 0..68) → plate-local design px. */
export function minimapPoint(xM: number, yM: number): { x: number; y: number } {
  const p = MINIMAP_PITCH;
  return {
    x: p.x + (Math.max(-3, Math.min(108, xM)) / 105) * p.w,
    y: p.y + (Math.max(-3, Math.min(71, yM)) / 68) * p.h,
  };
}

/** Pitch line rectangles (plate-local design px): outline, halfway, boxes. */
export function minimapLines(): {
  x: number;
  y: number;
  w: number;
  h: number;
}[] {
  const p = MINIMAP_PITCH;
  const kx = p.w / 105;
  const ky = p.h / 68;
  const t = 1;
  const rect = (x: number, y: number, w: number, h: number) => [
    { x, y, w, h: t },
    { x, y: y + h - t, w, h: t },
    { x, y, w: t, h },
    { x: x + w - t, y, w: t, h },
  ];
  return [
    ...rect(p.x, p.y, p.w, p.h),
    { x: p.x + p.w / 2 - t / 2, y: p.y, w: t, h: p.h },
    ...rect(p.x, p.y + 13.85 * ky, 16.5 * kx, 40.3 * ky),
    ...rect(p.x + p.w - 16.5 * kx, p.y + 13.85 * ky, 16.5 * kx, 40.3 * ky),
  ];
}
