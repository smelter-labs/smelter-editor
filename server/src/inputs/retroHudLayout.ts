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

/**
 * Chamfer for a box inset by `inset` inside a chamfered panel of chamfer
 * `panelCut`, expressed in the inset box's own pixel space. A 45° edge pushed
 * `inset` px inward travels inset*sqrt(2) along each axis while the box itself
 * only loses `inset` per side, so its corner shrinks by inset*(2 - sqrt(2)).
 * Anything larger and the inner corner still pokes past the panel's cut, which
 * is exactly the bug this exists to fix (see chamfer-clip.wgsl).
 */
export function chamferClipCut(panelCut: number, inset: number): number {
  return Math.max(0, panelCut - inset * (2 - Math.SQRT2));
}

/**
 * Shared geometry for the "avatar · name · ammo · character" row that both the
 * crosshair badge and the scoreboard draw. The two copies had already drifted
 * (avatar size, avatar gap, pip size), which is what made the badge read as a
 * different HUD, so the numbers live here — engine-free and unit-tested — and
 * both call sites read them.
 */
export function hunterRowMetrics(fs: number): {
  /** Square camera avatar. */
  av: number;
  /** Avatar → text column; the chunky frame needs air or letters sit on it. */
  avGap: number;
  nameH: number;
  pipSize: number;
  pipRowGap: number;
  /** Character sub-label. */
  subFs: number;
  subH: number;
  /** Dog tally icon (dog-tally.png is 29x28). */
  dogIconH: number;
  dogIconW: number;
  dogIconGap: number;
} {
  const dogIconH = Math.round(fs * 0.7);
  return {
    av: Math.round(fs * 1.9),
    avGap: Math.round(fs * 1.0),
    nameH: Math.round(fs * 1.25),
    pipSize: Math.max(5, Math.round(fs * 0.3)),
    pipRowGap: Math.round(fs * 0.18),
    subFs: Math.round(fs * 0.5),
    subH: Math.round(fs * 0.72),
    dogIconH,
    dogIconW: Math.round((dogIconH * 29) / 28),
    dogIconGap: Math.max(2, Math.round(fs * 0.12)),
  };
}

/**
 * Beyond this many dogs the strip stops growing: the icons would be shingled
 * down to a couple of pixels of visible edge each, which reads as noise.
 */
export const DOG_ICONS_MAX = 12;

/**
 * Horizontal step between dog tally icons, laid out right-to-left in a strip of
 * `stripW`. Once the pile no longer fits at full pitch the icons shingle — they
 * overlap like a fanned deck — instead of shrinking or sprouting a "+n" count.
 * That keeps the strip a constant width (so the score above it never moves) and
 * keeps the tally icon-only, which is the whole point of it.
 */
export function dogIconPitch(
  count: number,
  stripW: number,
  iconW: number,
  gap: number,
): number {
  const full = iconW + gap;
  if (count <= 1) return full;
  // The last icon's left edge is stripW - iconW - (count-1)*pitch, so capping
  // pitch here is what proves the pile can never escape the strip.
  return Math.min(full, Math.max(0, (stripW - iconW) / (count - 1)));
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

/** A panel on the opening screen: its box plus the inner padding it reserves. */
export type OpeningColumn = Rect & { pad: number; titleTop: number };

/** JOIN column: the QR sits above the address label and the scan hint. */
export type OpeningJoinColumn = OpeningColumn & {
  /** QR box, relative to the column. */
  qr: Rect;
  labelTop: number;
  hintTop: number;
};

/** A column of stacked rows (HOW TO PLAY, TOP SCORES). */
export type OpeningListColumn = OpeningColumn & {
  /** First row's y, relative to the column. */
  rowTop: number;
  rowH: number;
  /** How many rows the column has vertical room for. */
  rows: number;
};

/**
 * Full-frame opening screen (armed lobby): branding band, a centered ROUND
 * banner, three content columns (JOIN QR · HOW TO PLAY · TOP SCORES) and a row
 * of live hunter tiles across the bottom. Authored at 1080p and scaled by k,
 * like the results scene.
 *
 * Unlike lineupLayout the tile size is capped rather than grown to fill: here
 * the tiles are one band among several, not the whole scene.
 */
export function openingLayout(
  resolution: { width: number; height: number },
  playerCount: number,
  bannerLabel: string,
): {
  k: number;
  eyebrowTop: number;
  eyebrowFs: number;
  titleTop: number;
  titleFs: number;
  starTop: number;
  starFs: number;
  banner: Rect & { fontSize: number };
  join: OpeningJoinColumn;
  howTo: OpeningListColumn;
  tops: OpeningListColumn;
  tileSize: number;
  gap: number;
  rowTop: number;
  rowLeft: number;
  nameTop: number;
  nameFs: number;
  captionTop: number;
  captionFs: number;
  footerTop: number;
  footerFs: number;
} {
  const k = hudScale(resolution);
  const px = (v: number) => Math.round(v * k);
  const margin = px(60);
  const innerW = resolution.width - margin * 2;

  // The banner hugs its label (Views don't auto-size) but stays a headline.
  const bannerFs = px(40);
  const bannerW = Math.max(
    px(560),
    Math.min(px(1100), dotoTextWidth(bannerFs, bannerLabel.length) + px(120)),
  );

  const columnsTop = px(314);
  const columnsH = px(352);
  const colGap = px(36);
  const joinW = px(400);
  const topsW = px(500);
  // HOW TO PLAY takes the slack: it holds the longest lines.
  const howToW = innerW - joinW - topsW - colGap * 2;
  const joinPad = px(22);
  const qrSize = px(200);

  const gap = px(28);
  const n = Math.max(1, playerCount);
  const tileSize = Math.max(
    px(120),
    Math.min(px(240), Math.floor((innerW - gap * (n - 1)) / n)),
  );
  const rowW = n * tileSize + gap * (n - 1);
  const rowTop = px(690);
  const nameFs = px(30);
  const nameTop = rowTop + tileSize + px(12);
  const captionTop = nameTop + Math.round(nameFs * 1.45);

  return {
    k,
    eyebrowTop: px(26),
    eyebrowFs: px(22),
    titleTop: px(60),
    titleFs: px(76),
    starTop: px(168),
    starFs: px(24),
    banner: {
      top: px(210),
      left: Math.round((resolution.width - bannerW) / 2),
      width: bannerW,
      height: px(84),
      fontSize: bannerFs,
    },
    join: {
      top: columnsTop,
      left: margin,
      width: joinW,
      height: columnsH,
      pad: joinPad,
      titleTop: joinPad,
      qr: {
        top: px(66),
        left: Math.round((joinW - qrSize) / 2),
        width: qrSize,
        height: qrSize,
      },
      labelTop: px(278),
      hintTop: px(314),
    },
    howTo: {
      top: columnsTop,
      left: margin + joinW + colGap,
      width: howToW,
      height: columnsH,
      pad: px(26),
      titleTop: px(26),
      rowTop: px(82),
      rowH: px(62),
      rows: 4,
    },
    tops: {
      top: columnsTop,
      left: margin + joinW + colGap + howToW + colGap,
      width: topsW,
      height: columnsH,
      pad: joinPad,
      titleTop: joinPad,
      rowTop: px(92),
      rowH: px(48),
      rows: 5,
    },
    tileSize,
    gap,
    rowTop,
    rowLeft: margin + Math.round((innerW - rowW) / 2),
    nameTop,
    nameFs,
    captionTop,
    captionFs: px(20),
    footerTop: px(1024),
    footerFs: px(22),
  };
}

/**
 * Hunter-lineup layout (the 3-2-1 countdown): a centered row of square avatar
 * tiles — the player's live camera when they share one, otherwise their
 * character clip cropped to the square — with name and character title under
 * each. The tile grows to fill the row (the lobby caps the roster at 3),
 * unlike openingLayout, where the tiles are one band among several.
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
