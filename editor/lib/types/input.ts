import type { PublicInputState } from '@smelter-editor/types';

export type { InputOrientation } from '@smelter-editor/types';
export type {
  UpdateInputOptions,
  RegisterInputOptions,
} from '@smelter-editor/types';
export type {
  EqualizerConfig,
  EqualizerStyle,
  AudioBands,
} from '@smelter-editor/types';
export { AUDIO_BAND_COUNT } from '@smelter-editor/types';

export type Input = PublicInputState & { id: number };
