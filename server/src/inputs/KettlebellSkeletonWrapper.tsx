import React, { useEffect, useRef, useState } from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { KettlebellOverlayState } from '../app/store';
import { MotionPredictor } from './motionPredictor';
import {
  JOINT_COUNT,
  KPT_CONF_MIN,
  PREDICT_OPTS,
  ROOT_TRACK_ID,
  SMOOTH,
  TICK_MS,
  buildSkeletonParams,
  coverTransform,
  parseColor,
  rootOf,
} from './kettlebellRig';
import type { SkeletonTheme } from './kettlebellRig';

type KettlebellSkeletonWrapperProps = {
  /** The content to draw the rig over (raw input or an already-wrapped variant). */
  children: React.ReactElement;
  data: KettlebellOverlayState;
  resolution: { width: number; height: number };
  /**
   * Every-5th-rep milestone celebration (KbtHudTile.fx): aura color plus the
   * snapshot-relative progress p (0..1). The 10 Hz snapshots gate the
   * envelope; the 60 Hz tick below eases the actual intensity.
   */
  fx?: { color: string; p: number } | null;
  /** Rig palette family; tournament tiles pass 'kbt' (broadcast theme). */
  theme?: SkeletonTheme;
};

/** Aura envelope from snapshot progress: fast attack, ~0.9s fade-out tail. */
function auraTarget(fx: { color: string; p: number } | null | undefined) {
  if (!fx) return 0;
  return Math.max(0, Math.min(1, fx.p / 0.08, (1 - fx.p) / 0.3));
}

/**
 * Wraps `children` in the `kettlebell-skeleton` WGSL shader and drives it with
 * the tracked pose. The shader draws every bone, joint marker and the head
 * circle from one set of coordinates, which is the point: the skeleton used to
 * be Views — a thin bar per bone, rotated to the segment angle — and rotated
 * Views render displaced and oversized on this engine build (the same breakage
 * the duck-hunter crosshair works around), so bones visibly floated off the
 * very dots they connected.
 *
 * The pose is drawn as a RIG: only the root (hip midpoint) is dead-reckoned,
 * and every joint is stored as an offset from it. Predicting each joint
 * separately — as this used to — let them converge at different rates, so
 * limbs stretched and bones drifted off their own dots; sharing one root and
 * one ease keeps the figure coherent while still gliding with the athlete.
 */
export function KettlebellSkeletonWrapper({
  children,
  data,
  resolution,
  fx,
  theme = 'default',
}: KettlebellSkeletonWrapperProps) {
  const { width, height } = resolution;
  const predictorRef = useRef(new MotionPredictor(PREDICT_OPTS));
  // Milestone aura: latest snapshot-derived target + the 60 Hz-eased value.
  const fxRef = useRef(fx ?? null);
  fxRef.current = fx ?? null;
  const auraRef = useRef(0);
  // Latest observed joint offsets from the root, px; null = joint not visible.
  const targetOffsetsRef = useRef<(number[] | null)[]>(
    new Array(JOINT_COUNT).fill(null),
  );
  // Eased, currently-drawn state: offsets per joint plus the root itself.
  const drawnOffsetsRef = useRef<(number[] | null)[]>(
    new Array(JOINT_COUNT).fill(null),
  );
  const drawnRootRef = useRef<number[] | null>(null);
  const [, setTick] = useState(0);

  // Feed each result into the root predictor and refresh the joint offsets.
  useEffect(() => {
    const { offX, offY, dispW, dispH } = coverTransform(
      { width, height },
      data.frameW,
      data.frameH,
    );
    const now = Date.now();
    const px: (number[] | null)[] = (data.kpts ?? []).map((k) =>
      k[2] >= KPT_CONF_MIN ? [offX + k[0] * dispW, offY + k[1] * dispH] : null,
    );
    const root = data.kpts ? rootOf(px) : null;
    if (root) {
      predictorRef.current.update(ROOT_TRACK_ID, root, now);
      targetOffsetsRef.current = targetOffsetsRef.current.map((_, i) => {
        const p = px[i];
        return p ? [p[0] - root[0], p[1] - root[1]] : null;
      });
    } else {
      // Forget the pose outright. Kept state would otherwise be reused when it
      // reappears — a stale position eased across the frame and, worse, a
      // velocity estimated over the whole dropout.
      predictorRef.current.forget(ROOT_TRACK_ID);
      targetOffsetsRef.current.fill(null);
      drawnOffsetsRef.current.fill(null);
      drawnRootRef.current = null;
    }
  }, [data, width, height]);

  // Every tick, ease the root toward its predicted position and each joint
  // offset toward its latest observed one — one shared rate for the whole rig.
  useEffect(() => {
    const ease = (cur: number[], tgt: number[]) => {
      for (let i = 0; i < tgt.length; i++) {
        cur[i] += (tgt[i] - cur[i]) * SMOOTH;
      }
    };
    const timer = setInterval(() => {
      const now = Date.now();
      const target = auraTarget(fxRef.current);
      const auraLive = auraRef.current > 0.005 || target > 0;
      if (auraLive) {
        auraRef.current += (target - auraRef.current) * 0.15;
        if (auraRef.current < 0.005 && target === 0) auraRef.current = 0;
      }
      const root = predictorRef.current.predict(ROOT_TRACK_ID, now);
      if (root) {
        if (!drawnRootRef.current) drawnRootRef.current = [...root];
        else ease(drawnRootRef.current, root);
        for (let i = 0; i < targetOffsetsRef.current.length; i++) {
          const tgt = targetOffsetsRef.current[i];
          const cur = drawnOffsetsRef.current[i];
          if (!tgt) drawnOffsetsRef.current[i] = null;
          else if (!cur) drawnOffsetsRef.current[i] = [...tgt];
          else ease(cur, tgt);
        }
      } else if (!drawnRootRef.current && !auraLive) {
        // No pose tracked, none on screen and no aura fading — skip the tick
        // rather than re-serializing an unchanged scene 60 times a second.
        return;
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const root = drawnRootRef.current;
  const joints = drawnOffsetsRef.current.map((off) =>
    root && off ? [root[0] + off[0], root[1] + off[1]] : null,
  );
  const auraColor = parseColor(fx?.color ?? '#FFFFFF');
  const params = buildSkeletonParams(
    joints,
    // 'off' keeps the shader mounted with the rig invisible — the tournament
    // mounts this wrapper for the aura even when the skeleton is disabled.
    data.skeleton === 'off'
      ? 'off'
      : data.skeleton === 'neon'
        ? 'neon'
        : 'lines',
    { width, height },
    {
      r: auraColor.r,
      g: auraColor.g,
      b: auraColor.b,
      i: auraRef.current,
    },
    theme,
  );

  return (
    <Shader
      shaderId='kettlebell-skeleton'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      {/* Shader children must have a known size — a sized View makes that
          hold for any content (e.g. the raw stream's auto-sized Rescaler). */}
      <View style={{ width, height }}>{children}</View>
    </Shader>
  );
}
