/**
 * OB Van shot → stage: where each camera's tile sits on the `ob-stage` layer
 * for a shot, which cameras are on air, the per-camera looks (grade /
 * spotlight), the blurred backdrop, the audio map and the tile choreography
 * of every transition type. Pure maths in output pixels.
 *
 * Every camera with an input appears in the tile list EXACTLY once — off-air
 * cameras sit on the 1×1 park rect, so they keep decoding (side channel +
 * audio) and RoomState's unplaced-input auto-append never airs them.
 *
 * Tiles are drawn in list order (a later tile paints over an earlier one):
 * a dissolve lists the incoming picture first and the outgoing one last, at
 * its old rect, fading out on top.
 */
import type {
  ObAudioPolicy,
  ObEffects,
  ObGrade,
  ObPipCorner,
  ObPipSize,
  ObShot,
  ObTransitionType,
} from '@smelter-editor/types';
import { kbtParkRect } from '../app/store';
import { clampCrop, tileForCrop, type Crop } from '../football/director';

export type ObRect = { x: number; y: number; width: number; height: number };

/** One tile of the `ob-stage` layer (same contract as the football stage). */
export type ObStageTile = ObRect & {
  inputId: string;
  transitionDurationMs?: number;
  transitionEasing?: string;
};

/** What the scene needs to know about a camera. */
export type ObSceneCam = {
  id: string;
  inputId: string | null;
  width: number | null;
  height: number | null;
  live: boolean;
};

/**
 * `focus`: where the spotlight sits on the camera's own picture when only a
 * window of it is on air (virtual shot) — centre in −1..1 of the frame and
 * the window's width fraction (the vignette shrinks with it).
 */
export type ObTileLook = {
  grade: ObGrade;
  spotlight: boolean;
  focus?: { cx: number; cy: number; scale: number };
};

export type ObStage = {
  /** Every camera with an input, exactly once. */
  tiles: ObStageTile[];
  /** Cameras whose tile is visible, in layout order. */
  onAir: string[];
  /** Look per input (all cameras, so the look wrapper never remounts on a cut). */
  looks: Record<string, ObTileLook>;
  /** Blurred full-frame copy of the main camera behind a split / PiP / portrait shot. */
  backdrop: { inputId: string } | null;
};

export type ObInputTransition = {
  inputId: string;
  type: 'fade' | 'dissolve' | 'wipe-left' | 'wipe-right';
  durationMs: number;
  direction: 'in' | 'out';
};

export type ObTransitionPlan = {
  /** The layout to apply now. */
  tiles: ObStageTile[];
  /** Per-input shader transitions to start right before the layout. */
  transitions: ObInputTransition[];
  /** Outgoing inputs left at their old rect; park them when the transition ends. */
  leaving: string[];
  /** zoom-punch: the layout to apply one engine frame later (the punch-out). */
  followUp: ObStageTile[] | null;
};

const DEFAULT_ASPECT = 16 / 9;
const EASE = 'cubic_bezier_ease_in_out';
/** Gap between side-by-side tiles and the frame margin, at 1080p. */
const GAP_1080 = 12;
const MARGIN_1080 = 48;
/** zoom-punch: the incoming picture starts this much larger. */
export const OB_PUNCH_OVERSCAN = 1.12;
const PIP_WIDTH: Record<ObPipSize, number> = { S: 0.22, M: 0.3, L: 0.38 };

export function camAspect(cam: ObSceneCam | undefined): number {
  if (!cam?.width || !cam.height) return DEFAULT_ASPECT;
  return Math.max(0.1, cam.width / cam.height);
}

const round = (r: ObRect): ObRect => {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return {
    x,
    y,
    width: Math.max(2, Math.round(r.x + r.width) - x),
    height: Math.max(2, Math.round(r.y + r.height) - y),
  };
};

/** The largest rect of `aspect` inside `box`, centred. */
export function fitRect(aspect: number, box: ObRect): ObRect {
  let width = box.width;
  let height = width / aspect;
  if (height > box.height) {
    height = box.height;
    width = height * aspect;
  }
  return round({
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  });
}

export function fullRect(res: { width: number; height: number }): ObRect {
  return { x: 0, y: 0, width: res.width, height: res.height };
}

/** Side-by-side row of pictures at their own aspect, centred (KBT's tileRow). */
export function splitRects(
  aspects: readonly number[],
  res: { width: number; height: number },
): ObRect[] {
  if (aspects.length === 0) return [];
  const gap = GAP_1080 * (res.height / 1080);
  const free = res.width - gap * (aspects.length - 1);
  const sum = aspects.reduce((a, b) => a + Math.max(0.1, b), 0);
  const h = Math.min(res.height, free / sum);
  const total = sum * h + gap * (aspects.length - 1);
  let x = (res.width - total) / 2;
  const y = (res.height - h) / 2;
  return aspects.map((a) => {
    const w = Math.max(0.1, a) * h;
    const r = round({ x, y, width: w, height: h });
    x += w + gap;
    return r;
  });
}

/** Picture-in-picture inset rect in a corner. */
export function pipRect(
  corner: ObPipCorner,
  size: ObPipSize,
  res: { width: number; height: number },
  insetAspect: number,
): ObRect {
  const k = res.height / 1080;
  const m = MARGIN_1080 * k;
  let width = res.width * PIP_WIDTH[size];
  let height = width / insetAspect;
  const maxH = res.height * (PIP_WIDTH[size] + 0.18);
  if (height > maxH) {
    height = maxH;
    width = height * insetAspect;
  }
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  return round({
    x: left ? m : res.width - m - width,
    y: top ? m : res.height - m - height,
    width,
    height,
  });
}

/** Grid cells for `n` pictures (`cols` columns), last row centred. */
function gridCells(
  n: number,
  cols: number,
  res: { width: number; height: number },
): ObRect[] {
  if (n <= 0) return [];
  const gap = GAP_1080 * (res.height / 1080);
  const rows = Math.ceil(n / cols);
  const cellW = (res.width - gap * (cols - 1)) / cols;
  const cellH = (res.height - gap * (rows - 1)) / rows;
  const out: ObRect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const rowW = inRow * cellW + (inRow - 1) * gap;
    const x0 = (res.width - rowW) / 2;
    out.push({
      x: x0 + col * (cellW + gap),
      y: row * (cellH + gap),
      width: cellW,
      height: cellH,
    });
  }
  return out;
}

export function quadRects(
  aspects: readonly number[],
  res: { width: number; height: number },
): ObRect[] {
  const n = Math.min(4, aspects.length);
  const cols = n <= 1 ? 1 : 2;
  return gridCells(n, cols, res).map((cell, i) => fitRect(aspects[i], cell));
}

export function gridColumns(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

export function gridRects(
  aspects: readonly number[],
  res: { width: number; height: number },
): ObRect[] {
  return gridCells(aspects.length, gridColumns(aspects.length), res).map(
    (cell, i) => fitRect(aspects[i], cell),
  );
}

/** Slides big on the left (70 %), the speaker in the right column (30 %). */
export function speakerSlidesRects(
  slidesAspect: number,
  speakerAspect: number,
  res: { width: number; height: number },
): { slides: ObRect; speaker: ObRect } {
  const k = res.height / 1080;
  const m = MARGIN_1080 * k;
  const gap = GAP_1080 * 2 * k;
  const slidesBox = {
    x: m,
    y: m,
    width: res.width * 0.7 - m - gap / 2,
    height: res.height - 2 * m,
  };
  const speakerBox = {
    x: res.width * 0.7 + gap / 2,
    y: m,
    width: res.width * 0.3 - m - gap / 2,
    height: res.height - 2 * m,
  };
  return {
    slides: fitRect(slidesAspect, slidesBox),
    speaker: fitRect(speakerAspect, speakerBox),
  };
}

/** `rect` scaled by `factor` around its centre (the zoom-punch start). */
export function overscanRect(rect: ObRect, factor = OB_PUNCH_OVERSCAN): ObRect {
  const w = rect.width * factor;
  const h = rect.height * factor;
  return round({
    x: rect.x - (w - rect.width) / 2,
    y: rect.y - (h - rect.height) / 2,
    width: w,
    height: h,
  });
}

/** The oversized tile that shows `crop` (source px) of a camera full-frame. */
export function virtualTile(
  crop: Crop,
  cam: { width: number; height: number },
  res: { width: number; height: number },
): ObRect {
  const src = { w: cam.width, h: cam.height };
  return tileForCrop(clampCrop(crop, src), src, res);
}

/** Cameras a shot draws, with their rects, in paint order. */
function placeShot(
  shot: ObShot,
  byId: Map<string, ObSceneCam>,
  res: { width: number; height: number },
  virtualCrop: Crop | null,
): { camId: string; rect: ObRect }[] {
  const has = (id: string) => byId.get(id)?.inputId != null;
  const aspect = (id: string) => camAspect(byId.get(id));
  const full = fullRect(res);
  switch (shot.kind) {
    case 'solo':
      return has(shot.cam)
        ? [{ camId: shot.cam, rect: fitRect(aspect(shot.cam), full) }]
        : [];
    case 'virtual': {
      const cam = byId.get(shot.cam);
      if (!cam?.inputId) return [];
      if (!virtualCrop || !cam.width || !cam.height)
        return [{ camId: shot.cam, rect: fitRect(aspect(shot.cam), full) }];
      return [
        {
          camId: shot.cam,
          rect: virtualTile(
            virtualCrop,
            { width: cam.width, height: cam.height },
            res,
          ),
        },
      ];
    }
    case 'split': {
      const ids = unique(shot.cams).filter(has);
      const rects = splitRects(ids.map(aspect), res);
      return ids.map((camId, i) => ({ camId, rect: rects[i] }));
    }
    case 'pip': {
      const out: { camId: string; rect: ObRect }[] = [];
      if (has(shot.main))
        out.push({ camId: shot.main, rect: fitRect(aspect(shot.main), full) });
      if (has(shot.inset) && shot.inset !== shot.main)
        out.push({
          camId: shot.inset,
          rect: pipRect(
            shot.corner ?? 'br',
            shot.size ?? 'M',
            res,
            aspect(shot.inset),
          ),
        });
      return out;
    }
    case 'quad': {
      const ids = unique(shot.cams).filter(has).slice(0, 4);
      const rects = quadRects(ids.map(aspect), res);
      return ids.map((camId, i) => ({ camId, rect: rects[i] }));
    }
    case 'grid': {
      const ids = (
        shot.cams.length
          ? unique(shot.cams)
          : [...byId.values()].filter((c) => c.live).map((c) => c.id)
      ).filter(has);
      const rects = gridRects(ids.map(aspect), res);
      return ids.map((camId, i) => ({ camId, rect: rects[i] }));
    }
    case 'speaker-slides': {
      const r = speakerSlidesRects(
        aspect(shot.slides),
        aspect(shot.speaker),
        res,
      );
      const out: { camId: string; rect: ObRect }[] = [];
      if (has(shot.slides)) out.push({ camId: shot.slides, rect: r.slides });
      if (has(shot.speaker) && shot.speaker !== shot.slides)
        out.push({ camId: shot.speaker, rect: r.speaker });
      return out;
    }
  }
}

function unique(ids: readonly string[]): string[] {
  return ids.filter((c, i) => ids.indexOf(c) === i);
}

/** The camera the shot is "about" (spotlight, backdrop, replay default). */
export function primaryCam(shot: ObShot): string {
  switch (shot.kind) {
    case 'solo':
    case 'virtual':
      return shot.cam;
    case 'pip':
      return shot.main;
    case 'speaker-slides':
      return shot.speaker;
    case 'split':
      return shot.cams[0];
    case 'quad':
    case 'grid':
      return shot.cams[0] ?? '';
  }
}

function spotlightCams(shot: ObShot): string[] {
  switch (shot.kind) {
    case 'split':
      return [...shot.cams];
    case 'quad':
    case 'grid':
      return [];
    default:
      return [primaryCam(shot)];
  }
}

function needsBackdrop(
  shot: ObShot,
  byId: Map<string, ObSceneCam>,
  res: { width: number; height: number },
): boolean {
  switch (shot.kind) {
    case 'split':
    case 'speaker-slides':
    case 'quad':
    case 'grid':
      return true;
    case 'virtual':
      return false;
    case 'solo':
    case 'pip': {
      const a = camAspect(byId.get(primaryCam(shot)));
      return Math.abs(a - res.width / res.height) > 0.05;
    }
  }
}

/**
 * The stage for `shot` (null = black, every camera parked). `cams` in bus
 * order; `virtualCrop` is the virtual camera's current window (source px).
 */
export function buildStage(
  shot: ObShot | null,
  cams: readonly ObSceneCam[],
  res: { width: number; height: number },
  effects: ObEffects,
  virtualCrop: Crop | null = null,
): ObStage {
  const byId = new Map(cams.map((c) => [c.id, c]));
  const placed = shot ? placeShot(shot, byId, res, virtualCrop) : [];
  const tiles: ObStageTile[] = [];
  const used = new Set<string>();
  for (const p of placed) {
    const inputId = byId.get(p.camId)?.inputId;
    if (!inputId || used.has(inputId)) continue;
    used.add(inputId);
    tiles.push({ inputId, ...p.rect });
  }
  const park = kbtParkRect(res);
  for (const cam of cams) {
    if (!cam.inputId || used.has(cam.inputId)) continue;
    used.add(cam.inputId);
    tiles.push({ inputId: cam.inputId, ...park });
  }
  const spot = new Set(shot && effects.spotlight ? spotlightCams(shot) : []);
  const looks: Record<string, ObTileLook> = {};
  for (const cam of cams) {
    if (!cam.inputId) continue;
    const look: ObTileLook = {
      grade: effects.grade,
      spotlight: spot.has(cam.id),
    };
    const focus =
      shot?.kind === 'virtual' && shot.cam === cam.id
        ? focusOf(virtualCrop, cam)
        : null;
    if (look.spotlight && focus) look.focus = focus;
    looks[cam.inputId] = look;
  }
  const primaryInput = shot ? byId.get(primaryCam(shot))?.inputId : null;
  const backdrop =
    shot &&
    effects.softBackground &&
    primaryInput &&
    placed.length > 0 &&
    needsBackdrop(shot, byId, res)
      ? { inputId: primaryInput }
      : null;
  return {
    tiles,
    onAir: placed.map((p) => p.camId),
    looks,
    backdrop,
  };
}

function focusOf(
  crop: Crop | null,
  cam: ObSceneCam,
): ObTileLook['focus'] | null {
  if (!crop || !cam.width || !cam.height) return null;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    cx: r3(((crop.x + crop.w / 2) / cam.width) * 2 - 1),
    cy: r3(((crop.y + crop.h / 2) / cam.height) * 2 - 1),
    scale: r3(Math.min(1, crop.w / cam.width)),
  };
}

const visible = (t: ObRect) => t.width > 1 && t.height > 1;

/**
 * Volume per input for the audio policy: `follow` = the cameras on air,
 * `master` = one camera always (falls back to follow when it is gone),
 * `mix` = every camera.
 */
export function audioMap(
  policy: ObAudioPolicy,
  onAirCamIds: readonly string[],
  cams: readonly ObSceneCam[],
): Map<string, 0 | 1> {
  const out = new Map<string, 0 | 1>();
  const masterOk =
    policy.mode === 'master' &&
    cams.some((c) => c.id === policy.cam && c.inputId);
  for (const cam of cams) {
    if (!cam.inputId) continue;
    let on: boolean;
    if (policy.mode === 'mix') on = true;
    else if (masterOk && policy.mode === 'master') on = cam.id === policy.cam;
    else on = onAirCamIds.includes(cam.id);
    out.set(cam.inputId, on ? 1 : 0);
  }
  return out;
}

/**
 * Tile choreography of a program change from the tiles on screen (`from`) to
 * the target stage. `fading` = inputs still under a fade-out from an earlier
 * transition (their shader would keep them invisible) — an incoming one is
 * snapped back to full opacity.
 *
 * - cut (and the switch moment of fade / dip): the target layout, 0 ms.
 * - dissolve / wipe: target tiles first (staying ones glide), outgoing tiles
 *   LAST at their old rects with a fade / wipe out on top; incoming tiles fade
 *   in only when nothing covers them (e.g. a PiP inset appearing).
 * - zoom-punch: outgoing parked at once, incoming at an overscan rect, then
 *   (`followUp`) the target rect with a `durationMs` eased move.
 */
export function transitionPlan(
  from: readonly ObStageTile[],
  to: ObStage,
  type: ObTransitionType,
  durationMs: number,
  fading: ReadonlySet<string> = new Set(),
): ObTransitionPlan {
  const fromRects = new Map(
    from.filter(visible).map((t) => [t.inputId, t] as const),
  );
  const toVisible = to.tiles.filter(visible);
  const toIds = new Set(toVisible.map((t) => t.inputId));
  const incoming = toVisible.filter((t) => !fromRects.has(t.inputId));
  const outgoing = [...fromRects.values()].filter((t) => !toIds.has(t.inputId));
  const unfade = (ids: readonly ObStageTile[]): ObInputTransition[] =>
    ids
      .filter((t) => fading.has(t.inputId))
      .map((t) => ({
        inputId: t.inputId,
        type: 'fade' as const,
        durationMs: 0,
        direction: 'in' as const,
      }));
  const snap = (t: ObStageTile): ObStageTile => ({
    ...stripMotion(t),
    transitionDurationMs: 0,
  });

  const cut = (): ObTransitionPlan => ({
    tiles: to.tiles.map(snap),
    transitions: unfade(incoming),
    leaving: [],
    followUp: null,
  });

  if (durationMs <= 0) return cut();
  switch (type) {
    case 'cut':
    case 'fade':
    case 'dip':
      return cut();
    case 'dissolve':
    case 'wipe': {
      const shader = type === 'dissolve' ? 'fade' : 'wipe-left';
      const outIds = new Set(outgoing.map((t) => t.inputId));
      const tiles: ObStageTile[] = [
        ...toVisible.map((t) =>
          fromRects.has(t.inputId)
            ? {
                ...stripMotion(t),
                transitionDurationMs: durationMs,
                transitionEasing: EASE,
              }
            : snap(t),
        ),
        ...outgoing.map(snap),
        ...to.tiles
          .filter((t) => !visible(t) && !outIds.has(t.inputId))
          .map(snap),
      ];
      const transitions: ObInputTransition[] = outgoing.map((t) => ({
        inputId: t.inputId,
        type: shader,
        durationMs,
        direction: 'out',
      }));
      if (outgoing.length === 0) {
        for (const t of incoming)
          transitions.push({
            inputId: t.inputId,
            type: shader,
            durationMs,
            direction: 'in',
          });
      } else {
        transitions.push(...unfade(incoming));
      }
      return {
        tiles,
        transitions,
        leaving: outgoing.map((t) => t.inputId),
        followUp: null,
      };
    }
    case 'zoom-punch': {
      const incomingIds = new Set(incoming.map((t) => t.inputId));
      const tiles = to.tiles.map((t) =>
        incomingIds.has(t.inputId)
          ? { ...snap(t), ...overscanRect(t) }
          : snap(t),
      );
      const followUp = to.tiles.map((t) =>
        incomingIds.has(t.inputId)
          ? {
              ...stripMotion(t),
              transitionDurationMs: durationMs,
              transitionEasing: EASE,
            }
          : snap(t),
      );
      return {
        tiles,
        transitions: unfade(incoming),
        leaving: [],
        followUp,
      };
    }
  }
}

function stripMotion(t: ObStageTile): ObStageTile {
  return {
    inputId: t.inputId,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
  };
}
