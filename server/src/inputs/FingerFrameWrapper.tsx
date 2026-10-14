import React, { useEffect, useRef, useState } from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { FingerFrameData } from '../app/store';

type FingerFrameWrapperProps = {
  /** The content to restyle (raw input or an already-wrapped variant). */
  children: React.ReactElement;
  data: FingerFrameData;
  resolution: { width: number; height: number };
};

// Smooth-motion tuning (matches CarHueWrapper).
const TICK_MS = 16;
const SMOOTH = 0.3; // exponential easing toward the latest detection per tick
const FADE_IN_PER_TICK = 0.12; // ~150 ms from mount to full strength

// A quad in tile space: four corners, cycle order as the shader draws it.
type Pt = [number, number];
type Quad = [Pt, Pt, Pt, Pt];

// Every re-indexing of a cyclic quad that keeps the same drawn polygon
// (rotations + reversals). A fresh detection is matched onto the currently
// drawn corners through these, so a MediaPipe hand-order swap (a rotation
// of the cycle by two) never animates as a 180° corner swirl.
const CYCLES: number[][] = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
  [3, 2, 1, 0],
  [2, 1, 0, 3],
  [1, 0, 3, 2],
  [0, 3, 2, 1],
];

function matchOrder(target: Quad, cur: Quad): Quad {
  let best = target;
  let bestD = Infinity;
  for (const idx of CYCLES) {
    let d = 0;
    for (let i = 0; i < 4; i++) {
      const p = target[idx[i]];
      d += (p[0] - cur[i][0]) ** 2 + (p[1] - cur[i][1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = idx.map((j) => target[j]) as Quad;
    }
  }
  return best;
}

/**
 * Wraps `children` in the `finger-frame` WGSL shader: an effect inside the
 * quad whose corners are both hands' thumb + index fingertips (twisted
 * fingers self-intersect it into an hourglass — drawn as such, even-odd).
 * Detections arrive at ≤12 Hz (already held to the output clock by
 * RoomState), so each drawn corner is eased every tick toward the latest
 * one — the frame glides with the fingertips instead of stepping — and the
 * effect fades in on mount.
 */
export function FingerFrameWrapper({
  children,
  data,
  resolution,
}: FingerFrameWrapperProps) {
  const { width, height } = resolution;
  const targetRef = useRef<Quad | null>(null);
  const curRef = useRef<Quad | null>(null);
  const strengthRef = useRef(0);
  const [, setTick] = useState(0);

  // Map the frame-normalized corners through the same rescale 'fill'
  // (cover) transform the video uses into tile space.
  useEffect(() => {
    const { quad, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;
    const mapped = quad.map(([x, y]) => [
      (offX + x * dispW) / width,
      (offY + y * dispH) / height,
    ]) as Quad;
    targetRef.current = curRef.current
      ? matchOrder(mapped, curRef.current)
      : mapped;
  }, [data, width, height]);

  // Every tick, ease the drawn corners toward the latest detection and fade
  // the effect in. The first detection appears in place rather than sliding.
  useEffect(() => {
    const timer = setInterval(() => {
      const target = targetRef.current;
      if (!target) return;
      const cur = curRef.current;
      if (!cur) {
        curRef.current = target.map((p) => [...p]) as Quad;
      } else {
        for (let i = 0; i < 4; i++) {
          cur[i][0] += (target[i][0] - cur[i][0]) * SMOOTH;
          cur[i][1] += (target[i][1] - cur[i][1]) * SMOOTH;
        }
      }
      strengthRef.current = Math.min(1, strengthRef.current + FADE_IN_PER_TICK);
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const quad = curRef.current ?? targetRef.current;
  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [];
  for (let i = 0; i < 4; i++) {
    params.push(
      { type: 'f32', fieldName: `p${i}x`, value: quad?.[i][0] ?? 0 },
      { type: 'f32', fieldName: `p${i}y`, value: quad?.[i][1] ?? 0 },
    );
  }
  params.push(
    {
      type: 'f32',
      fieldName: 'strength',
      value: quad ? strengthRef.current : 0,
    },
    // The look inside the frame (FINGER_FRAME_MODES index, cycled by the
    // pinch sign) — switched hard, never eased.
    { type: 'f32', fieldName: 'mode', value: data.mode },
  );

  return (
    <Shader
      shaderId='finger-frame'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      {/* Shader children must have a known size — a sized View makes that
          hold for any content (e.g. the raw stream's auto-sized Rescaler). */}
      <View style={{ width, height }}>{children}</View>
    </Shader>
  );
}
