import type { FbCamRole, FbSession } from '@smelter-editor/types';
import type { FbUiConfig } from './use-fb-room';

/**
 * One-press demo: a match preset (teams, kits) plus the demo clips to attach
 * per camera role. The clips live in `server/data/mp4s/fb-demo/` (gitignored;
 * see the module README for how they are cut).
 */
export type FbDemoPreset = {
  id: string;
  /** Button label. */
  label: string;
  /** Second line under the label. */
  sub: string;
  session: FbSession;
  clips: { role: FbCamRole; fileName: string }[];
  teams: FbUiConfig['teams'];
};

const TROMSO = { name: 'TROMSØ', short: 'TIL', color: '#d7263d' };

/** Order = the 1 / 2 / 3 keys on the title screen. */
export const FB_DEMO_PRESETS: FbDemoPreset[] = [
  {
    id: 'tottenham',
    label: 'TROMSØ – TOTTENHAM',
    sub: 'PANORAMA · 6 SHOTS · 120 S LOOP',
    session: 'pano',
    clips: [{ role: 'pano', fileName: 'fb-demo/pano-3x40s/pano.mp4' }],
    teams: {
      A: { ...TROMSO },
      B: { name: 'TOTTENHAM', short: 'TOT', color: '#132257' },
    },
  },
  {
    id: 'anzhi',
    label: 'TROMSØ – ANZHI',
    sub: "PANORAMA · THE REAL GOAL · 90+3'",
    session: 'pano',
    clips: [{ role: 'pano', fileName: 'fb-demo/pano-anzhi-goal/pano.mp4' }],
    teams: {
      A: { ...TROMSO },
      B: { name: 'ANZHI', short: 'ANZ', color: '#1a6b3c' },
    },
  },
  {
    id: 'stromsgodset',
    label: 'TROMSØ – STRØMSGODSET',
    sub: 'THREE CAMERAS · LEFT · CENTRE · RIGHT',
    session: 'tricam',
    clips: [
      { role: 'left', fileName: 'fb-demo/tricam-3min/cam0.mp4' },
      { role: 'centre', fileName: 'fb-demo/tricam-3min/cam1.mp4' },
      { role: 'right', fileName: 'fb-demo/tricam-3min/cam2.mp4' },
    ],
    teams: {
      A: { ...TROMSO },
      B: { name: 'STRØMSGODSET', short: 'SIF', color: '#132257' },
    },
  },
];

/**
 * The preset over the host's current config: teams and the clip-driven
 * fields only, so resolution / perf / director tuning picked for this
 * machine survive.
 */
export function applyDemoPreset(
  cfg: FbUiConfig,
  preset: FbDemoPreset,
): FbUiConfig {
  return {
    ...cfg,
    teams: {
      A: { ...preset.teams.A },
      B: { ...preset.teams.B },
    },
    attacksLeft: null,
    clockFromClip: true,
    halfMin: 45,
  };
}

/** Clips of the preset that the server library does not list. */
export function demoClipsMissing(
  preset: FbDemoPreset,
  library: Iterable<string>,
): string[] {
  const have = new Set(library);
  return preset.clips
    .map((c) => c.fileName)
    .filter((fileName) => !have.has(fileName));
}
