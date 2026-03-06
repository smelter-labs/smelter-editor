import type { ReactElement } from 'react';
import type { InputConfig } from '../app/store';

type Resolution = { width: number; height: number };

export type InputTypeRenderer = (
  config: InputConfig,
  resolution: Resolution,
) => ReactElement;

const renderers = new Map<string, InputTypeRenderer>();

export function registerInputRenderer(
  inputType: string,
  renderer: InputTypeRenderer,
): void {
  renderers.set(inputType, renderer);
}

export function getInputRenderer(
  inputType: string,
): InputTypeRenderer | undefined {
  return renderers.get(inputType);
}
