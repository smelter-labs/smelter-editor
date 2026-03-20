export const AUDIO_BAND_COUNT = 16;
export type AudioBands = number[];

export type EqualizerStyle = 'bars' | 'bars-rounded';

export type EqualizerConfig = {
  barCount?: number;
  style?: EqualizerStyle;
  barColor?: string;
  glowIntensity?: number;
  bgOpacity?: number;
  gap?: number;
  smoothing?: number;
};
