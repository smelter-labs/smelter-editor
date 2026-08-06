import React, { useEffect, useRef, useState } from 'react';
import { View, Image, InputStream, Rescaler, Shader } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';
import type { HaunterGhost, HaunterState } from '../haunter/haunterModel';
import {
  DEFAULT_HAUNTER_COUNT,
  DEFAULT_HAUNTER_DIST,
  DEFAULT_HAUNTER_SCALE,
  DEFAULT_HAUNTER_SPEED,
  MAX_HAUNTERS,
  assignGhosts,
  haunterSidePx,
  haunterState,
  hoverTargetPx,
  reconcileCount,
  stepGhost,
} from '../haunter/haunterModel';
import { validViewport } from '../duckHunter/duckFlight';

type HaunterGhostsInputProps = {
  sourceInputId: string;
  data: PersonBoxes;
  resolution: { width: number; height: number };
  volume: number;
};

// Render cadence (~60fps): advances the ghost physics and re-renders.
const TICK_MS = 16;
// Looking-state sprites mirror on X every half-period (full flip cycle).
const LOOKING_FLIP_MS = 400;
// Cap the integration step so a stalled interval doesn't launch a ghost.
const MAX_DT_MS = 100;
// Aura radius as a multiple of the sprite side (extends beyond the sprite).
const AURA_RADIUS_MULT = 0.85;
// Each sprite runs through the dedicated `haunter-ghost` shader: it keys out
// the green backdrop baked into the PNGs (keying constants live in the wgsl)
// and gives every ghost its own identity — a per-ghost hue rotation and a
// jelly-like wave. Golden-angle hue spacing keeps any pool size well spread
// (ghost 0 keeps the art's original color); the wave phase is offset per
// ghost so the pool doesn't wobble in lockstep.
const GHOST_HUE_STEP = 0.381966;
const GHOST_WAVE_PHASE_STEP = 1.9;
// Wave shape: horizontal displacement as a fraction of the sprite width,
// sine cycles across the sprite height, and animation speed (rad/s).
const GHOST_WAVE_AMP = 0.025;
const GHOST_WAVE_FREQ = 2.5;
const GHOST_WAVE_SPEED = 4;

function ghostHueShift(idx: number): number {
  return (idx * GHOST_HUE_STEP) % 1;
}

function ghostShaderParam(idx: number, flipX = false) {
  const fields: Array<[string, number]> = [
    ['hue_shift', ghostHueShift(idx)],
    ['wave_phase', idx * GHOST_WAVE_PHASE_STEP],
    ['wave_amp', GHOST_WAVE_AMP],
    ['wave_freq', GHOST_WAVE_FREQ],
    ['wave_speed', GHOST_WAVE_SPEED],
    ['flip_x', flipX ? 1 : 0],
  ];
  return {
    type: 'struct' as const,
    value: fields.map(([fieldName, value]) => ({
      type: 'f32' as const,
      fieldName,
      value,
    })),
  };
}
// Padding around the person's box so the aura wraps them, not hugs the pixels.
const PERSON_AURA_PAD = 1.25;
// How fast the aura's menace eases toward attached (1) / idle (0), per second.
const MENACE_EASE_PER_S = 3;

type DrawnGhost = {
  idx: number;
  px: number;
  py: number;
  /** bored (idle) → looking (noticed, 1s) → hunting (chasing + scaring). */
  state: HaunterState;
  /** Horizontal mirror while in looking state (toggles every LOOKING_FLIP_MS). */
  flipX: boolean;
  /** Eased 0..1 scare level driving the aura's color/intensity. */
  menace: number;
  /** Haunted person's ellipse in tile space (0..1); zeros unless hunting. */
  pcx: number;
  pcy: number;
  phw: number;
  phh: number;
};

/**
 * Ambient "haunting ghosts": a small pool of ghost sprites floats over the
 * video, each latching onto the nearest tracked person in range (1:1). A fresh
 * latch only *looks* at the person for LOOKING_MS (the ghost holds still with
 * the looking face), then starts hunting — following above the head with the
 * hunting face. A ghost whose person left the frame goes back to bored,
 * idling in place (gentle drift) until someone unclaimed comes into range.
 * All rules live in haunterModel.ts — this component only feeds it detections,
 * ticks the physics, and draws the sprites (`haunter-<state>`, registered in
 * smelter.tsx). Unlike the other ghost modes this stays mounted with zero
 * boxes, so idle ghosts keep waiting on an empty frame.
 *
 * The video underneath runs through the `haunter-aura` shader: each ghost
 * projects a menacing aura around itself and (when scaring) around its person
 * — the two shapes merge into one blob with a flame-like yellow rim, darkened
 * interior, and heat-haze warp. Ghost sprites render above the shader so they
 * stay crisp, each run through the `haunter-ghost` shader: it cuts out the
 * green backdrop baked into the PNGs, rotates the hue per ghost so the pool
 * isn't one color, and adds a jelly-like wave so the sprites feel alive.
 */
export function HaunterGhostsInput({
  sourceInputId,
  data,
  resolution,
  volume,
}: HaunterGhostsInputProps) {
  const { width, height } = resolution;
  const ghostsRef = useRef<HaunterGhost[]>([]);
  const dataRef = useRef(data);
  const drawRef = useRef<DrawnGhost[]>([]);
  const menaceRef = useRef<Map<number, number>>(new Map());
  const lastTickRef = useRef(Date.now());
  const [, setTick] = useState(0);

  // New detections: match the pool to the operator's count, then re-run the
  // sticky 1:1 assignment against the latest tracked boxes.
  useEffect(() => {
    dataRef.current = data;
    const v = { width, height, frameW: data.frameW, frameH: data.frameH };
    if (!validViewport(v)) return;
    ghostsRef.current = reconcileCount(
      ghostsRef.current,
      data.haunterCount ?? DEFAULT_HAUNTER_COUNT,
      width,
      height,
    );
    const thresholdPx =
      (data.haunterDist ?? DEFAULT_HAUNTER_DIST) * Math.min(width, height);
    assignGhosts(ghostsRef.current, data.boxes, v, thresholdPx, Date.now());
  }, [data, width, height]);

  // ~60fps physics: ease each ghost toward its person (or idle orbit) with a
  // measured dt, then re-render from the resulting draw positions.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(MAX_DT_MS, now - lastTickRef.current);
      lastTickRef.current = now;

      const d = dataRef.current;
      const v = { width, height, frameW: d.frameW, frameH: d.frameH };
      if (!validViewport(v)) return;
      const side = haunterSidePx(
        d.haunterScale ?? DEFAULT_HAUNTER_SCALE,
        width,
        height,
      );
      const speed = d.haunterSpeed ?? DEFAULT_HAUNTER_SPEED;
      const byId = new Map(d.boxes.map((b) => [b.id, b]));

      // Person boxes go to the aura shader in tile space, mapped through the
      // same rescale 'fill' (cover) transform the video uses.
      const scale = Math.max(width / d.frameW, height / d.frameH);
      const dispW = d.frameW * scale;
      const dispH = d.frameH * scale;
      const offX = (width - dispW) / 2;
      const offY = (height - dispH) / 2;

      const menaceK = Math.min(1, (MENACE_EASE_PER_S * dt) / 1000);
      drawRef.current = ghostsRef.current.map((g) => {
        const box = g.targetId != null ? byId.get(g.targetId) : undefined;
        const state = box ? haunterState(g, now) : 'bored';
        // While only looking, the ghost holds still (idle drift) — the chase
        // and the menacing aura start once the state flips to hunting.
        const hunting = state === 'hunting';
        const target = box && hunting ? hoverTargetPx(box, v, side) : null;
        const pos = stepGhost(g, target, dt, now, speed, width, height);
        const prev = menaceRef.current.get(g.idx) ?? 0;
        const menace = prev + ((hunting ? 1 : 0) - prev) * menaceK;
        menaceRef.current.set(g.idx, menace);
        const auraBox = hunting ? box : undefined;
        return {
          idx: g.idx,
          px: pos.px,
          py: pos.py,
          state,
          flipX:
            state === 'looking' &&
            Math.floor(now / LOOKING_FLIP_MS) % 2 === 1,
          menace,
          pcx: auraBox
            ? (offX + (auraBox.x + auraBox.w / 2) * dispW) / width
            : 0,
          pcy: auraBox
            ? (offY + (auraBox.y + auraBox.h / 2) * dispH) / height
            : 0,
          phw: auraBox
            ? ((auraBox.w * dispW) / 2 / width) * PERSON_AURA_PAD
            : 0,
          phh: auraBox
            ? ((auraBox.h * dispH) / 2 / height) * PERSON_AURA_PAD
            : 0,
        };
      });
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [width, height]);

  const side = Math.round(
    haunterSidePx(data.haunterScale ?? DEFAULT_HAUNTER_SCALE, width, height),
  );

  // Aura slots are keyed by ghost idx so each ghost keeps a stable noise phase
  // in the shader; empty slots zero out (radius 0 disables the slot).
  const auraR = (side * AURA_RADIUS_MULT) / Math.min(width, height);
  const auraParams: Array<{ type: 'f32'; fieldName: string; value: number }> = [
    {
      type: 'f32',
      fieldName: 'aura_count',
      value: Math.min(drawRef.current.length, MAX_HAUNTERS),
    },
  ];
  for (let i = 0; i < MAX_HAUNTERS; i++) {
    const g = drawRef.current[i];
    auraParams.push(
      { type: 'f32', fieldName: `a${i}_gx`, value: g ? g.px / width : 0 },
      { type: 'f32', fieldName: `a${i}_gy`, value: g ? g.py / height : 0 },
      { type: 'f32', fieldName: `a${i}_gr`, value: g ? auraR : 0 },
      { type: 'f32', fieldName: `a${i}_menace`, value: g?.menace ?? 0 },
      { type: 'f32', fieldName: `a${i}_hue`, value: g ? ghostHueShift(g.idx) : 0 },
      { type: 'f32', fieldName: `a${i}_px`, value: g?.pcx ?? 0 },
      { type: 'f32', fieldName: `a${i}_py`, value: g?.pcy ?? 0 },
      { type: 'f32', fieldName: `a${i}_pw`, value: g?.phw ?? 0 },
      { type: 'f32', fieldName: `a${i}_ph`, value: g?.phh ?? 0 },
    );
  }

  return (
    <View style={{ width, height }}>
      <Shader
        shaderId='haunter-aura'
        resolution={resolution}
        shaderParam={{ type: 'struct', value: auraParams }}>
        {/* Shader children must have a known size — a sized View makes that
            hold for the raw stream's Rescaler. */}
        <View style={{ width, height }}>
          <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
            <InputStream inputId={sourceInputId} volume={volume} />
          </Rescaler>
        </View>
      </Shader>
      <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        {drawRef.current.map((g) => (
          <View
            key={g.idx}
            style={{
              top: Math.round(g.py - side / 2),
              left: Math.round(g.px - side / 2),
              width: side,
              height: side,
            }}>
            <Shader
              shaderId='haunter-ghost'
              resolution={{ width: side, height: side }}
              shaderParam={ghostShaderParam(g.idx, g.flipX)}>
              {/* Shader children must have a known size — a sized View makes
                  that hold for the sprite's Rescaler. */}
              <View style={{ width: side, height: side }}>
                <Rescaler
                  style={{ width: side, height: side, rescaleMode: 'fit' }}>
                  <Image imageId={`haunter-${g.state}`} />
                </Rescaler>
              </View>
            </Shader>
          </View>
        ))}
      </View>
    </View>
  );
}
