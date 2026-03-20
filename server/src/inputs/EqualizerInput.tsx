import { useContext } from 'react';
import { useStore } from 'zustand';
import { Shader, View } from '@swmansion/smelter';
import { AudioStoreContext } from '../audio/AudioStoreContext';
import type { InputConfig } from '../app/store';
import { AUDIO_BAND_COUNT } from '../types';

const EMPTY_BANDS = new Array(AUDIO_BAND_COUNT).fill(0);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

type EqualizerInputProps = {
  input: InputConfig;
  resolution: { width: number; height: number };
};

export function EqualizerInput({ input, resolution }: EqualizerInputProps) {
  const audioStore = useContext(AudioStoreContext);
  const bands = useStore(audioStore!, (s) => s.bands) ?? EMPTY_BANDS;

  const cfg = input.equalizerConfig;
  const [r, g, b] = hexToRgb(cfg?.barColor ?? '#33ccff');
  const barCount = cfg?.barCount ?? 16;
  const gap = cfg?.gap ?? 0.2;
  const glow = cfg?.glowIntensity ?? 0.5;
  const bgOpacity = cfg?.bgOpacity ?? 0.8;
  const smoothing = cfg?.smoothing ?? 0.3;

  const shaderParam = {
    type: 'struct' as const,
    value: [
      ...bands.map((v: number, i: number) => ({
        type: 'f32' as const,
        fieldName: `band_${i}`,
        value: v,
      })),
      { type: 'f32' as const, fieldName: 'bar_color_r', value: r },
      { type: 'f32' as const, fieldName: 'bar_color_g', value: g },
      { type: 'f32' as const, fieldName: 'bar_color_b', value: b },
      { type: 'f32' as const, fieldName: 'bg_opacity', value: bgOpacity },
      { type: 'f32' as const, fieldName: 'glow', value: glow },
      { type: 'f32' as const, fieldName: 'gap', value: gap },
      { type: 'f32' as const, fieldName: 'bar_count', value: barCount },
      { type: 'f32' as const, fieldName: 'smoothing', value: smoothing },
    ],
  };

  return (
    <Shader
      shaderId='equalizer'
      resolution={resolution}
      shaderParam={shaderParam}>
      <View style={{ ...resolution, backgroundColor: '#000000' }} />
    </Shader>
  );
}
