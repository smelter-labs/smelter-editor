import {
  OB_PRESET_META,
  OB_PRESET_RULESETS,
  type ObPresetId,
  type ObPresetMeta,
} from '@smelter-editor/types';
import { formatSeconds } from './pacing';
import { TRANSITION_LABEL } from './view-labels';

// The four preset cards on SETUP: the shared meta plus what the ruleset
// actually contains (rule count, hold window, default transition).

export type PresetCard = ObPresetMeta & {
  rules: number;
  hold: string;
  transition: string;
};

export function presetCards(): PresetCard[] {
  return OB_PRESET_META.map((meta) => {
    const rs = OB_PRESET_RULESETS[meta.id];
    return {
      ...meta,
      rules: rs.rules.length,
      hold: `${formatSeconds(rs.pacing.minHoldMs)}–${formatSeconds(rs.pacing.maxHoldMs)}`,
      transition: TRANSITION_LABEL[rs.pacing.transition],
    };
  });
}

export function presetLabel(id: ObPresetId): string {
  if (id === 'custom') return 'CUSTOM';
  return OB_PRESET_META.find((m) => m.id === id)?.label ?? id.toUpperCase();
}
