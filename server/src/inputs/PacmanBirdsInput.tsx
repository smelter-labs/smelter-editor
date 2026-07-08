import React, { useEffect, useState } from 'react';
import { View, Image, InputStream, Rescaler } from '@swmansion/smelter';
import type { PersonBoxes } from '../app/store';
import type { DuckEntity, DuckFlightParams } from '../duckHunter/duckFlight';
import {
  DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  DEFAULT_DUCK_PAUSE_MS,
  DUCK_DEATH_MS,
  DUCK_FALL_MS,
  DUCK_HANG_MS,
  MAX_DUCKS,
  contentToPx,
  duckContentPos,
  validViewport,
} from '../duckHunter/duckFlight';

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

// Death sequence timings (hang/fall/total) come from the shared duck model so
// the renderer and the controller retire a shot duck in lock-step.
const FLASH_MS = 140; // brief white flash at the instant of the hit
const DIM_ALPHA = 0.6; // peak darkness of the overlay

function alphaHex(a: number): string {
  return Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
}

// Overlay darkness for a death at `elapsed` ms: fade in fast, hold, fade out.
function dimFor(elapsed: number): number {
  if (elapsed < 0 || elapsed >= DUCK_DEATH_MS) return 0;
  const fadeIn = Math.min(1, elapsed / 120);
  const fadeOut = Math.min(1, (DUCK_DEATH_MS - elapsed) / 160);
  return DIM_ALPHA * fadeIn * fadeOut;
}

// White hit-flash for a death at `elapsed` ms (brief, at the moment of impact).
function flashFor(elapsed: number): number {
  if (elapsed < 0 || elapsed >= FLASH_MS) return 0;
  return 0.5 * (1 - elapsed / FLASH_MS);
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
 * on the duck. On a hit a duck carries `diedAt`, and we play the Duck Hunt death
 * beat: a brief flash, the scene darkens, the shot duck hangs then drops off the
 * bottom. Sprites are registered in smelter.tsx as `duck-<color>-<frame>` (frame
 * ∈ {0,1,2,shot}); the flap frame is animated locally.
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

  // Scene darkness / flash are the strongest across all in-progress deaths.
  let dim = 0;
  let flash = 0;
  for (const d of dead) {
    const elapsed = now - (d.diedAt ?? now);
    dim = Math.max(dim, dimFor(elapsed));
    flash = Math.max(flash, flashFor(elapsed));
  }

  return (
    <View style={{ width, height }}>
      <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
      <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        {/* Live ducks (below the dim overlay so they darken on a hit). */}
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

        {/* Dim overlay: darkens the video + live ducks during a death beat. */}
        {dim > 0 ? (
          <View
            style={{
              top: 0,
              left: 0,
              width,
              height,
              backgroundColor: `#000000${alphaHex(dim)}`,
            }}
          />
        ) : null}

        {/* Shot ducks, above the dim so they stay lit: hang, then fall. Frozen
            at the position they were hit (computed at diedAt from the same model). */}
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
              return (
                <View
                  key={`dead-${d.id}`}
                  style={{
                    top: Math.round(cy - side / 2),
                    left: Math.round(px - side / 2),
                    width: side,
                    height: side,
                  }}>
                  <Rescaler
                    style={{ width: side, height: side, rescaleMode: 'fit' }}>
                    <Image imageId={`duck-${d.color % 3}-shot`} />
                  </Rescaler>
                </View>
              );
            })
          : null}

        {/* Brief white flash at the instant of the hit, on top. */}
        {flash > 0 ? (
          <View
            style={{
              top: 0,
              left: 0,
              width,
              height,
              backgroundColor: `#FFFFFF${alphaHex(flash)}`,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
