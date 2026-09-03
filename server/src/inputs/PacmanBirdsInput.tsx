import React, { useEffect, useRef, useState } from 'react';
import { View, Image, InputStream, Rescaler, Shader } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';
import type { DuckEntity, DuckFlightParams } from '../duckHunter/duckFlight';
import {
  DEFAULT_DUCK_AURA_LEAD_MS,
  DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  DEFAULT_DUCK_PAUSE_MS,
  DUCK_DEATH_MS,
  DUCK_FALL_MS,
  DUCK_HANG_MS,
  HIT_PAD,
  MAX_DUCKS,
  contentToPx,
  duckAppeared,
  duckContentPos,
  hitFlashEnvelope,
  spawnAuraEnvelope,
  validViewport,
} from '../duckHunter/duckFlight';
import { HIT_TINT_FALLBACK, hitShaderParam } from './hitFlashShader';
import type { AuraSlot } from './spawnAuraShader';
import { MAX_AURAS, auraPhase, spawnAuraParam } from './spawnAuraShader';

type PacmanBirdsInputProps = {
  sourceInputId: string;
  data: PersonBoxes;
  resolution: { width: number; height: number };
  volume: number;
  /** Authoritative live ducks from the DuckHunterController (spawn + flight). */
  ducks?: DuckEntity[];
};

// Render cadence (~60fps): re-renders so the flight (driven by the shared model)
// looks smooth between the controller's ~30Hz publishes, and advances the flap.
const TICK_MS = 16;
// Wing-flap animation: advance one of the 3 flap frames every N ticks.
const FLAP_TICKS = 7; // ~112ms per frame

// Death sequence timings (hang/fall/total) and the hit-flash envelope come from
// the shared duck model so the renderer and the controller retire a shot duck
// in lock-step.

// Spawn-aura box smoothing: raw detections jitter frame to frame, and a ring
// inherits every wobble of the box it is drawn on. Same exponential easing the
// green boxes use (SmoothedBoxes / CarHueWrapper).
const AURA_SMOOTH = 0.25;
// Grace period after a bird's detection drops out: the ring holds its last
// position and fades, rather than strobing on every missed frame. A duck whose
// bird stays gone simply flies on unmarked.
const AURA_HOLD_MS = 400;

/** A detection box in content space, eased over time for the aura ring. */
type AuraBox = {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  seenAt: number;
};

function flightParams(data: PersonBoxes): DuckFlightParams {
  return {
    auraLeadMs: data.duckAuraLeadMs ?? DEFAULT_DUCK_AURA_LEAD_MS,
    pauseMs: data.duckPauseMs ?? DEFAULT_DUCK_PAUSE_MS,
    flySpeed: data.duckFlySpeed ?? DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  };
}

function ease(from: number, to: number, k: number): number {
  return from + (to - from) * k;
}

/**
 * Draws the classic Duck Hunt (NES) duck sprites over the video. The ducks are
 * owned by the DuckHunterController (spawn point, 45° free-flight, death beat);
 * this component is a pure view of the published `ducks`, computing each sprite
 * position from the same shared model the hit-test uses — so a shot always lands
 * on the duck. On a hit a duck carries `diedAt` + `hitColor`, and we play the
 * death beat: the shot duck itself flashes white-hot, glows in the shooting
 * player's color behind an expanding halo (the `duck-hit-flash` shader), then
 * hangs and drops off the bottom. The frame deliberately does NOT dim here —
 * screen dimming belongs to the dog pop-up (two in a row), so that beat stays
 * the special one. Sprites are registered in smelter.tsx as
 * `duck-<color>-<frame>` (frame ∈ {0,1,2,shot}); the flap frame is animated
 * locally.
 *
 * The video underneath runs through the `duck-spawn-aura` shader, which marks
 * the REAL bird each duck hatches from — otherwise a sprite just appears out of
 * nowhere and nothing says which detection it came from. A duck carries its
 * tracker box id, so the pairing is free here: `ducks[i].id` is the id of the
 * box in `data.boxes` it was spawned on. The aura is a telegraph: a shockwave
 * plus a lock-on ring in the duck's palette color mark the bird for
 * `auraLeadMs`, then the duck sprite appears on it and the mark fades out.
 * Boxes are eased here, not upstream, because only the ring cares about jitter.
 */
export function PacmanBirdsInput({
  sourceInputId,
  data,
  resolution,
  volume,
  ducks,
}: PacmanBirdsInputProps) {
  const { width, height } = resolution;
  const [tick, setTick] = useState(0);
  const dataRef = useRef(data);
  const ducksRef = useRef(ducks);
  const auraBoxRef = useRef<Map<number, AuraBox>>(new Map());

  useEffect(() => {
    dataRef.current = data;
    ducksRef.current = ducks;
  }, [data, ducks]);

  // Re-render at ~60fps so the flight interpolates smoothly and wings flap,
  // and ease each aura box toward its latest detection on the same beat.
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      const boxes = auraBoxRef.current;
      const live = new Set((ducksRef.current ?? []).map((d) => d.id));
      for (const b of dataRef.current.boxes) {
        // Only ducks get a ring, so only their boxes are worth tracking.
        if (!live.has(b.id)) continue;
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const prev = boxes.get(b.id);
        boxes.set(b.id, {
          cx: prev ? ease(prev.cx, cx, AURA_SMOOTH) : cx,
          cy: prev ? ease(prev.cy, cy, AURA_SMOOTH) : cy,
          hw: prev ? ease(prev.hw, b.w / 2, AURA_SMOOTH) : b.w / 2,
          hh: prev ? ease(prev.hh, b.h / 2, AURA_SMOOTH) : b.h / 2,
          seenAt: at,
        });
      }
      // Retire a box once its duck is gone, or once the detection has been
      // missing for longer than the hold — nothing left to mark either way.
      for (const [id, b] of boxes) {
        if (!live.has(id) || at - b.seenAt > AURA_HOLD_MS) boxes.delete(id);
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();
  const v = { width, height, frameW: data.frameW, frameH: data.frameH };
  const params = flightParams(data);
  const list = (ducks ?? []).slice(0, MAX_DUCKS);
  const geomOk = validViewport(v);

  // A duck is drawn only once it has appeared — for the first `auraLeadMs`
  // after spawnAt only the aura telegraphs it (and the hit-test skips it too).
  const live = list.filter(
    (d) => d.diedAt == null && duckAppeared(d, now, params.auraLeadMs),
  );
  const dead = list.filter((d) => d.diedAt != null);

  // Aura slots: one per duck whose source bird is still known, freshest first
  // (the newest link is the one a viewer still needs explained). Everything is
  // converted to tile uv here — the shader draws in tile space, and the cover
  // mapping is the same one the sprites are placed with.
  const auras: AuraSlot[] = [];
  if (geomOk) {
    const ranked = [...list].sort((a, b) => b.spawnAt - a.spawnAt);
    for (const d of ranked) {
      if (auras.length >= MAX_AURAS) break;
      const b = auraBoxRef.current.get(d.id);
      if (!b) continue;
      const env = spawnAuraEnvelope(
        now - d.spawnAt,
        params,
        d.diedAt != null ? now - d.diedAt : null,
      );
      // Detection dropout: hold the last position and fade out rather than
      // popping the ring off the moment a frame misses the bird.
      const hold = 1 - Math.min(1, Math.max(0, now - b.seenAt) / AURA_HOLD_MS);
      if (hold <= 0 || (env.glow <= 0 && env.pulse <= 0 && env.link <= 0)) {
        continue;
      }
      const c = contentToPx(b.cx, b.cy, v);
      const corner = contentToPx(b.cx + b.hw, b.cy + b.hh, v);
      // A shot duck freezes where it was hit, exactly like its sprite — the
      // tether is long gone by the time the fall starts, but the two should
      // never disagree while both are on screen.
      const dpos = duckContentPos(d, d.diedAt ?? now, params, v);
      const dpx = contentToPx(dpos.x, dpos.y, v);
      auras.push({
        cx: c.px / width,
        cy: c.py / height,
        hw: (corner.px - c.px) / width,
        hh: (corner.py - c.py) / height,
        tone: d.color % 3,
        phase: auraPhase(d.id),
        dx: dpx.px / width,
        dy: dpx.py / height,
        env: {
          glow: env.glow * hold,
          pulse: env.pulse * hold,
          pulseT: env.pulseT,
          link: env.link * hold,
        },
      });
    }
  }

  return (
    <View style={{ width, height }}>
      <Shader
        shaderId='duck-spawn-aura'
        resolution={resolution}
        shaderParam={spawnAuraParam(auras)}>
        {/* Shader children must have a known size — a sized View makes that
            hold for the raw stream's Rescaler. */}
        <View style={{ width, height }}>
          <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
            <InputStream inputId={sourceInputId} volume={volume} />
          </Rescaler>
        </View>
      </Shader>
      <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        {/* Live ducks, under the shot ones so a falling duck draws on top. */}
        {geomOk
          ? live.map((d) => {
              const pos = duckContentPos(d, now, params, v);
              const { px, py } = contentToPx(pos.x, pos.y, v);
              const side = Math.round(d.sideFrac * width);
              const color = d.color % 3;
              const frame = Math.floor((tick + d.id * 3) / FLAP_TICKS) % 3;
              return (
                <View
                  key={d.id}
                  style={{
                    top: Math.round(py - side / 2),
                    left: Math.round(px - side / 2),
                    width: side,
                    height: side,
                  }}>
                  <Rescaler
                    style={{ width: side, height: side, rescaleMode: 'fit' }}>
                    <Image imageId={`duck-${color}-${frame}`} />
                  </Rescaler>
                </View>
              );
            })
          : null}

        {/* Shot ducks: flash, hang, then fall. Frozen at the position they were
            hit (computed at diedAt from the same model). The hit-flash shader
            box is padded around the sprite so the halo has room to spread; it
            stays mounted for the whole death beat and decays to a passthrough,
            rather than swapping node types mid-animation. */}
        {geomOk
          ? dead.map((d) => {
              const diedAt = d.diedAt ?? now;
              const elapsed = now - diedAt;
              if (elapsed >= DUCK_DEATH_MS) return null; // fallen off-screen
              const pos = duckContentPos(d, diedAt, params, v);
              const { px, py } = contentToPx(pos.x, pos.y, v);
              const side = Math.round(d.sideFrac * width);
              let cy = py;
              if (elapsed > DUCK_HANG_MS) {
                // Accelerating drop to just past the bottom edge.
                const fp = (elapsed - DUCK_HANG_MS) / DUCK_FALL_MS;
                const floor = height + side;
                cy = py + (floor - py) * fp * fp;
              }
              const env = hitFlashEnvelope(elapsed);
              // Padded, square plane centred on the sprite: the halo lives in
              // the padding. `box` derives only from the frozen sprite side, so
              // it — and the shader resolution — stay constant for the whole
              // beat; the impact zoom happens inside the shader instead.
              const box = Math.round(side * HIT_PAD);
              const off = Math.round((box - side) / 2);
              return (
                <View
                  key={`dead-${d.id}`}
                  style={{
                    // Offsetting the rounded sprite origin by `off` lands the
                    // duck on exactly the pixel it occupied before the box grew.
                    top: Math.round(cy - side / 2) - off,
                    left: Math.round(px - side / 2) - off,
                    width: box,
                    height: box,
                  }}>
                  <Shader
                    shaderId='duck-hit-flash'
                    resolution={{ width: box, height: box }}
                    shaderParam={hitShaderParam(
                      env,
                      d.hitColor ?? HIT_TINT_FALLBACK,
                      box,
                    )}>
                    {/* Shader children must have a known size. */}
                    <View style={{ width: box, height: box }}>
                      <View
                        style={{
                          top: off,
                          left: off,
                          width: side,
                          height: side,
                        }}>
                        <Rescaler
                          style={{
                            width: side,
                            height: side,
                            rescaleMode: 'fit',
                          }}>
                          <Image imageId={`duck-${d.color % 3}-shot`} />
                        </Rescaler>
                      </View>
                    </View>
                  </Shader>
                </View>
              );
            })
          : null}
      </View>
    </View>
  );
}
