/**
 * The virtual director: where the broadcast window sits on the panorama
 * (follow / wide / goal views), how it glides, and which of three fixed
 * cameras is on air. Pure maths in full-panorama pixels; the controller
 * turns the crop into an oversized layer tile (see tileForCrop) that the
 * engine clips to the output — that IS the virtual camera.
 */
import type {
  FbCamRole,
  FbDirectorConfig,
  FbSide,
  FbView,
} from '@smelter-editor/types';
import {
  PITCH_LENGTH,
  PITCH_WIDTH,
  projectPitch,
  type FbZones,
} from './telemetry';

export type Pano = { w: number; h: number };
export type Crop = { x: number; y: number; w: number; h: number };

/** Follow window width (full-panorama px) per zoom preset. */
export const FOLLOW_WIDTH: Record<FbDirectorConfig['zoom'], number> = {
  tight: 1400,
  normal: 1600,
  wide: 2000,
};
/** Speed-adaptive widening in `auto`: extra width per px/s of ball speed, capped. */
const AUTO_WIDEN_PER_PXS = 0.6;
const AUTO_WIDEN_MAX = 600;
const GOAL_VIEW_WIDTH = 1500;
/** Goal views centre this far inside the pitch from the goal centre (px). */
const GOAL_VIEW_INSET = 260;
/** Ball sits at this fraction of the window height (room for the play ahead). */
const VERTICAL_BIAS = 0.05;
const DEAD_ZONE_PX = 60;
const TAU_MS: Record<FbDirectorConfig['smoothing'], number> = {
  snappy: 350,
  smooth: 600,
};
const VELOCITY_CAP_PXS = 1200;
const CATCHUP_ERROR_PX = 900;
const CATCHUP_TAU_MS = 250;
const CATCHUP_CAP_PXS = 2500;
/** No ball fix for this long → drift to the wide view. */
export const BALL_LOST_WIDE_MS = 2000;
const LOST_TAU_MS = 1500;

export type FollowState = {
  cx: number;
  cy: number;
  /** Current window width (px); height follows the output aspect. */
  w: number;
};

export function clampCrop(crop: Crop, pano: Pano): Crop {
  const w = Math.min(crop.w, pano.w);
  const h = Math.min(crop.h, pano.h);
  return {
    x: Math.max(0, Math.min(pano.w - w, crop.x)),
    y: Math.max(0, Math.min(pano.h - h, crop.y)),
    w,
    h,
  };
}

/** Whole pitch: full panorama height, output aspect, centred on the pitch centre. */
export function wideCrop(
  pano: Pano,
  aspect: number,
  zones: FbZones | null,
): Crop {
  const h = pano.h;
  const w = Math.min(pano.w, Math.round(h * aspect));
  const cx = zones?.camera
    ? projectPitch(zones.camera, PITCH_LENGTH / 2, PITCH_WIDTH / 2)[0]
    : pano.w / 2;
  return clampCrop(
    { x: Math.round(cx - w / 2), y: 0, w, h: Math.round(w / aspect) },
    pano,
  );
}

/** Fixed crop on a penalty area. */
export function goalCrop(
  side: FbSide,
  pano: Pano,
  aspect: number,
  zones: FbZones | null,
): Crop {
  const w = GOAL_VIEW_WIDTH;
  const h = Math.round(w / aspect);
  let cx = side === 'left' ? pano.w * 0.17 : pano.w * 0.81;
  let cy = pano.h * 0.45;
  if (zones?.camera) {
    const [gx, gy] = projectPitch(
      zones.camera,
      side === 'left' ? 0 : PITCH_LENGTH,
      PITCH_WIDTH / 2,
    );
    cx = gx + (side === 'left' ? GOAL_VIEW_INSET : -GOAL_VIEW_INSET);
    cy = gy - VERTICAL_BIAS * h;
  }
  return clampCrop(
    { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h },
    pano,
  );
}

export function cropOf(state: FollowState, aspect: number, pano: Pano): Crop {
  const w = Math.round(state.w);
  const h = Math.round(w / aspect);
  return clampCrop(
    { x: Math.round(state.cx - w / 2), y: Math.round(state.cy - h / 2), w, h },
    pano,
  );
}

export type FollowInput = {
  /** Where the ball is heading (already averaged over the lookahead), or null when lost. */
  target: { x: number; y: number } | null;
  /** Ball speed (px/s) for the auto zoom. */
  speedPxS: number;
  /** ms since the last step (0 on the first). */
  dtMs: number;
  /** Requested view resolved to follow / auto. */
  auto: boolean;
  /** How long the ball has been lost (ms). */
  lostForMs: number;
  /** Fixed views (wide / goal): ease to `target` at exactly this width, no vertical bias. */
  fixedWidth?: number;
};

/**
 * One director tick of the follow window: exponential approach with a dead
 * zone, a velocity cap and a catch-up mode for long balls; width by zoom
 * preset (+ speed in auto); drifts to the wide view when the ball is lost.
 */
export function stepFollow(
  prev: FollowState | null,
  input: FollowInput,
  cfg: FbDirectorConfig,
  pano: Pano,
  aspect: number,
  zones: FbZones | null,
): FollowState {
  const base = FOLLOW_WIDTH[cfg.zoom];
  let targetW = base;
  if (input.auto) {
    targetW = Math.min(
      base + AUTO_WIDEN_MAX,
      base + AUTO_WIDEN_PER_PXS * input.speedPxS,
    );
  }
  let target = input.target;
  let tau = TAU_MS[cfg.smoothing];
  let cap = VELOCITY_CAP_PXS;
  if (input.fixedWidth != null && target) {
    targetW = input.fixedWidth;
  } else if (!target || input.lostForMs >= BALL_LOST_WIDE_MS) {
    const wide = wideCrop(pano, aspect, zones);
    target = { x: wide.x + wide.w / 2, y: wide.y + wide.h / 2 };
    targetW = wide.w;
    tau = LOST_TAU_MS;
    cap = VELOCITY_CAP_PXS;
  } else {
    // Ball sits a little above the centre: the play ahead is what matters.
    target = { x: target.x, y: target.y - VERTICAL_BIAS * (targetW / aspect) };
  }
  if (!prev) {
    return clampState({ cx: target.x, cy: target.y, w: targetW }, aspect, pano);
  }
  const dt = Math.max(0, input.dtMs) / 1000;
  const ex = target.x - prev.cx;
  const ey = target.y - prev.cy;
  const err = Math.hypot(ex, ey);
  if (err > CATCHUP_ERROR_PX) {
    tau = Math.min(tau, CATCHUP_TAU_MS);
    cap = CATCHUP_CAP_PXS;
  }
  let cx = prev.cx;
  let cy = prev.cy;
  if (err > DEAD_ZONE_PX && dt > 0) {
    const alpha = 1 - Math.exp(-(dt * 1000) / tau);
    let mx = ex * alpha;
    let my = ey * alpha;
    const step = Math.hypot(mx, my);
    const maxStep = cap * dt;
    if (step > maxStep) {
      mx *= maxStep / step;
      my *= maxStep / step;
    }
    cx += mx;
    cy += my;
  }
  // Width eases too, a little slower than the position.
  const wAlpha = dt > 0 ? 1 - Math.exp(-(dt * 1000) / (tau * 1.5)) : 1;
  const w = prev.w + (targetW - prev.w) * wAlpha;
  return clampState({ cx, cy, w }, aspect, pano);
}

function clampState(s: FollowState, aspect: number, pano: Pano): FollowState {
  const w = Math.min(pano.w, Math.max(400, s.w));
  const h = w / aspect;
  return {
    cx: Math.max(w / 2, Math.min(pano.w - w / 2, s.cx)),
    cy: Math.max(h / 2, Math.min(pano.h - h / 2, s.cy)),
    w,
  };
}

/**
 * The oversized tile that shows `crop` of the panorama in an output of
 * `out` pixels: the whole clip scaled so the crop fills the output, offset
 * so the crop's origin lands at (0,0). Everything outside is clipped by the
 * output — the tile's pixel size does not depend on the clip's resolution
 * (a half-res panorama scales up by the same rule).
 */
export function tileForCrop(
  crop: Crop,
  pano: Pano,
  out: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const k = out.width / crop.w;
  return {
    x: -Math.round(crop.x * k),
    y: -Math.round(crop.y * k),
    width: Math.round(pano.w * k),
    height: Math.round(pano.h * k),
  };
}

/** The crop an instant replay should bake in: the follow window widened a little. */
export function cropForReplay(
  centre: { x: number; y: number },
  cfg: FbDirectorConfig,
  pano: Pano,
  aspect: number,
): Crop {
  const w = FOLLOW_WIDTH[cfg.zoom] + 200;
  const h = Math.round(w / aspect);
  return clampCrop(
    {
      x: Math.round(centre.x - w / 2),
      y: Math.round(centre.y - VERTICAL_BIAS * h - h / 2),
      w,
      h,
    },
    pano,
  );
}

/** Which panorama view a request resolves to (auto → follow; goal views need zones). */
export function resolvePanoView(
  view: FbView,
): 'follow' | 'wide' | 'left-goal' | 'right-goal' {
  switch (view) {
    case 'wide':
    case 'left-goal':
    case 'right-goal':
      return view;
    default:
      return 'follow';
  }
}

// ── three cameras ─────────────────────────────────────────────────────────

/** Thirds of the pitch (m) with a hysteresis band. */
const TRICAM_LEFT_X = 35;
const TRICAM_RIGHT_X = 70;
const TRICAM_BAND_M = 4;
/** Only one team is tagged: shift the cut points toward its attacking goal. */
const TRICAM_ATTACK_SHIFT_M = 5;
/** The centroid must sit past the band this long before a cut … */
export const TRICAM_SWITCH_MS = 1500;
/** … and the current camera stays at least this long. */
export const TRICAM_DWELL_MS = 4000;

export type TricamState = {
  cam: FbCamRole;
  since: number;
  /** Camera the centroid asks for and since when (null = same as `cam`). */
  candidate: { cam: FbCamRole; since: number } | null;
};

export function tricamCamForX(
  x: number,
  attacksLeft: boolean | null,
): FbCamRole {
  const shift =
    attacksLeft == null
      ? 0
      : attacksLeft
        ? -TRICAM_ATTACK_SHIFT_M
        : TRICAM_ATTACK_SHIFT_M;
  if (x < TRICAM_LEFT_X + shift) return 'left';
  if (x > TRICAM_RIGHT_X + shift) return 'right';
  return 'centre';
}

/**
 * Cut rule: the centroid's third, with a ±4 m band, 1.5 s past the band and
 * a 4 s minimum dwell. `available` limits the choice to attached cameras.
 */
export function stepTricam(
  prev: TricamState | null,
  centroidX: number | null,
  attacksLeft: boolean | null,
  now: number,
  available: FbCamRole[],
): TricamState {
  const fallback = available.includes('centre')
    ? 'centre'
    : (available[0] ?? 'centre');
  if (!prev) return { cam: fallback, since: now, candidate: null };
  if (centroidX == null) return prev;
  const shift =
    attacksLeft == null
      ? 0
      : attacksLeft
        ? -TRICAM_ATTACK_SHIFT_M
        : TRICAM_ATTACK_SHIFT_M;
  let want: FbCamRole = prev.cam;
  if (prev.cam === 'left') {
    if (centroidX > TRICAM_LEFT_X + shift + TRICAM_BAND_M)
      want = tricamCamForX(centroidX, attacksLeft);
  } else if (prev.cam === 'right') {
    if (centroidX < TRICAM_RIGHT_X + shift - TRICAM_BAND_M)
      want = tricamCamForX(centroidX, attacksLeft);
  } else if (
    centroidX < TRICAM_LEFT_X + shift - TRICAM_BAND_M ||
    centroidX > TRICAM_RIGHT_X + shift + TRICAM_BAND_M
  ) {
    want = tricamCamForX(centroidX, attacksLeft);
  }
  if (!available.includes(want)) want = prev.cam;
  if (want === prev.cam) return { ...prev, candidate: null };
  const candidate =
    prev.candidate?.cam === want ? prev.candidate : { cam: want, since: now };
  if (
    now - candidate.since >= TRICAM_SWITCH_MS &&
    now - prev.since >= TRICAM_DWELL_MS
  ) {
    return { cam: want, since: now, candidate: null };
  }
  return { ...prev, candidate };
}
