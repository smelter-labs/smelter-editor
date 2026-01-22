import { View, Rescaler } from '@swmansion/smelter';
import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { StoreContext } from '../store';
import { Input } from '../../inputs/inputs';

export function PictureOnPictureLayout() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, state => state.inputs);

  if (!inputs.length) {
    return <View />;
  }

  return (
    <View style={{ width: 2560, height: 1440, direction: 'column', overflow: 'visible' }}>
      {inputs.map((input) => (
        <Rescaler
          key={input.inputId}
          style={{
            width: 2560,
            height: 1440,
            top: 0,
            left: 0,
          }}>
          <Input input={input} />
        </Rescaler>
      ))}
    </View>
  );
}
