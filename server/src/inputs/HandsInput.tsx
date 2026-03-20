import React from 'react';
import { useStore } from 'zustand';
import { Shader, InputStream, Rescaler } from '@swmansion/smelter';
import type { StoreApi } from 'zustand';
import type { HandsStore } from '../hands/handStore';

type HandsInputProps = {
  sourceInputId: string;
  handsStore: StoreApi<HandsStore>;
  resolution: { width: number; height: number };
  volume: number;
};

export function HandsInput({
  sourceInputId,
  handsStore,
  resolution,
  volume,
}: HandsInputProps) {
  const landmarks = useStore(handsStore, (s) => s.landmarks);

  const params: Array<{ type: 'f32'; fieldName: string; value: number }> = [];

  const h1 = landmarks?.hands?.[0];
  params.push({ type: 'f32', fieldName: 'h1_valid', value: h1 ? 1.0 : 0.0 });
  for (let i = 0; i < 21; i++) {
    const lm = h1?.landmarks?.[i];
    params.push({
      type: 'f32',
      fieldName: `h1_x${i}`,
      value: lm?.x ?? 0,
    });
    params.push({
      type: 'f32',
      fieldName: `h1_y${i}`,
      value: lm?.y ?? 0,
    });
  }

  const h2 = landmarks?.hands?.[1];
  params.push({ type: 'f32', fieldName: 'h2_valid', value: h2 ? 1.0 : 0.0 });
  for (let i = 0; i < 21; i++) {
    const lm = h2?.landmarks?.[i];
    params.push({
      type: 'f32',
      fieldName: `h2_x${i}`,
      value: lm?.x ?? 0,
    });
    params.push({
      type: 'f32',
      fieldName: `h2_y${i}`,
      value: lm?.y ?? 0,
    });
  }

  // Style params
  params.push({ type: 'f32', fieldName: 'glow', value: 1.0 });
  params.push({ type: 'f32', fieldName: 'line_width', value: 0.008 });
  params.push({ type: 'f32', fieldName: 'dim', value: 0.6 });
  // Cyan primary
  params.push({ type: 'f32', fieldName: 'color1_r', value: 0.0 });
  params.push({ type: 'f32', fieldName: 'color1_g', value: 1.0 });
  params.push({ type: 'f32', fieldName: 'color1_b', value: 1.0 });
  // Magenta secondary
  params.push({ type: 'f32', fieldName: 'color2_r', value: 1.0 });
  params.push({ type: 'f32', fieldName: 'color2_g', value: 0.0 });
  params.push({ type: 'f32', fieldName: 'color2_b', value: 1.0 });

  return (
    <Shader
      shaderId="cyberpunk-hands"
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      <Rescaler style={{ rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
    </Shader>
  );
}
