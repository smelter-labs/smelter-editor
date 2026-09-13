/**
 * Layout helpers for the Blacktop broadcast chrome (BbHud.tsx), kept
 * DOM/engine-free so the position maths is unit-testable.
 */

/** Plex Mono advance is 0.6 em: label widths are predictable without measuring. */
export function monoWidth(text: string, fontSize: number): number {
  return text.length * 0.6 * fontSize;
}

/**
 * A runtime tag chip (REG / PAUSED / FIRST TO +2 / FULL TIME): the block
 * hugs the text with 8 px side padding and centres on `cx`.
 */
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

/** The 496×320 PiP frame origin for a 480×270 window at pip rect (x, y). */
export function pipFrameOrigin(
  rect: { x: number; y: number },
  k: number,
): { x: number; y: number } {
  return { x: Math.round(rect.x / k) - 8, y: Math.round(rect.y / k) - 42 };
}

/** Clock face + tag for the score bug's centre cell. */
export type ClockFace = {
  main: string;
  mainColor: 'chalk' | 'amber' | 'bad' | 'electric' | 'dim';
  tag: string;
  tagTone: 'electric' | 'amber' | 'chalk' | 'outline';
};

export function clockFace(
  clock: {
    phase: 'lobby' | 'live' | 'paused' | 'overtime' | 'ended';
    period: 'reg' | 'ot';
    remainingMs: number;
  },
  otWinPoints: number,
  lobbyDurationMs: number | null,
  formatClock: (ms: number) => string,
): ClockFace {
  switch (clock.phase) {
    case 'lobby':
      return {
        main: 'WARM-UP',
        mainColor: 'dim',
        tag: formatClock(lobbyDurationMs ?? clock.remainingMs),
        tagTone: 'outline',
      };
    case 'paused':
      return {
        main: formatClock(clock.remainingMs),
        mainColor: 'amber',
        tag: 'PAUSED',
        tagTone: 'amber',
      };
    case 'overtime':
      return {
        main: 'OT',
        mainColor: 'electric',
        tag: `FIRST TO +${otWinPoints}`,
        tagTone: 'electric',
      };
    case 'ended':
      return {
        main: 'FINAL',
        mainColor: 'chalk',
        tag: clock.period === 'ot' ? 'AFTER OT' : 'FULL TIME',
        tagTone: 'chalk',
      };
    default:
      return {
        main: formatClock(clock.remainingMs),
        mainColor: clock.remainingMs <= 10_000 ? 'bad' : 'chalk',
        tag: clock.period === 'ot' ? 'OT' : 'REG',
        tagTone: 'electric',
      };
  }
}

// ── AI overlay geometry ─────────────────────────────────────────────────────
// The scorer worker reports the ball box and the rim ellipse normalized to
// the analysed frame; the hoop cam tile shows that frame cover-fitted
// (rescaleMode 'fill'), so every overlay element goes through the same
// transform as PeopleBoxes in inputs.tsx.

export type Px = { x: number; y: number; w: number; h: number };
type NormRect = { x: number; y: number; w: number; h: number };
type Rim = { cx: number; cy: number; rx: number; ry: number };

/** Zone constants mirrored from analysis.py (in rim x-radii). */
export const AI_ZONE = {
  aboveHalfWidth: 2.5,
  aboveDepth: 5.0,
  rimTolerance: 1.15,
  netHalfWidth: 1.4,
  netDepth: 2.0,
} as const;

/**
 * Where the analysed frame lands inside `tile` when cover-fitted: the frame
 * is scaled to cover the tile, overflow cropped, centred. Returned in the
 * tile's own pixel space (may start before 0 / extend past the tile).
 */
export function coverTransform(
  tile: { w: number; h: number },
  frameAspect: number,
): Px {
  const aspect = frameAspect > 0 ? frameAspect : 16 / 9;
  const scale = Math.max(tile.w / aspect, tile.h);
  const w = aspect * scale;
  const h = scale;
  return { x: (tile.w - w) / 2, y: (tile.h - h) / 2, w, h };
}

/** A normalized rect of the frame → tile pixels. */
export function normRectToPx(disp: Px, r: NormRect): Px {
  return {
    x: disp.x + r.x * disp.w,
    y: disp.y + r.y * disp.h,
    w: r.w * disp.w,
    h: r.h * disp.h,
  };
}

/** Bounding box of the rim ellipse (scaled by the detector's tolerance). */
export function rimOverlayRect(
  disp: Px,
  rim: Rim,
  tol = AI_ZONE.rimTolerance,
): Px {
  return normRectToPx(disp, {
    x: rim.cx - rim.rx * tol,
    y: rim.cy - rim.ry * tol,
    w: 2 * rim.rx * tol,
    h: 2 * rim.ry * tol,
  });
}

/**
 * The detector's 'above' and 'below' (net) bands around the rim; depths are
 * in rim x-radii converted to frame y-units through the frame aspect.
 */
export function zoneBandRects(
  disp: Px,
  rim: Rim,
  frameAspect: number,
): { above: Px; net: Px } {
  const rxy = rim.rx * frameAspect;
  const above = normRectToPx(disp, {
    x: rim.cx - AI_ZONE.aboveHalfWidth * rim.rx,
    y: rim.cy - AI_ZONE.aboveDepth * rxy,
    w: 2 * AI_ZONE.aboveHalfWidth * rim.rx,
    h: AI_ZONE.aboveDepth * rxy,
  });
  const net = normRectToPx(disp, {
    x: rim.cx - AI_ZONE.netHalfWidth * rim.rx,
    y: rim.cy + rim.ry,
    w: 2 * AI_ZONE.netHalfWidth * rim.rx,
    h: AI_ZONE.netDepth * rxy,
  });
  return { above, net };
}

/** A square dot centred on the ball box, at least `minPx` wide. */
export function ballDotRect(disp: Px, ball: NormRect, minPx: number): Px {
  const b = normRectToPx(disp, ball);
  const size = Math.max(minPx, b.w, b.h);
  return {
    x: b.x + b.w / 2 - size / 2,
    y: b.y + b.h / 2 - size / 2,
    w: size,
    h: size,
  };
}
