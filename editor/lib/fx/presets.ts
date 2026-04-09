import type { FxConfig } from './types';

export const FX_DEFAULT_HUES = [187, 295, 45, 160];

export const FX_PRESET_IMPORT: FxConfig = {
  layers: {
    dots: true,
    circuits: true,
    pulses: true,
    waves: true,
    sparks: true,
    bolts: true,
  },
  hues: FX_DEFAULT_HUES,
  intensity: 0,
  sparkCount: 60,
  sparkIntensityScale: 90,
  sparkOrigin: 'bottom',
  boltInterval: 0.35,
  boltBurstMax: 5,
  boltComplexity: 'full',
  boltIntensityThreshold: 0.02,
  circuitCount: 28,
  pulseInterval: 0.4,
  waveInterval: 1.0,
  initialSparkCount: 55,
  glowScale: 1,
};

export const FX_PRESET_MODAL: FxConfig = {
  layers: {
    circuits: true,
    pulses: true,
    sparks: true,
    bolts: true,
  },
  hues: FX_DEFAULT_HUES,
  intensity: 0.45,
  sparkCount: 35,
  sparkIntensityScale: 0,
  sparkOrigin: 'bottom',
  boltInterval: 0.9,
  boltBurstMax: 1,
  boltComplexity: 'full',
  boltIntensityThreshold: 0,
  circuitCount: 20,
  pulseInterval: 0.6,
  waveInterval: 2.0,
  initialSparkCount: 20,
  glowScale: 0.8,
};

export const FX_PRESET_DROPDOWN: FxConfig = {
  layers: {
    circuits: true,
  },
  hues: FX_DEFAULT_HUES,
  intensity: 0.3,
  sparkCount: 12,
  sparkIntensityScale: 0,
  sparkOrigin: 'bottom',
  boltInterval: 2.0,
  boltBurstMax: 1,
  boltComplexity: 'full',
  boltIntensityThreshold: 1,
  circuitCount: 12,
  pulseInterval: 1.0,
  waveInterval: 3.0,
  initialSparkCount: 8,
  glowScale: 0.6,
};

export const FX_PRESET_MINI: FxConfig = {
  layers: {
    sparks: true,
    bolts: true,
  },
  hues: [200],
  intensity: 1,
  sparkCount: 8,
  sparkIntensityScale: 0,
  sparkOrigin: 'left',
  boltInterval: 0.6,
  boltBurstMax: 1,
  boltComplexity: 'mini',
  boltIntensityThreshold: 0,
  circuitCount: 0,
  pulseInterval: 1.0,
  waveInterval: 3.0,
  initialSparkCount: 6,
  glowScale: 0.65,
};
