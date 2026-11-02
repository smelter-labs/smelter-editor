/**
 * Aurora studio theme for AI PANEL puppets: one accent palette per panelist
 * drives the shader wall ribbons, the desk accent bar, the subtitle colour
 * and the speaking glow. The glow PNGs (`ob-puppet-panel-glow-<id>-<1..3>`)
 * are pre-rendered by scripts/ob-puppet-assets.mjs, which duplicates these
 * hexes — KEEP THE TWO TABLES IN SYNC.
 */
import type { PanelAccentId, PuppetCharacterId } from './types';

export type PanelAccent = {
  /** Main accent: aurora ribbon 1, horizon light, desk bar, subtitle. */
  accent: string;
  /** Secondary cool tone: aurora ribbon 2, key light. */
  accent2: string;
};

export const PANEL_ACCENTS: Record<PanelAccentId, PanelAccent> = {
  coral: { accent: '#E8907A', accent2: '#5F55C9' },
  teal: { accent: '#4FD6B8', accent2: '#6E5BD6' },
};

/** Default palette per character (nova = OPUS → coral, bit = GPT → teal). */
export function defaultPanelAccent(
  character: PuppetCharacterId | 'studio',
): PanelAccentId {
  return character === 'bit' ? 'teal' : 'coral';
}

/** Stable per-cam time offset so two studios never animate in sync. */
export function panelPhase(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 628) / 10; // 0..62.8 s of shader-time offset
}
