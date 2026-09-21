import type { FbView, FbViewOverride } from '@smelter-editor/types';

export const VIEW_LABEL: Record<FbView, string> = {
  auto: 'AUTO',
  wide: 'WIDE',
  follow: 'FOLLOW',
  'left-goal': 'LEFT GOAL',
  'right-goal': 'RIGHT GOAL',
  left: 'LEFT CAM',
  centre: 'CENTRE CAM',
  right: 'RIGHT CAM',
};

export function overrideFor(view: FbView): FbViewOverride {
  return view === 'auto' ? { mode: 'auto' } : { mode: 'view', view };
}
