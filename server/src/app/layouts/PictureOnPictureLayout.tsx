import { View, Rescaler } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext, useResolution } from '../store';
import { Input } from '../../inputs/inputs';

export function PictureOnPictureLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);
  const resolution = useResolution();
  const { width, height } = resolution;

  if (!inputs.length) {
    return <View />;
  }

  return (
    <View style={{ width, height, direction: 'column', overflow: 'visible' }}>
      {inputs.map((input) => (
        <Rescaler
          key={input.inputId}
          style={{
            width,
            height,
            top: 0,
            left: 0,
          }}>
          <Input input={input} />
        </Rescaler>
      ))}
    </View>
  );
}
