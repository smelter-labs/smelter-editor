import React, { useEffect, useState } from 'react';
import { View, Image, InputStream, Rescaler, Shader } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';
import type {
  DuckEntity,
  DuckFlightParams,
  HitFlashEnvelope,
} from '../duckHunter/duckFlight';
import {
  DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  DEFAULT_DUCK_PAUSE_MS,
  DUCK_DEATH_MS,
  DUCK_FALL_MS,
  DUCK_HANG_MS,
  HIT_PAD,
  HIT_POP_SCALE,
  MAX_DUCKS,
  contentToPx,
  duckContentPos,
  hitFlashEnvelope,
  validViewport,
} from '../duckHunter/duckFlight';
import { hexToRgb } from '../utils/shaderUtils';

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

// Halo reach as a fraction of the sprite side, at full expansion.
const HIT_RIM_FRAC = 0.16;
// Fallback tint when a duck died without a recorded shooter (shouldn't happen,
// but a white flash still reads correctly as a hit).
const HIT_TINT_FALLBACK = '#FFFFFF';

/** Uniforms for `duck-hit-flash`. Order must match the WGSL ShaderOptions. */
function hitShaderParam(env: HitFlashEnvelope, hitColor: string, box: number) {
  const tint = hexToRgb(hitColor);
  const fields: Array<[string, number]> = [
    // The impact zoom is a UV transform inside the shader, not a resize of the
    // child View: that keeps the shader plane a constant size for the whole
    // death beat, so the render target is never reallocated mid-animation and
    // the box never jitters by a rounded pixel.
    ['scale', 1 + HIT_POP_SCALE * env.pop],
    ['flash', env.flash],
    ['glow', env.glow],
    ['rim', env.rim],
    ['rim_t', env.rimT],
    ['rim_px', box * HIT_RIM_FRAC],
    ['tint_r', tint.r],
    ['tint_g', tint.g],
    ['tint_b', tint.b],
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

function flightParams(data: PersonBoxes): DuckFlightParams {
  return {
    pauseMs: data.duckPauseMs ?? DEFAULT_DUCK_PAUSE_MS,
    flySpeed: data.duckFlySpeed ?? DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  };
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

  // Re-render at ~60fps so the flight interpolates smoothly and wings flap.
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();
  const v = { width, height, frameW: data.frameW, frameH: data.frameH };
  const params = flightParams(data);
  const list = (ducks ?? []).slice(0, MAX_DUCKS);
  const geomOk = validViewport(v);

  const live = list.filter((d) => d.diedAt == null);
  const dead = list.filter((d) => d.diedAt != null);

  return (
    <View style={{ width, height }}>
      <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
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
