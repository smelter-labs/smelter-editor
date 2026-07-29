import React, { useEffect, useRef, useState } from 'react';
import { Shader } from '@swmansion/smelter';
import type { BuildingBoxes } from '../app/store';

type GhostCityWrapperProps = {
  /** The content to haunt (raw input, or already ghost-swapped people). */
  children: React.ReactElement;
  data: BuildingBoxes;
  resolution: { width: number; height: number };
};

// Must match ShaderOptions box capacity in haunted-city.wgsl.
const MAX_BOXES = 16;
// Haunt intensities passed to the shader.
const FOG = 0.7;
const DESAT = 0.85;
const GLOW = 0.95;
const FLICKER_SPEED = 3.0;
// Smooth-motion tuning (buildings are static, but detection jitters a little).
const TICK_MS = 33; // ~30fps is plenty for a slow, static haunt
const SMOOTH = 0.25; // exponential easing toward the latest detection per tick
// Max center distance (tile space) to treat two boxes as the same building.
const MATCH_DIST = 0.15;

// A box in tile space (0..1): top-left + size, eased toward its detection.
type Box = { x: number; y: number; w: number; h: number };
type Tracked = { cur: Box; tgt: Box };

function center(b: Box): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

function dist(a: Box, b: Box): number {
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Wraps `children` in the `haunted-city` WGSL shader, driving it with the
 * detected building boxes so only those regions get the ghost-town treatment
 * (mist + desaturation, spectral edge glow, glowing windows). Building boxes
 * carry no tracked identity, so we greedily match each new detection to the
 * nearest currently-rendered box and ease toward it (new boxes appear in place,
 * lost ones disappear) — enough to hide detection jitter without morphing.
 */
export function GhostCityWrapper({
  children,
  data,
  resolution,
}: GhostCityWrapperProps) {
  const { width, height } = resolution;
  const boxesRef = useRef<Tracked[]>([]);
  const [, setTick] = useState(0);

  // Map normalized detection boxes through the same rescale 'fill' (cover)
  // transform the video uses into tile space, then match them to the currently
  // rendered boxes so eased boxes track the nearest building across responses.
  useEffect(() => {
    const { boxes, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;

    const targets: Box[] = boxes.slice(0, MAX_BOXES).map((b) => ({
      x: (offX + b.x * dispW) / width,
      y: (offY + b.y * dispH) / height,
      w: (b.w * dispW) / width,
      h: (b.h * dispH) / height,
    }));

    const prev = boxesRef.current;
    const usedPrev = new Set<number>();
    const next: Tracked[] = [];
    for (const tgt of targets) {
      // Nearest still-unused previous box within the match radius.
      let best = -1;
      let bestD = MATCH_DIST;
      for (let i = 0; i < prev.length; i++) {
        if (usedPrev.has(i)) continue;
        const d = dist(prev[i].cur, tgt);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        usedPrev.add(best);
        next.push({ cur: prev[best].cur, tgt });
      } else {
        // New building: appear in place rather than sliding in from elsewhere.
        next.push({ cur: { ...tgt }, tgt });
      }
    }
    boxesRef.current = next;
  }, [data, width, height]);

  // Ease rendered boxes toward their targets for a calm, non-jittery haunt.
  useEffect(() => {
    const timer = setInterval(() => {
      for (const b of boxesRef.current) {
        b.cur.x += (b.tgt.x - b.cur.x) * SMOOTH;
        b.cur.y += (b.tgt.y - b.cur.y) * SMOOTH;
        b.cur.w += (b.tgt.w - b.cur.w) * SMOOTH;
        b.cur.h += (b.tgt.h - b.cur.h) * SMOOTH;
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const boxes = boxesRef.current.slice(0, MAX_BOXES);
  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [
    { type: 'f32', fieldName: 'box_count', value: boxes.length },
    { type: 'f32', fieldName: 'fog', value: FOG },
    { type: 'f32', fieldName: 'desat', value: DESAT },
    { type: 'f32', fieldName: 'glow', value: GLOW },
    { type: 'f32', fieldName: 'flicker_speed', value: FLICKER_SPEED },
  ];
  for (let i = 0; i < MAX_BOXES; i++) {
    const b = i < boxes.length ? boxes[i].cur : undefined;
    params.push({ type: 'f32', fieldName: `b${i}_x`, value: b?.x ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_y`, value: b?.y ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_w`, value: b?.w ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_h`, value: b?.h ?? 0 });
  }

  return (
    <Shader
      shaderId='haunted-city'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      {children}
    </Shader>
  );
}
