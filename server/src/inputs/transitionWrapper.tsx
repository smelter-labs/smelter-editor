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

export function TransitionShaderWrapper({
  transition,
  resolution,
  children,
}: {
  transition: ActiveTransition;
  resolution: Resolution;
  children: React.ReactElement;
}) {
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const { startedAtMs, durationMs, direction } = transition;

    const update = () => {
      const elapsed = Date.now() - startedAtMs;
      const raw = Math.min(1, Math.max(0, elapsed / durationMs));
      setProgress(direction === 'out' ? 1 - raw : raw);
    };

    update();
    intervalRef.current = setInterval(update, FRAME_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [transition.startedAtMs, transition.durationMs, transition.direction]);

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
