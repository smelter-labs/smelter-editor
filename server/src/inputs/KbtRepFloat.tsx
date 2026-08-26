import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from '@swmansion/smelter';
import type { KbtHudTile } from '../app/store';
import { TICK_MS } from './kettlebellRig';
import { KBT_EXERCISE_COLORS } from '@smelter-editor/types';
import type { KbtExerciseKey } from '@smelter-editor/types';

/** Matches KbtHud's palette (private there). */
const BAD = '#FF4030';
const DISPLAY = 'Big Shoulders Display';

/** Lifetime of one floater. */
const FLOAT_MS = 1800;
/** Geometry in design px (1080-tall content space, scaled by k). */
const FS = 52;
const RISE = 260;
const BOX_W = 400;
/** Wobble amplitude in design px, spreading min→max as the text rises. */
const WOBBLE_MIN = 9;
const WOBBLE_MAX = 22;

type Floater = {
  id: number;
  startAt: number;
  label: string;
  color: string;
  /** Small per-floater horizontal offset so back-to-back reps don't stack. */
  xJitter: number;
};

/** 6-digit hex + alpha 0..1 → RGBA hex (all HUD colors are #RRGGBB). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return hex.slice(0, 7) + a.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Game-style floating rep text: on every scored rep a "SNATCH +3" (or red
 * "NO REP") spawns mid-tile and drifts up like smoke — sine wobble widening
 * as it rises, fading out over its lifetime.
 *
 * Same clocking recipe as KbtShakeWrapper: the ~10 Hz held snapshots only
 * *spawn* floaters (a `tile.reps` increase between renders is a new rep —
 * inherently aligned with the ~3s-delayed video, unlike live pose state);
 * a local 60 Hz interval renders the actual motion.
 */
export function KbtRepFloaters({
  tile,
  parent,
}: {
  tile: KbtHudTile;
  parent: { width: number; height: number };
}) {
  const k = parent.height / 1080;
  const prevReps = useRef<number | null>(null);
  const floaters = useRef<Floater[]>([]);
  const nextId = useRef(0);
  const [, setTick] = useState(0);

  if (prevReps.current != null && tile.reps < prevReps.current) {
    // Reps went backwards: heat restart — drop leftovers from the old heat.
    floaters.current = [];
  }
  if (prevReps.current != null && tile.reps > prevReps.current) {
    // One floater even if reps jumped by 2+ in a single snapshot: the
    // lastRep* fields only describe the latest rep.
    const bad = tile.lastRepVerdict === 'incorrect';
    const ex = tile.exercise === 'idle' ? '' : tile.exercise.toUpperCase();
    const label = bad
      ? 'NO REP'
      : tile.lastRepPoints > 0
        ? `${ex} +${tile.lastRepPoints}`.trim()
        : ex;
    const color = bad
      ? BAD
      : (KBT_EXERCISE_COLORS[tile.exercise as KbtExerciseKey] ?? tile.color);
    const id = nextId.current++;
    if (label) {
      floaters.current = [
        ...floaters.current,
        { id, startAt: Date.now(), label, color, xJitter: ((id % 3) - 1) * 36 },
      ];
    }
  }
  prevReps.current = tile.reps;

  const now = Date.now();
  floaters.current = floaters.current.filter((f) => now - f.startAt < FLOAT_MS);
  const active = floaters.current.length > 0;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  return (
    <View style={{ top: 0, left: 0, width: parent.width, height: parent.height }}>
      {floaters.current.map((f) => {
        const t = (now - f.startAt) / FLOAT_MS;
        // Hold full alpha through the pop, then fade out.
        const alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
        const wobble =
          Math.sin(t * Math.PI * 2 * 2.2 + f.id * 1.7) *
          (WOBBLE_MIN + (WOBBLE_MAX - WOBBLE_MIN) * t);
        // Slight growth substitutes for the missing scale transform.
        const fs = Math.round(FS * (1 + 0.12 * t) * k);
        const boxW = Math.round(BOX_W * k);
        return (
          <View
            key={f.id}
            style={{
              top: Math.round(parent.height * 0.45 - t * RISE * k),
              left: Math.round(
                parent.width / 2 + (f.xJitter + wobble) * k - boxW / 2,
              ),
              width: boxW,
              height: Math.round(fs * 1.4),
            }}>
            <Text
              style={{
                width: boxW,
                fontSize: fs,
                color: withAlpha(f.color, alpha),
                fontFamily: DISPLAY,
                fontWeight: 'bold',
                align: 'center',
              }}>
              {f.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
