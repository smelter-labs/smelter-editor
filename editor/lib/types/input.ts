import type {
  PublicInputState,
  RegisterInputOptions,
} from '@smelter-editor/types';

export type {
  UpdateInputOptions,
  RegisterInputOptions,
} from '@smelter-editor/types';
export type Input = PublicInputState & { id: number };
export type CameraInputOptions = Pick<
  Extract<RegisterInputOptions, { type: 'whip' }>,
  'orientation' | 'nativeWidth' | 'nativeHeight'
>;
