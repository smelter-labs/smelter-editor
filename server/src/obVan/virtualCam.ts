/**
 * The OB Van virtual camera: a digital pan / zoom window over one camera's
 * picture (a speaker on the wide shot, the ball on a sports feed). Same
 * spring as Touchline's follow window (`stepFollow` from the football
 * director), stepped at 10 Hz, each step laid out with a 250 ms linear tile
 * glide that the next step interrupts — so the window never arrives and
 * waits. The target point comes from the attention function (people boxes,
 * ball) each tick; without one the window rests on the frame centre.
 */
import type {
  FbDirectorConfig,
  ObAttentionTarget,
  ObZoom,
} from '@smelter-editor/types';
import {
  exactCropOf,
  stepFollow,
  type Crop,
  type FollowState,
} from '../football/director';
import type { ObBox } from './contracts';

/** Steps land every controller tick; the gate absorbs timer jitter. */
export const OB_VIRTUAL_TICK_MS = 90;
/** Each step's tile glide outlasts the tick (see the football director). */
export const OB_VIRTUAL_GLIDE_MS = 250;

/** Window width as a fraction of the camera's width. */
export const OB_ZOOM_FRACTION: Record<ObZoom, number> = {
  tight: 0.5,
  normal: 0.7,
  wide: 0.9,
};

/** Spring tuning in source pixels, derived from the camera's width. */
export function virtualSpringConfig(camWidth: number): FbDirectorConfig {
  return {
    zoom: 'normal',
    switchStyle: 'glide',
    lookaheadMs: 0,
    averageMs: 0,
    smoothTimeMs: 900,
    deadZonePx: 0,
    maxSpeedPxS: Math.max(200, Math.round(camWidth * 0.5)),
    catchUp: false,
  };
}

/** Window width for a zoom on a `cam`-sized picture at the output aspect. */
export function zoomWidth(
  zoom: ObZoom,
  cam: { width: number; height: number },
  aspect: number,
): number {
  const w = cam.width * OB_ZOOM_FRACTION[zoom];
  // The window is output-shaped: never taller than the picture.
  return Math.min(w, cam.height * aspect);
}

/**
 * Where the window should centre for an attention box (normalised 0..1):
 * the box centre, lifted towards the head for people targets.
 */
export function targetPoint(
  box: ObBox | null,
  cam: { width: number; height: number },
  target: ObAttentionTarget,
): { x: number; y: number } {
  if (!box) return { x: cam.width / 2, y: cam.height / 2 };
  const person = target === 'speaker' || target === 'largest';
  return {
    x: (box.x + box.w / 2) * cam.width,
    y: (box.y + box.h * (person ? 0.35 : 0.5)) * cam.height,
  };
}

/** Follow state of one virtual shot (reset when the shot's camera changes). */
export class ObVirtualCam {
  private camId: string | null = null;
  private follow: FollowState | null = null;
  private lastStepAt = 0;
  private crop: Crop | null = null;

  /** The current window (source px), or null before the first step. */
  current(camId: string): Crop | null {
    return this.camId === camId ? this.crop : null;
  }

  reset(): void {
    this.camId = null;
    this.follow = null;
    this.crop = null;
    this.lastStepAt = 0;
  }

  /**
   * One spring step towards `box` (null → frame centre). `force` steps even
   * inside the tick gate (a fresh shot). Returns the new window, or null when
   * the gate skipped the step.
   */
  step(input: {
    camId: string;
    cam: { width: number; height: number };
    aspect: number;
    zoom: ObZoom;
    target: ObAttentionTarget;
    box: ObBox | null;
    now: number;
    force?: boolean;
  }): Crop | null {
    const { camId, cam, aspect, now } = input;
    if (this.camId !== camId) {
      this.reset();
      this.camId = camId;
    }
    if (
      !input.force &&
      this.follow &&
      now - this.lastStepAt < OB_VIRTUAL_TICK_MS
    )
      return null;
    const dt = this.follow && this.lastStepAt ? now - this.lastStepAt : 0;
    this.lastStepAt = now;
    const pano = { w: cam.width, h: cam.height };
    const point = targetPoint(input.box, cam, input.target);
    const width = zoomWidth(input.zoom, cam, aspect);
    this.follow = stepFollow(
      this.follow,
      {
        target: point,
        speedPxS: 0,
        dtMs: dt,
        auto: false,
        lostForMs: 0,
        fixedWidth: width,
      },
      virtualSpringConfig(cam.width),
      pano,
      aspect,
      null,
    );
    this.crop = exactCropOf(this.follow, aspect, pano);
    return this.crop;
  }
}
