import { Tiles } from '@swmansion/smelter';
import React from 'react';
import { useResolution, useIsVertical, useLayoutInputs } from '../store';
import { Input } from '../../inputs/inputs';

export function GridLayout() {
  const inputs = useLayoutInputs();
  const resolution = useResolution();
  const isVertical = useIsVertical();

  const tileAspectRatio = isVertical
    ? `${resolution.width}:${Math.round(resolution.width * 0.63)}`
    : `${resolution.width}:${Math.round(resolution.width * 0.63)}`;

  return (
    <Tiles
      transition={{ durationMs: 300 }}
      style={{ padding: 20, tileAspectRatio }}>
      {Object.values(inputs).map((input) => (
        <Input key={input.inputId} input={input} />
      ))}
    </Tiles>
  );
}
