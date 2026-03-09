import { Shader } from '@swmansion/smelter';
import React from 'react';

export type NewsStripDecoratedProps = {
  resolution: { width: number; height: number };
  opacity?: number;
  amplitudePx?: number;
  wavelengthPx?: number;
  speed?: number;
  phase?: number;
  removeColorTolerance?: number;
  removeColorEnabled?: boolean;
  children?: React.ReactElement;
};

export function NewsStripDecorated({
  resolution,
  opacity = 0.8,
  amplitudePx = 20,
  wavelengthPx = 800,
  speed = 0,
  phase = 0,
  removeColorTolerance = 0.4,
  removeColorEnabled = true,
  children,
}: NewsStripDecoratedProps) {
  return children;
}
