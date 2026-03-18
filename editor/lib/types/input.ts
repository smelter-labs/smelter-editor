import type { PublicInputState } from '@smelter-editor/types';

export type { InputOrientation } from '@smelter-editor/types';
export type { UpdateInputOptions, RegisterInputOptions } from '@smelter-editor/types';

export type Input = PublicInputState & { id: number };
