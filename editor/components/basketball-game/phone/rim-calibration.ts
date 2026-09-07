/**
 * Pure math for the hoop phone's rim calibrator: an ellipse in normalized
 * video coordinates (0..1 × 0..1), dragged by its centre or by two handles
 * (right = rx, bottom = ry). Kept DOM-free so it is unit-testable.
 */

export type Rim = { cx: number; cy: number; rx: number; ry: number };
export type RimHandle = 'center' | 'rx' | 'ry';

export const RIM_MIN_RX = 0.01;
export const RIM_MAX_RX = 0.45;
export const RIM_MIN_RY = 0.005;
export const RIM_MAX_RY = 0.3;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A sensible first guess: upper-middle of the frame, a typical hoop size
 * for a phone 5–8 m from the rim. */
export function defaultRim(): Rim {
  return { cx: 0.5, cy: 0.35, rx: 0.06, ry: 0.02 };
}

export function clampRim(rim: Rim): Rim {
  return {
    cx: clamp(rim.cx, 0, 1),
    cy: clamp(rim.cy, 0, 1),
    rx: clamp(rim.rx, RIM_MIN_RX, RIM_MAX_RX),
    ry: clamp(rim.ry, RIM_MIN_RY, RIM_MAX_RY),
  };
}

/** Handle positions in normalized video space. */
export function rimHandles(
  rim: Rim,
): Record<RimHandle, { x: number; y: number }> {
  return {
    center: { x: rim.cx, y: rim.cy },
    rx: { x: rim.cx + rim.rx, y: rim.cy },
    ry: { x: rim.cx, y: rim.cy + rim.ry },
  };
}

/**
 * Which handle a touch at normalized (x, y) grabs. `aspect` (video w/h)
 * makes the hit radius circular on screen; `radius` is in y units.
 */
export function hitTest(
  rim: Rim,
  x: number,
  y: number,
  aspect: number,
  radius = 0.05,
): RimHandle | null {
  const handles = rimHandles(rim);
  const dist = (p: { x: number; y: number }) =>
    Math.hypot((x - p.x) * aspect, y - p.y);
  // Handles first (they sit on the ellipse), then the whole ellipse body as
  // the centre grab so the user can drag from anywhere inside it.
  const order: RimHandle[] = ['rx', 'ry', 'center'];
  let best: RimHandle | null = null;
  let bestD = radius;
  for (const h of order) {
    const d = dist(handles[h]);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  if (best) return best;
  const inside =
    ((x - rim.cx) / rim.rx) ** 2 + ((y - rim.cy) / rim.ry) ** 2 <= 1.6;
  return inside ? 'center' : null;
}

/** Apply a drag of `handle` to normalized (x, y). */
export function moveHandle(
  rim: Rim,
  handle: RimHandle,
  x: number,
  y: number,
): Rim {
  switch (handle) {
    case 'center':
      return clampRim({ ...rim, cx: x, cy: y });
    case 'rx':
      return clampRim({ ...rim, rx: Math.abs(x - rim.cx) });
    case 'ry':
      return clampRim({ ...rim, ry: Math.abs(y - rim.cy) });
  }
}

/** Nudge by a fraction of the frame (keyboard / buttons). */
export function nudgeRim(rim: Rim, dx: number, dy: number): Rim {
  return clampRim({ ...rim, cx: rim.cx + dx, cy: rim.cy + dy });
}

export function scaleRim(rim: Rim, factor: number): Rim {
  return clampRim({ ...rim, rx: rim.rx * factor, ry: rim.ry * factor });
}

/**
 * Map a client point on an element that shows the video with
 * `object-fit: contain` to normalized video coords; null in the letterbox.
 */
export function clientToNorm(
  rect: { left: number; top: number; width: number; height: number },
  videoW: number,
  videoH: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!videoW || !videoH || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / videoW, rect.height / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = rect.left + (rect.width - dw) / 2;
  const oy = rect.top + (rect.height - dh) / 2;
  const x = (clientX - ox) / dw;
  const y = (clientY - oy) / dh;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** Inverse of clientToNorm for drawing: normalized → element-local px. */
export function normToLocal(
  rect: { width: number; height: number },
  videoW: number,
  videoH: number,
  x: number,
  y: number,
): { x: number; y: number; scale: number } {
  const scale = Math.min(rect.width / videoW, rect.height / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (rect.width - dw) / 2;
  const oy = (rect.height - dh) / 2;
  return { x: ox + x * dw, y: oy + y * dh, scale };
}
