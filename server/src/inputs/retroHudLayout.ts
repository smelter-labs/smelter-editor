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

/** One place on the results podium: clip box, pedestal under it, name above. */
export type PodiumSlot = {
  /** 1-based finishing place (slots are returned left-to-right as 2, 1, 3). */
  place: number;
  /** 16:9 box for the character clip; it stands on top of the pedestal. */
  clip: Rect;
  /** Panel below the clip carrying the rank digit and the score. */
  pedestal: Rect;
  /** Band above the clip for the player name + character title. */
  label: Rect;
};

/** A results list column, pre-split into the two row sub-columns it renders. */
export type ResultsColumn = Rect & {
  /** Inner padding (both axes). */
  pad: number;
  /** Width of one row sub-column. */
  subWidth: number;
  /** X of each sub-column, relative to the column box. */
  subLefts: [number, number];
};

/**
 * Results-scene layout (full frame, authored at 1080p and scaled by k):
 * header, a full-width TOP 3 podium of character clips on pedestals, and two
 * wide list columns below — FINAL SCORES and TOP SCORES. The columns are short
 * but wide, so each renders its rows in two sub-columns instead of dropping
 * entries (8 finalists as 2x4, 10 top scores as 2x5).
 */
export function resultsLayout(resolution: { width: number; height: number }): {
  k: number;
  headerTop: number;
  subTop: number;
  podium: Rect;
  slots: PodiumSlot[];
  columnsTop: number;
  columnsH: number;
  colGap: number;
  finals: ResultsColumn;
  tops: ResultsColumn;
} {
  const k = hudScale(resolution);
  const margin = Math.round(100 * k);
  const headerTop = Math.round(26 * k);
  const subTop = Math.round(146 * k);
  const podiumTop = Math.round(205 * k);
  const podiumH = Math.round(420 * k);
  const columnsTop = Math.round(650 * k);
  const columnsH = Math.round(360 * k);
  const colGap = Math.round(40 * k);
  const pad = Math.round(24 * k);
  const innerW = resolution.width - margin * 2;

  const podium: Rect = {
    top: podiumTop,
    left: margin,
    width: innerW,
    height: podiumH,
  };

  // Winner clip is the widest; the pedestal heights carry the ranking. Slots
  // sit on a shared baseline at the bottom of the podium band.
  const winnerClipW = Math.round(380 * k);
  const runnerClipW = Math.round(280 * k);
  const slotGap = Math.round(30 * k);
  const labelH = Math.round(76 * k);
  const clipH = (w: number) => Math.round((w * 9) / 16);
  const spec: { place: number; clipW: number; pedH: number }[] = [
    { place: 2, clipW: runnerClipW, pedH: Math.round(92 * k) },
    { place: 1, clipW: winnerClipW, pedH: Math.round(130 * k) },
    { place: 3, clipW: runnerClipW, pedH: Math.round(66 * k) },
  ];
  const rowW =
    spec.reduce((sum, s) => sum + s.clipW, 0) + slotGap * (spec.length - 1);
  const base = podiumTop + podiumH;
  let x = margin + Math.round((innerW - rowW) / 2);
  const slots: PodiumSlot[] = spec.map((s) => {
    const h = clipH(s.clipW);
    const pedestalTop = base - s.pedH;
    const clipTop = pedestalTop - h;
    const slot: PodiumSlot = {
      place: s.place,
      clip: { top: clipTop, left: x, width: s.clipW, height: h },
      pedestal: { top: pedestalTop, left: x, width: s.clipW, height: s.pedH },
      label: { top: clipTop - labelH, left: x, width: s.clipW, height: labelH },
    };
    x += s.clipW + slotGap;
    return slot;
  });

  const finalsW = Math.round((innerW - colGap) / 2);
  const topsW = innerW - finalsW - colGap;
  const column = (left: number, width: number): ResultsColumn => {
    const subWidth = Math.floor((width - pad * 2 - colGap) / 2);
    return {
      top: columnsTop,
      left,
      width,
      height: columnsH,
      pad,
      subWidth,
      subLefts: [pad, pad + subWidth + colGap],
    };
  };

  return {
    k,
    headerTop,
    subTop,
    podium,
    slots,
    columnsTop,
    columnsH,
    colGap,
    finals: column(margin, finalsW),
    tops: column(margin + finalsW + colGap, topsW),
  };
}

/**
 * Hunter-lineup layout (lobby + countdown): a centered row of square avatar
 * tiles — the player's live camera when they share one, otherwise their
 * character clip cropped to the square — with name and character title under
 * each. The tile shrinks as the roster grows (the lobby caps at 6).
 */
export function lineupLayout(
  resolution: { width: number; height: number },
  playerCount: number,
): {
  k: number;
  headerTop: number;
  subTop: number;
  tileSize: number;
  gap: number;
  rowTop: number;
  rowLeft: number;
  nameTop: number;
  titleTop: number;
  /** 3-2-1 digit, in the band the captions leave free above the footer. */
  countdownTop: number;
  countdownFs: number;
  footerTop: number;
} {
  const k = hudScale(resolution);
  const margin = Math.round(100 * k);
  const innerW = resolution.width - margin * 2;
  const gap = Math.round(32 * k);
  const n = Math.max(1, playerCount);
  const tileSize = Math.max(
    Math.round(120 * k),
    Math.min(Math.round(360 * k), Math.floor((innerW - gap * (n - 1)) / n)),
  );
  const rowW = n * tileSize + gap * (n - 1);
  const rowTop = Math.round(330 * k);
  const titleTop = rowTop + tileSize + Math.round(66 * k);
  // The digit gets whatever is left under the captions; ArcadeBigText lays out
  // on a 1.4x line box, so size it to that band instead of overrunning it.
  const countdownTop = titleTop + Math.round(46 * k);
  const countdownFs = Math.floor((resolution.height - countdownTop) / 1.4);
  return {
    k,
    headerTop: Math.round(70 * k),
    subTop: Math.round(210 * k),
    tileSize,
    gap,
    rowTop,
    rowLeft: margin + Math.round((innerW - rowW) / 2),
    nameTop: rowTop + tileSize + Math.round(22 * k),
    titleTop,
    countdownTop,
    countdownFs,
    footerTop: Math.round(960 * k),
  };
}
