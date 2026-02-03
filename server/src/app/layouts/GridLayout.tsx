import { Tiles } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution, useIsVertical } from '../store';
import { Input } from '../../inputs/inputs';

export function GridLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const isVertical = useIsVertical();

  const tileAspectRatio = isVertical 
    ? `${resolution.width}:${Math.round(resolution.width * 0.63)}` 
    : `${resolution.width}:${Math.round(resolution.width * 0.63)}`;

  return (
    <Tiles transition={{ durationMs: 300 }} style={{ padding: 20, tileAspectRatio }}>
      {Object.values(inputs).map(input => (
        <Input key={input.inputId} input={input} />
      ))}
    </Tiles>
  );
}
