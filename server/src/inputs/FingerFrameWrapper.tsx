import React, { useEffect, useRef, useState } from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { FingerFrameData } from '../app/store';

type FingerFrameWrapperProps = {
  /** The content to desaturate (raw input or an already-wrapped variant). */
  children: React.ReactElement;
  data: FingerFrameData;
  resolution: { width: number; height: number };
};

// Smooth-motion tuning (matches CarHueWrapper).
const TICK_MS = 16;
const SMOOTH = 0.3; // exponential easing toward the latest detection per tick
const FADE_IN_PER_TICK = 0.12; // ~150 ms from mount to full strength
// The drawn viewfinder line anchors the rect edge now, so the grayscale can
// run almost out to it — jitter is already absorbed by the easing above.
const FEATHER = 0.08;

// A rect in tile space: center + half-extents, as the shader consumes it.
type Rect = { cx: number; cy: number; hw: number; hh: number };

/**
 * Wraps `children` in the `finger-frame` WGSL shader: grayscale inside the
 * rect framed by both hands' thumbs + index fingertips. Detections arrive at
 * ≤12 Hz (already held to the output clock by RoomState), so the drawn rect
 * is eased every tick toward the latest one — the frame glides with the
 * fingertips instead of stepping — and the effect fades in on mount.
 */
export function FingerFrameWrapper({
  children,
  data,
  resolution,
}: FingerFrameWrapperProps) {
  const { width, height } = resolution;
  const targetRef = useRef<Rect | null>(null);
  const curRef = useRef<Rect | null>(null);
  const strengthRef = useRef(0);
  const [, setTick] = useState(0);

  // Map the frame-normalized rect through the same rescale 'fill' (cover)
  // transform the video uses into tile space.
  useEffect(() => {
    const { rect, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;
    targetRef.current = {
      cx: (offX + (rect.x + rect.w / 2) * dispW) / width,
      cy: (offY + (rect.y + rect.h / 2) * dispH) / height,
      hw: (rect.w * dispW) / 2 / width,
      hh: (rect.h * dispH) / 2 / height,
    };
  }, [data, width, height]);

  // Every tick, ease the drawn rect toward the latest detection and fade the
  // effect in. The first detection appears in place rather than sliding in.
  useEffect(() => {
    const timer = setInterval(() => {
      const target = targetRef.current;
      if (!target) return;
      const cur = curRef.current;
      if (!cur) {
        curRef.current = { ...target };
      } else {
        cur.cx += (target.cx - cur.cx) * SMOOTH;
        cur.cy += (target.cy - cur.cy) * SMOOTH;
        cur.hw += (target.hw - cur.hw) * SMOOTH;
        cur.hh += (target.hh - cur.hh) * SMOOTH;
      }
      strengthRef.current = Math.min(1, strengthRef.current + FADE_IN_PER_TICK);
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const rect = curRef.current ?? targetRef.current;
  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [
    { type: 'f32', fieldName: 'rect_cx', value: rect?.cx ?? 0 },
    { type: 'f32', fieldName: 'rect_cy', value: rect?.cy ?? 0 },
    { type: 'f32', fieldName: 'rect_hw', value: rect?.hw ?? 0 },
    { type: 'f32', fieldName: 'rect_hh', value: rect?.hh ?? 0 },
    { type: 'f32', fieldName: 'feather', value: FEATHER },
    {
      type: 'f32',
      fieldName: 'strength',
      value: rect ? strengthRef.current : 0,
    },
    // The look inside the frame (FINGER_FRAME_MODES index, cycled by the
    // pinch sign) — switched hard, never eased.
    { type: 'f32', fieldName: 'mode', value: data.mode },
  ];

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
