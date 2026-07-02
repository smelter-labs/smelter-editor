import React, { useEffect, useRef, useState } from 'react';
import { Shader, InputStream, Rescaler } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';

type PacmanGhostsInputProps = {
  sourceInputId: string;
  data: PersonBoxes;
  resolution: { width: number; height: number };
  volume: number;
  /** Ghost ids currently shot down (Ghost Shooter) — play a vanish animation. */
  deadIds?: number[];
};

// Must match the box capacity of pacman-ghosts.wgsl.
const MAX_GHOSTS = 16;
const BG_DIM = 0.55;
const BG_DESAT = 0.7;
// Smooth-motion tuning.
const TICK_MS = 16; // ~60fps render cadence (matches ScrollingText)
const SMOOTH = 0.2; // exponential easing toward the latest detection per tick
// A ghost always keeps this on-screen aspect (height / width) instead of being
// stretched to the person's tall bounding box.
const GHOST_ASPECT = 1.1;
// Scale the fitted ghost up so it reads bigger than the bare person box.
const GHOST_SCALE = 2.75;
// Shot-down (Ghost Shooter) vanish animation targets, eased like normal motion.
const DEATH_SHRINK = 0.02; // shrink ghost to ~nothing
const DEATH_DROP = 0.12; // and drop it slightly while it vanishes

type Rect = { cx: number; cy: number; hw: number; hh: number };

/**
 * Replaces YOLO-detected people with animated Pac-Man ghosts via the
 * `pacman-ghosts` WGSL shader.
 *
 * Identity, color and dropout-persistence are handled server-side by
 * PeopleTracker — each box arrives with a stable `id`/`color`. Here we only
 * ease each ghost's rendered position toward its latest detection every tick
 * (keyed by id) so it glides instead of teleporting between responses.
 */
export function PacmanGhostsInput({
  sourceInputId,
  data,
  resolution,
  volume,
  deadIds,
}: PacmanGhostsInputProps) {
  const { width, height } = resolution;
  // Latest target per track id (tile space) + its stable color.
  const targetsRef = useRef<Map<number, Rect & { color: number }>>(new Map());
  // Eased, currently-rendered position per track id.
  const cursRef = useRef<Map<number, Rect>>(new Map());
  // Ids that were shot down last frame — used to pop a ghost back in place on respawn.
  const prevDeadRef = useRef<Set<number>>(new Set());
  const [, setFrame] = useState(0);

  // Map normalized detection boxes through the same rescale 'fill' (cover)
  // transform the video uses (see PeopleBoxes in inputs.tsx) into tile-space.
  useEffect(() => {
    const { boxes, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;

    const deadSet = new Set(deadIds ?? []);
    // Ghosts that just came back to life: pop them in place, not back up from
    // wherever the vanish animation left them.
    for (const id of prevDeadRef.current) {
      if (!deadSet.has(id)) cursRef.current.delete(id);
    }
    prevDeadRef.current = deadSet;

    const next = new Map<number, Rect & { color: number }>();
    for (const b of boxes.slice(0, MAX_GHOSTS)) {
      // Fixed-aspect ghost fitted inside the person's box (contain) so it keeps
      // ghost proportions instead of stretching to a tall bounding box. Work in
      // tile pixels, then normalize, because X and Y are normalized separately.
      const boxWpx = b.w * dispW;
      const boxHpx = b.h * dispH;
      let ghostWpx = boxWpx;
      let ghostHpx = ghostWpx * GHOST_ASPECT;
      if (ghostHpx > boxHpx) {
        ghostHpx = boxHpx;
        ghostWpx = ghostHpx / GHOST_ASPECT;
      }
      ghostWpx *= GHOST_SCALE;
      ghostHpx *= GHOST_SCALE;
      const cx = (offX + (b.x + b.w / 2) * dispW) / width;
      const cy = (offY + (b.y + b.h / 2) * dispH) / height;
      const hw = ghostWpx / 2 / width;
      const hh = ghostHpx / 2 / height;
      // Shot-down ghost: shrink to nothing and drop a bit so it vanishes.
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

    // Drop eased state for ghosts that no longer exist.
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
          // New ghost: appear in place rather than sliding in from elsewhere.
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
    .slice(0, MAX_GHOSTS);

  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [];
  params.push({ type: 'f32', fieldName: 'box_count', value: ids.length });
  params.push({ type: 'f32', fieldName: 'bg_dim', value: BG_DIM });
  params.push({ type: 'f32', fieldName: 'bg_desat', value: BG_DESAT });

  for (let i = 0; i < MAX_GHOSTS; i++) {
    const id = i < ids.length ? ids[i] : undefined;
    const tgt = id !== undefined ? targetsRef.current.get(id) : undefined;
    const cur = id !== undefined ? cursRef.current.get(id) : undefined;
    // Fall back to the target until the easing state is initialized next tick.
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
      shaderId='pacman-ghosts'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      <Rescaler style={{ ...resolution, rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
    </Shader>
  );
}
