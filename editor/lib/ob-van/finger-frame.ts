// In-browser finger-frame geometry — a 1:1 port of the pure functions in
// server/src/ai-models/ob-van/analysis.py (detect_finger_frame /
// detect_frame_switch and the worker's miss-hysteresis + pinch gate), so the
// phone computes the same quads the Python worker would. Landmarks are
// MediaPipe hand landmarks: 21 normalised (x, y) points per hand.

export type Landmark = [number, number];
export type Hand = Landmark[];
export type Quad = [number, number][];

const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
// (pip, tip) per finger: index, middle, ring, pinky.
const FINGERS: [number, number][] = [
  [6, 8],
  [10, 12],
  [14, 16],
  [18, 20],
];
// A finger is extended when its tip is this much farther from the wrist
// than its PIP joint (scale-free, works at any hand size).
const EXTENDED_RATIO = 1.25;

// The classic director's "finger frame": both hands in an L shape (thumb
// and index extended, the rest curled); the frame is the QUAD whose corners
// are the four fingertips, in the fixed cycle thumb-A → index-A → thumb-B →
// index-B (twisted fingers self-intersect into an hourglass, by design).
export const FINGER_FRAME_MIN_SIZE = 0.03;
// Pose hysteresis: ACQUIRING the frame demands the proper two-handed L
// (softer than the gesture classifier even so — a webcam foreshortens the
// index and the thumb sits mid-way), but KEEPING it accepts far more
// wobble: per-frame ratio dips and stray "extended" reads were dropping a
// held frame every few hundred ms. A held frame only lets go when the pose
// is clearly gone (fingers curled in / a hand lost) for a while.
const FRAME_INDEX_RATIO = 1.12;
const FRAME_THUMB_RATIO = 1.04;
const FRAME_HOLD_INDEX_RATIO = 1.02;
const FRAME_HOLD_THUMB_RATIO = 0.96;
// The pinch sign: all four framing tips in one cluster, sized relative to
// the index fingers so it works at any distance from the camera.
const FRAME_SWITCH_SPREAD = 0.45;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** tip-to-wrist over joint-to-wrist distance — >1 when the segment past
 * `joint` points away from the palm. */
function wristRatio(hand: Hand, joint: number, tip: number): number {
  const base = dist(hand[joint], hand[WRIST]);
  return base > 1e-6 ? dist(hand[tip], hand[WRIST]) / base : 0;
}

function extendedFingers(hand: Hand): boolean[] {
  return FINGERS.map(
    ([pip, tip]) =>
      dist(hand[tip], hand[WRIST]) >
      EXTENDED_RATIO * dist(hand[pip], hand[WRIST]),
  );
}

/** Thumb + index fingertips of both hands when each holds the L pose
 * (thumb + index extended, the rest curled), else null. */
function frameHandTips(
  hands: Hand[] | null | undefined,
  held = false,
): Landmark[] | null {
  if (!hands || hands.length < 2) return null;
  const indexRatio = held ? FRAME_HOLD_INDEX_RATIO : FRAME_INDEX_RATIO;
  const thumbRatio = held ? FRAME_HOLD_THUMB_RATIO : FRAME_THUMB_RATIO;
  const tips: Landmark[] = [];
  for (const hand of hands.slice(0, 2)) {
    if (!hand || hand.length < 21) return null;
    if (wristRatio(hand, FINGERS[0][0], FINGERS[0][1]) < indexRatio)
      return null;
    if (wristRatio(hand, THUMB_IP, THUMB_TIP) < thumbRatio) return null;
    if (!held) {
      const stray = extendedFingers(hand).slice(1).filter(Boolean).length;
      if (stray > 1) return null;
    }
    tips.push(hand[THUMB_TIP], hand[FINGERS[0][1]]);
  }
  return tips;
}

/**
 * The quad framed by both hands' fingertips — four [x, y] corners
 * (normalised 0..1) in the fixed cycle thumb-A → index-A → thumb-B →
 * index-B — or null when the two-handed L pose is not there. The cycle is
 * tied to finger identity, not sorted: twisted fingers self-intersect into
 * an hourglass, and a MediaPipe hand-order swap only rotates the cycle by
 * two (the same polygon).
 */
export function detectFingerFrame(
  hands: Hand[] | null | undefined,
  held = false,
): Quad | null {
  const tips = frameHandTips(hands, held);
  if (!tips) return null;
  const xs = tips.map((t) => t[0]);
  const ys = tips.map((t) => t[1]);
  if (
    Math.max(...xs) - Math.min(...xs) < FINGER_FRAME_MIN_SIZE ||
    Math.max(...ys) - Math.min(...ys) < FINGER_FRAME_MIN_SIZE
  )
    return null;
  return tips.map((t) => [t[0], t[1]]);
}

/** True when both hands hold the L pose with all four framing fingertips
 * gathered in one cluster (the shader-switch sign). */
export function detectFrameSwitch(hands: Hand[] | null | undefined): boolean {
  const tips = frameHandTips(hands);
  if (!tips || !hands) return false;
  const xs = tips.map((t) => t[0]);
  const ys = tips.map((t) => t[1]);
  const spread = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const two = hands.slice(0, 2);
  const indexLen =
    two.reduce(
      (sum, hand) => sum + dist(hand[FINGERS[0][1]], hand[INDEX_MCP]),
      0,
    ) / 2;
  return spread < FRAME_SWITCH_SPREAD * indexLen;
}

// Worker-loop semantics around the raw detectors: the quad streams while
// present (under the loose hold gates once acquired), one `null` after a
// stretch of missed passes — a lost hand or a pose dip must not blink the
// effect off — and the pinch sign is gated — held briefly to fire once,
// then a cooldown — with priority over the frame, so the overlap zone (a
// tiny but legal quad) never double-fires.
const FRAME_MISS_LIMIT = 12; // ~600 ms at the 20 Hz detection clock
const SWITCH_HOLD_MS = 250;
const SWITCH_COOLDOWN_MS = 1500;

export type FrameTrackerResult = {
  /** A message to send: the quad, or null for the one-shot release. */
  send?: { quad: Quad | null };
  /** The pinch sign fired (send the switch message). */
  switch: boolean;
  /** What the preview overlay should draw right now. */
  quad: Quad | null;
};

export class FrameTracker {
  private sent = false;
  private miss = 0;
  private lastQuad: Quad | null = null;
  private pinchSince: number | null = null;
  private pinchFired = false;
  private lastFireAt = -Infinity;

  /** One detection pass: `hands` from the landmarker, `tMs` a monotonic clock. */
  update(hands: Hand[] | null | undefined, tMs: number): FrameTrackerResult {
    let quad: Quad | null = null;
    let fired = false;
    if (detectFrameSwitch(hands)) {
      if (this.pinchSince == null) this.pinchSince = tMs;
      if (
        !this.pinchFired &&
        tMs - this.pinchSince >= SWITCH_HOLD_MS &&
        tMs - this.lastFireAt >= SWITCH_COOLDOWN_MS
      ) {
        this.pinchFired = true;
        this.lastFireAt = tMs;
        fired = true;
      }
    } else {
      this.pinchSince = null;
      this.pinchFired = false;
      // Acquire strict, keep loose (`this.sent` = a frame is on screen).
      quad = detectFingerFrame(hands, this.sent);
    }

    let send: { quad: Quad | null } | undefined;
    if (quad) {
      this.sent = true;
      this.miss = 0;
      this.lastQuad = quad;
      send = { quad };
    } else if (this.sent) {
      this.miss++;
      if (this.miss >= FRAME_MISS_LIMIT) {
        this.sent = false;
        this.miss = 0;
        this.lastQuad = null;
        send = { quad: null };
      }
    }
    // The preview keeps the last quad through the miss grace — the server
    // does the same (it shows the last send until the release lands).
    return { send, switch: fired, quad: quad ?? this.lastQuad };
  }

  /** Detection stopped (toggle off / camera gone): one release if needed. */
  reset(): { quad: null } | undefined {
    const wasSent = this.sent;
    this.sent = false;
    this.miss = 0;
    this.lastQuad = null;
    this.pinchSince = null;
    this.pinchFired = false;
    return wasSent ? { quad: null } : undefined;
  }
}
