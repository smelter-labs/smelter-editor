import React, { useState, useEffect, useRef } from 'react';
import { Shader } from '@swmansion/smelter';
import type { ShaderParamStructField } from '@swmansion/smelter';
import type { ActiveTransition } from '../types';

type Resolution = { width: number; height: number };

const FRAME_INTERVAL_MS = 33; // ~30fps

function transitionShaderId(type: ActiveTransition['type']): string {
  switch (type) {
    case 'fade':
      return 'opacity';
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
    case 'slide-down':
      return 'transition-slide';
    case 'wipe-left':
    case 'wipe-right':
      return 'transition-wipe';
    case 'dissolve':
      return 'transition-dissolve';
  }
}

function slideDirection(type: ActiveTransition['type']): number {
  switch (type) {
    case 'slide-left':
      return 0;
    case 'slide-right':
      return 1;
    case 'slide-up':
      return 2;
    case 'slide-down':
      return 3;
    default:
      return 0;
  }
}

function wipeDirection(type: ActiveTransition['type']): number {
  switch (type) {
    case 'wipe-left':
      return 0;
    case 'wipe-right':
      return 1;
    default:
      return 0;
  }
}

function buildShaderParams(
  type: ActiveTransition['type'],
  progress: number,
): ShaderParamStructField[] {
  const shaderId = transitionShaderId(type);

  if (shaderId === 'opacity') {
    return [
      {
        type: 'f32',
        fieldName: 'opacity',
        value: progress,
      } as ShaderParamStructField,
    ];
  }

  if (shaderId === 'transition-slide') {
    return [
      {
        type: 'f32',
        fieldName: 'progress',
        value: progress,
      } as ShaderParamStructField,
      {
        type: 'f32',
        fieldName: 'direction',
        value: slideDirection(type),
      } as ShaderParamStructField,
    ];
  }

  if (shaderId === 'transition-wipe') {
    return [
      {
        type: 'f32',
        fieldName: 'progress',
        value: progress,
      } as ShaderParamStructField,
      {
        type: 'f32',
        fieldName: 'direction',
        value: wipeDirection(type),
      } as ShaderParamStructField,
    ];
  }

  // dissolve
  return [
    {
      type: 'f32',
      fieldName: 'progress',
      value: progress,
    } as ShaderParamStructField,
  ];
}

/**
 * Shader progress for a transition at wall time `nowMs`: 0→1 for `in`, 1→0
 * for `out`, clamped to the transition window. Pure — the wrapper derives its
 * first frame from it, so no intermediate value can reach the compositor.
 */
export function transitionProgress(
  transition: Pick<
    ActiveTransition,
    'startedAtMs' | 'durationMs' | 'direction'
  >,
  nowMs: number,
): number {
  const { startedAtMs, durationMs, direction } = transition;
  const raw =
    durationMs <= 0
      ? 1
      : Math.min(1, Math.max(0, (nowMs - startedAtMs) / durationMs));
  return direction === 'out' ? 1 - raw : raw;
}

/**
 * The progress is computed in the render body, not in an effect: smelter-core
 * ships the scene from `resetAfterCommit`, i.e. BEFORE any effect runs, and
 * the first update after an idle period goes out immediately. A state seeded
 * with a constant (the old `useState(0)`) therefore aired one frame with the
 * wrong opacity — an outgoing element blinked off and back on, an incoming
 * one re-used a stale value. The interval below only forces re-renders.
 */
export function TransitionShaderWrapper({
  transition,
  resolution,
  children,
}: {
  transition: ActiveTransition;
  resolution: Resolution;
  children: React.ReactElement;
}) {
  const [, setTick] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { startedAtMs, durationMs, direction } = transition;

  useEffect(() => {
    const endsAt = startedAtMs + durationMs;
    const tick = () => {
      setTick((t) => t + 1);
      if (Date.now() >= endsAt && intervalRef.current) {
        // Landed on the final value — nothing left to animate.
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    intervalRef.current = setInterval(tick, FRAME_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startedAtMs, durationMs, direction]);

  const progress = transitionProgress(transition, Date.now());
  const shaderId = transitionShaderId(transition.type);
  const shaderParams = buildShaderParams(transition.type, progress);

  return (
    <Shader
      shaderId={shaderId}
      resolution={resolution}
      shaderParam={
        shaderParams.length > 0
          ? { type: 'struct', value: shaderParams }
          : undefined
      }>
      {children}
    </Shader>
  );
}
