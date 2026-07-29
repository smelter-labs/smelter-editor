import React, { useEffect, useRef, useState } from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { CarHueBoxes } from '../app/store';
import { MotionPredictor } from './motionPredictor';

type CarHueWrapperProps = {
  /** The content to recolor (raw input or an already-wrapped variant). */
  children: React.ReactElement;
  data: CarHueBoxes;
  resolution: { width: number; height: number };
};

// Must match ShaderOptions box capacity in car-hue.wgsl.
const MAX_BOXES = 16;
// Smooth-motion tuning (matches PacmanGhostsInput).
const TICK_MS = 16;
const SMOOTH = 0.25; // exponential easing toward the latest detection per tick
const DEFAULT_HUE = 120;
const DEFAULT_SPREAD = 0;
const DEFAULT_STRENGTH = 1;
const DEFAULT_SAT_BOOST = 0.15;
const DEFAULT_WHITE_BOOST = 0.85;

// A box in tile space: center + half-extents, as the shader consumes it.
type Rect = { cx: number; cy: number; hw: number; hh: number };

/** Stable per-track offset in [-1, 1] (golden-ratio hash of the id). */
function idOffset(id: number): number {
  const t = (id * 0.6180339887) % 1;
  return t * 2 - 1;
}

/**
 * Wraps `children` in the `car-hue` WGSL shader, driving it with the tracked
 * top-down vehicle boxes so each car's pixels get a hue rotation (feathered
 * ellipse inside its box). Identity comes from the server-side tracker, so a
 * car keeps its assigned hue (base + per-id spread) across responses.
 *
 * Between AI responses each box is dead-reckoned: MotionPredictor extrapolates
 * it forward along its estimated velocity every tick (so the recolor keeps
 * pace with a moving car) and each new response corrects the estimate; the
 * per-tick easing then hides the correction jumps.
 */
export function CarHueWrapper({
  children,
  data,
  resolution,
}: CarHueWrapperProps) {
  const { width, height } = resolution;
  // Live track ids + per-track motion estimate + eased, currently-drawn rect.
  const idsRef = useRef<number[]>([]);
  const predictorRef = useRef(new MotionPredictor());
  const cursRef = useRef<Map<number, Rect>>(new Map());
  const [, setTick] = useState(0);

  // Map normalized detection boxes through the same rescale 'fill' (cover)
  // transform the video uses into tile space, keyed by stable track id.
  useEffect(() => {
    const { boxes, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;

    const now = Date.now();
    const live = new Set<number>();
    for (const b of boxes.slice(0, MAX_BOXES)) {
      live.add(b.id);
      predictorRef.current.update(
        b.id,
        [
          (offX + (b.x + b.w / 2) * dispW) / width,
          (offY + (b.y + b.h / 2) * dispH) / height,
          (b.w * dispW) / 2 / width,
          (b.h * dispH) / 2 / height,
        ],
        now,
      );
    }
    idsRef.current = [...live].sort((a, b) => a - b);
    predictorRef.current.prune(live);
    for (const id of [...cursRef.current.keys()]) {
      if (!live.has(id)) cursRef.current.delete(id);
    }
  }, [data, width, height]);

  // Every tick, ease each drawn rect toward its *predicted* position — the
  // target itself moves along the track's velocity between responses.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const curs = cursRef.current;
      for (const id of idsRef.current) {
        const p = predictorRef.current.predict(id, now);
        if (!p) continue;
        const [cx, cy, hw, hh] = p;
        const cur = curs.get(id);
        if (!cur) {
          // New car: recolor appears in place rather than sliding in.
          curs.set(id, { cx, cy, hw, hh });
        } else {
          cur.cx += (cx - cur.cx) * SMOOTH;
          cur.cy += (cy - cur.cy) * SMOOTH;
          cur.hw += (hw - cur.hw) * SMOOTH;
          cur.hh += (hh - cur.hh) * SMOOTH;
        }
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const hue = data.hue ?? DEFAULT_HUE;
  const spread = data.spread ?? DEFAULT_SPREAD;
  const strength = data.strength ?? DEFAULT_STRENGTH;
  const satBoost = data.satBoost ?? DEFAULT_SAT_BOOST;
  const whiteBoost = data.whiteBoost ?? DEFAULT_WHITE_BOOST;

  const ids = idsRef.current.slice(0, MAX_BOXES);

  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [
    { type: 'f32', fieldName: 'box_count', value: ids.length },
    { type: 'f32', fieldName: 'strength', value: strength },
    { type: 'f32', fieldName: 'sat_boost', value: satBoost },
    { type: 'f32', fieldName: 'white_boost', value: whiteBoost },
  ];
  for (let i = 0; i < MAX_BOXES; i++) {
    const id = i < ids.length ? ids[i] : undefined;
    // Fall back to the raw prediction until the easing state initializes.
    const fallback =
      id !== undefined
        ? predictorRef.current.predict(id, Date.now())
        : undefined;
    const rect =
      id !== undefined
        ? (cursRef.current.get(id) ??
          (fallback
            ? {
                cx: fallback[0],
                cy: fallback[1],
                hw: fallback[2],
                hh: fallback[3],
              }
            : undefined))
        : undefined;
    // Hue in turns (0..1); per-car spread is a stable function of the track id
    // so a car keeps its color for as long as it stays tracked.
    const hueTurns =
      id !== undefined ? ((hue + idOffset(id) * spread) / 360 + 1) % 1 : 0;
    params.push({ type: 'f32', fieldName: `b${i}_cx`, value: rect?.cx ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_cy`, value: rect?.cy ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_hw`, value: rect?.hw ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_hh`, value: rect?.hh ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_hue`, value: hueTurns });
  }

  return (
    <Shader
      shaderId='car-hue'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      {/* Shader children must have a known size — a sized View makes that
          hold for any content (e.g. the raw stream's auto-sized Rescaler). */}
      <View style={{ width, height }}>{children}</View>
    </Shader>
  );
}
