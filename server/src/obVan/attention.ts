/**
 * OB Van — where a virtual camera (digital pan / zoom of a wide camera)
 * should look. Returns a normalised box (0..1 of the source frame) the
 * controller's follow spring frames, or null when the target is not visible
 * (the controller then holds its last framing).
 */
import type { ObAttentionFn, ObBox, ObSignalState } from './contracts';

/** Framing box around the ball (the worker reports its centre). */
const BALL_BOX = 0.04;
/** Below this motion the scene is still — nothing to follow. */
const MOTION_ATTENTION_MIN = 0.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function plain(b: ObBox): ObBox {
  return b.conf === undefined
    ? { x: b.x, y: b.y, w: b.w, h: b.h }
    : { x: b.x, y: b.y, w: b.w, h: b.h, conf: b.conf };
}

/** The box enclosing every tracked person. */
function union(boxes: ObBox[]): ObBox | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function ballBox(ball: NonNullable<ObSignalState['ball']>): ObBox {
  const half = BALL_BOX / 2;
  return {
    x: clamp01(ball.x - half),
    y: clamp01(ball.y - half),
    w: BALL_BOX,
    h: BALL_BOX,
    conf: ball.conf,
  };
}

/**
 * - `speaker`  the largest person while the camera hears speech
 * - `largest`  the largest person
 * - `ball`     the ball (while it is not lost)
 * - `centroid` everyone on the picture
 * - `motion`   everyone on the picture while there is motion (the worker
 *              does not localise motion; people are where it happens)
 */
export const attentionFor: ObAttentionFn = (state, target) => {
  if (!state || state.staleVideo || state.offline) return null;
  const largest = state.people.largest ? plain(state.people.largest) : null;
  switch (target) {
    case 'speaker':
      return !state.staleAudio && state.speech ? largest : null;
    case 'largest':
      return largest;
    case 'ball':
      return state.ball ? ballBox(state.ball) : null;
    case 'centroid':
      return union(state.people.tracks);
    case 'motion':
      return state.motionEma >= MOTION_ATTENTION_MIN
        ? union(state.people.tracks)
        : null;
  }
};
