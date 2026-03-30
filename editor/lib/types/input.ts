import type { PublicInputState } from '@smelter-editor/types';

export type {
  UpdateInputOptions,
  RegisterInputOptions,
} from '@smelter-editor/types';
export type { AudioBands } from '@smelter-editor/types';
export { AUDIO_BAND_COUNT } from '@smelter-editor/types';

export type Input = PublicInputState & { id: number };
