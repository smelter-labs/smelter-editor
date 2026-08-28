/**
 * Pure layout math for the duck-hunter retro broadcast HUD (chips, scoreboard,
 * results scene). Engine Text has no auto-sizing, so widths come from the Doto
 * ~0.56 em/char estimate used across the HUD. Kept free of engine imports so
 * it unit-tests without Smelter.
 */

/** Estimated rendered width of a Doto string (plus breathing room). */
export function dotoTextWidth(fontSize: number, chars: number): number {
  return Math.round(fontSize * 0.56 * chars) + Math.round(fontSize * 0.3);
}

/** KBT-style design-space scale: layouts are authored in 1080p pixels. */
export function hudScale(resolution: { height: number }): number {
  return resolution.height / 1080;
}

export type Rect = { top: number; left: number; width: number; height: number };

/** Top-center match chip (clock / countdown label) for a given label. */
export function chipRect(
  parent: { width: number; height: number },
  label: string,
): Rect & { fontSize: number } {
  const fs = Math.max(18, Math.round(parent.height * 0.03));
  const chipFs = Math.round(fs * 1.15);
  const width =
    Math.round(chipFs * 0.62 * (label.length + 1)) + Math.round(chipFs * 1.2);
  const height = Math.round(chipFs * 1.9);
  return {
    top: Math.round(parent.width * 0.02),
    left: Math.round((parent.width - width) / 2),
    width,
    height,
    fontSize: chipFs,
  };
}

/** Scoreboard shell geometry (top-right), given the visible row count. */
export function scoreboardRect(
  parent: { width: number; height: number },
  rowCount: number,
): Rect & {
  fontSize: number;
  rowH: number;
  rowGap: number;
  padH: number;
  padV: number;
} {
  const margin = Math.round(parent.width * 0.02);
  const fs = Math.max(18, Math.round(parent.height * 0.03));
  const padH = Math.round(fs * 0.6);
  const padV = Math.round(fs * 0.5);
  const av = Math.round(fs * 1.9);
  // Taller than the pre-retro board (av*1.2): the row also carries the
  // character sub-label under the ammo pips.
  const rowH = Math.round(av * 1.45);
  const rowGap = Math.round(fs * 0.4);
  const width = Math.round(parent.width * 0.24);
  const height =
    padV * 2 + rowCount * rowH + Math.max(0, rowCount - 1) * rowGap;
  return {
    top: margin,
    left: parent.width - width - margin,
    width,
    height,
    fontSize: fs,
    rowH,
    rowGap,
    padH,
    padV,
  };
}

/**
 * Results-scene layout (full frame, authored at 1080p and scaled by k):
 * header on top, three columns below — WINNER, FINAL SCORES, TOP SCORES.
 */
export function resultsLayout(resolution: { width: number; height: number }): {
  k: number;
  headerTop: number;
  subTop: number;
  columnsTop: number;
  columnsH: number;
  colGap: number;
  winner: Rect;
  finals: Rect;
  tops: Rect;
} {
  const k = hudScale(resolution);
  const margin = Math.round(160 * k);
  const headerTop = Math.round(80 * k);
  const subTop = Math.round(190 * k);
  const columnsTop = Math.round(280 * k);
  const columnsH = Math.round(660 * k);
  const colGap = Math.round(36 * k);
  const innerW = resolution.width - margin * 2;
  const winnerW = Math.round(innerW * 0.28);
  const topsW = Math.round(innerW * 0.3);
  const finalsW = innerW - winnerW - topsW - colGap * 2;
  return {
    k,
    headerTop,
    subTop,
    columnsTop,
    columnsH,
    colGap,
    winner: { top: columnsTop, left: margin, width: winnerW, height: columnsH },
    finals: {
      top: columnsTop,
      left: margin + winnerW + colGap,
      width: finalsW,
      height: columnsH,
    },
    tops: {
      top: columnsTop,
      left: margin + winnerW + colGap + finalsW + colGap,
      width: topsW,
      height: columnsH,
    },
  };
}
