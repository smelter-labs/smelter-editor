import React, { useEffect, useRef, useState } from 'react';
import { Shader, InputStream, Rescaler } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';

type PacmanBirdsInputProps = {
  sourceInputId: string;
  data: PersonBoxes;
  resolution: { width: number; height: number };
  volume: number;
  /** Bird ids currently shot down (Ghost Shooter) — play a vanish animation. */
  deadIds?: number[];
};

// Must match the box capacity of birds.wgsl.
const MAX_BIRDS = 16;
const BG_DIM = 0.55;
const BG_DESAT = 0.7;
// Smooth-motion tuning.
const TICK_MS = 16; // ~60fps render cadence
const SMOOTH = 0.2; // exponential easing toward the latest detection per tick
// A bird always keeps this on-screen aspect (height / width) — wider than tall —
// instead of stretching to the detection's bounding box.
const BIRD_ASPECT = 0.62;
// Scale the fitted bird up so it reads clearly over the (often small) detection.
const BIRD_SCALE = 2.6;
// Shot-down (Ghost Shooter) vanish animation targets, eased like normal motion.
const DEATH_SHRINK = 0.02; // shrink to ~nothing
const DEATH_DROP = 0.12; // and drop it slightly while it vanishes

type Rect = { cx: number; cy: number; hw: number; hh: number };

/**
 * Replaces YOLO-detected birds with animated flapping-bird sprites via the
 * `birds` WGSL shader. Mirrors PacmanGhostsInput: identity/color/dropout
 * persistence come from PeopleTracker (each box has a stable `id`/`color`), and
 * here we only ease each sprite's rendered position toward its latest detection
 * so it glides between responses. The bird is shown only while it's detected
 * (plus the tracker's miss grace); there is no autonomous free-flight phase.
 */
export function PacmanBirdsInput({
  sourceInputId,
  data,
  resolution,
  volume,
  deadIds,
}: PacmanBirdsInputProps) {
  const { width, height } = resolution;
  const targetsRef = useRef<Map<number, Rect & { color: number }>>(new Map());
  const cursRef = useRef<Map<number, Rect>>(new Map());
  const prevDeadRef = useRef<Set<number>>(new Set());
  const [, setFrame] = useState(0);

  // Map normalized detection boxes through the same rescale 'fill' (cover)
  // transform the video uses into tile-space.
  useEffect(() => {
    const { boxes, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;

    const deadSet = new Set(deadIds ?? []);
    for (const id of prevDeadRef.current) {
      if (!deadSet.has(id)) cursRef.current.delete(id);
    }
    prevDeadRef.current = deadSet;

    const next = new Map<number, Rect & { color: number }>();
    for (const b of boxes.slice(0, MAX_BIRDS)) {
      // Fixed-aspect bird fitted inside the detection box (contain), then scaled
      // up. Work in tile pixels because X and Y are normalized separately.
      const boxWpx = b.w * dispW;
      const boxHpx = b.h * dispH;
      let birdWpx = boxWpx;
      let birdHpx = birdWpx * BIRD_ASPECT;
      if (birdHpx > boxHpx) {
        birdHpx = boxHpx;
        birdWpx = birdHpx / BIRD_ASPECT;
      }
      birdWpx *= BIRD_SCALE;
      birdHpx *= BIRD_SCALE;
      const cx = (offX + (b.x + b.w / 2) * dispW) / width;
      const cy = (offY + (b.y + b.h / 2) * dispH) / height;
      const hw = birdWpx / 2 / width;
      const hh = birdHpx / 2 / height;
      const dead = deadSet.has(b.id);
      next.set(b.id, {
        cx,
        cy: dead ? cy + DEATH_DROP : cy,
        hw: dead ? hw * DEATH_SHRINK : hw,
        hh: dead ? hh * DEATH_SHRINK : hh,
        color: b.color,
      });
    }
    targetsRef.current = next;

    for (const id of [...cursRef.current.keys()]) {
      if (!next.has(id)) cursRef.current.delete(id);
    }
  }, [data, width, height, deadIds]);

  // Ease rendered positions toward their targets for smooth, continuous motion.
  useEffect(() => {
    const timer = setInterval(() => {
      const curs = cursRef.current;
      for (const [id, tgt] of targetsRef.current) {
        const cur = curs.get(id);
        if (!cur) {
          curs.set(id, { cx: tgt.cx, cy: tgt.cy, hw: tgt.hw, hh: tgt.hh });
        } else {
          cur.cx += (tgt.cx - cur.cx) * SMOOTH;
          cur.cy += (tgt.cy - cur.cy) * SMOOTH;
          cur.hw += (tgt.hw - cur.hw) * SMOOTH;
          cur.hh += (tgt.hh - cur.hh) * SMOOTH;
        }
      }
      setFrame((f) => (f + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const ids = [...targetsRef.current.keys()]
    .sort((a, b) => a - b)
    .slice(0, MAX_BIRDS);

  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [];
  params.push({ type: 'f32', fieldName: 'box_count', value: ids.length });
  params.push({ type: 'f32', fieldName: 'bg_dim', value: BG_DIM });
  params.push({ type: 'f32', fieldName: 'bg_desat', value: BG_DESAT });

  for (let i = 0; i < MAX_BIRDS; i++) {
    const id = i < ids.length ? ids[i] : undefined;
    const tgt = id !== undefined ? targetsRef.current.get(id) : undefined;
    const cur = id !== undefined ? cursRef.current.get(id) : undefined;
    const rect = cur ?? tgt;
    params.push({ type: 'f32', fieldName: `b${i}_cx`, value: rect?.cx ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_cy`, value: rect?.cy ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_hw`, value: rect?.hw ?? 0 });
    params.push({ type: 'f32', fieldName: `b${i}_hh`, value: rect?.hh ?? 0 });
    params.push({
      type: 'f32',
      fieldName: `b${i}_color`,
      value: tgt?.color ?? 0,
    });
  }

  return (
    <Shader
      shaderId='birds'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      <Rescaler style={{ ...resolution, rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
    </Shader>
  );
}
