import {
  RESOLUTION_PRESETS,
  type Resolution,
  type ResolutionPreset,
} from '@smelter-editor/types';

export type { Resolution, ResolutionPreset } from '@smelter-editor/types';
export { RESOLUTION_PRESETS } from '@smelter-editor/types';

export function resolutionToLabel(resolution: Resolution): string {
  const match = (
    Object.entries(RESOLUTION_PRESETS) as [ResolutionPreset, Resolution][]
  ).find(
    ([, preset]) =>
      preset.width === resolution.width && preset.height === resolution.height,
  );
  if (match) return match[0];
  return `${resolution.width}x${resolution.height}`;
}
