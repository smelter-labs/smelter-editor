import React, { useEffect, useRef, useState } from 'react';
import { View } from '@swmansion/smelter';
import type { KbtHudTile } from '../app/store';
import { useAnimTickMs } from '../app/store';

/** Matches MILESTONE_FX_MS in KettlebellTournamentController. */
const FX_MS = 3000;
/** Peak jitter in content px (the tile is in 1920-long-edge content space). */
const SHAKE_AMP = 8;

type KbtShakeWrapperProps = {
  children: React.ReactNode;
  resolution: { width: number; height: number };
  /** KbtHudTile.fx — presence arms the shake, p seeds/retriggers the clock. */
  fx: NonNullable<KbtHudTile['fx']> | null;
};

/**
 * Milestone tile shake: jitters the whole tile column (video + plate) while
 * the every-5th-rep celebration runs, amplitude decaying to zero over the
 * effect window.
 *
 * The ~10 Hz held snapshots only gate the effect and seed a LOCAL clock from
 * their progress field (a fresh fx with a smaller p than the clock implies is
 * a retrigger); the 60 Hz interval below renders the actual motion, so the
 * jitter is smooth rather than stepping at snapshot rate. Offsets come from
 * two incommensurate sines, not Math.random() — random per-tick snaps at
 * 60 Hz read as noise, not impact.
 */
export function KbtShakeWrapper({
  children,
  resolution,
  fx,
}: KbtShakeWrapperProps) {
  // Local effect clock: Date.now() epoch of the effect's start.
  const startRef = useRef<number | null>(null);
  const [, setTick] = useState(0);
  const tickMs = useAnimTickMs();

  if (fx) {
    const implied = Date.now() - fx.p * FX_MS;
    // First sighting, or a retrigger (new milestone while the old clock
    // already ran further than the snapshot's progress says).
    if (startRef.current == null || implied > startRef.current + FX_MS / 2) {
      startRef.current = implied;
    }
  }

  const elapsed =
    startRef.current == null ? Infinity : Date.now() - startRef.current;
  const active = elapsed < FX_MS;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, tickMs);
    return () => clearInterval(timer);
  }, [active, tickMs]);

  // The tree shape must not depend on `active`: React reconciles by position,
  // so an extra View appearing only while shaking pushed every child one level
  // down and remounted the whole tile — skeleton rig, bell box, rep floaters —
  // at both ends of every milestone (the milestone rep's own floater never
  // spawned, the skeleton blinked as the aura started). Idle is a zero offset.
  // (`elapsed` is Infinity while idle — never feed it to the sines: NaN
  // offsets would get the whole scene update rejected.)
  const amp = active ? SHAKE_AMP * Math.max(0, 1 - elapsed / FX_MS) : 0;
  const ox = active ? Math.round(Math.sin(elapsed * 0.073) * amp) : 0;
  const oy = active ? Math.round(Math.cos(elapsed * 0.097) * amp) : 0;
  return (
    <View style={{ ...resolution, ...(active ? { overflow: 'hidden' } : {}) }}>
      <View style={{ top: oy, left: ox, ...resolution }}>{children}</View>
    </View>
  );
}
