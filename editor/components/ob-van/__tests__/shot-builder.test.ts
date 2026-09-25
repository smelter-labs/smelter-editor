import { describe, expect, it } from 'vitest';
import {
  OB_DEFAULT_CONFIG,
  obPresetRuleset,
  type ObShot,
  type ObShotKind,
} from '@smelter-editor/types';
import {
  buildShotOptions,
  quadCams,
  sortCams,
  type ShotCam,
  type ShotContext,
} from '../panel/shot-builder';
import { autopilotStatus, isReplayEnabled } from '../panel/panel-model';

const cams: ShotCam[] = [
  { id: 'w', number: 1, role: 'wide', live: true },
  { id: 's', number: 2, role: 'speaker', live: true },
  { id: 'g', number: 3, role: 'guest', live: true },
  { id: 'x', number: 5, role: 'slides', live: true },
  { id: 'a', number: 4, role: 'audience', live: false },
  { id: 'z', number: 6, role: 'stage-left', live: true },
];

function shotOf(ctx: ShotContext, kind: ObShotKind): ObShot | null {
  const o = buildShotOptions(ctx).find((x) => x.kind === kind);
  if (!o) throw new Error(`no option ${kind}`);
  return o.shot;
}

const base: ShotContext = {
  cams,
  preview: { kind: 'solo', cam: 's' },
  program: { kind: 'solo', cam: 'w' },
};

describe('buildShotOptions', () => {
  it('offers the seven shot kinds in bar order', () => {
    expect(buildShotOptions(base).map((o) => o.kind)).toEqual([
      'solo',
      'split',
      'pip',
      'quad',
      'grid',
      'speaker-slides',
      'virtual',
    ]);
  });
  it('SOLO is the preview main camera', () => {
    expect(shotOf(base, 'solo')).toEqual({ kind: 'solo', cam: 's' });
    expect(shotOf({ ...base, preview: null }, 'solo')).toBeNull();
  });
  it('SPLIT and PIP pair preview with program', () => {
    expect(shotOf(base, 'split')).toEqual({ kind: 'split', cams: ['s', 'w'] });
    expect(shotOf(base, 'pip')).toEqual({ kind: 'pip', main: 's', inset: 'w' });
  });
  it('SPLIT and PIP are disabled when preview and program are the same camera', () => {
    const same = { ...base, preview: { kind: 'solo', cam: 'w' } as ObShot };
    expect(shotOf(same, 'split')).toBeNull();
    expect(shotOf(same, 'pip')).toBeNull();
    expect(shotOf({ ...base, program: null }, 'split')).toBeNull();
  });
  it('QUAD takes four live cameras with the preview first', () => {
    expect(shotOf(base, 'quad')).toEqual({
      kind: 'quad',
      cams: ['s', 'w', 'g', 'x'],
    });
  });
  it('GRID is every live camera', () => {
    expect(shotOf(base, 'grid')).toEqual({ kind: 'grid', cams: [] });
    const one: ShotContext = { ...base, cams: [cams[0]] };
    expect(shotOf(one, 'grid')).toBeNull();
    expect(shotOf(one, 'quad')).toBeNull();
  });
  it('SLIDES pairs the slides camera with the preview', () => {
    expect(shotOf(base, 'speaker-slides')).toEqual({
      kind: 'speaker-slides',
      speaker: 's',
      slides: 'x',
    });
  });
  it('SLIDES falls back to program when the preview is the slides camera', () => {
    const pvSlides = { ...base, preview: { kind: 'solo', cam: 'x' } as ObShot };
    expect(shotOf(pvSlides, 'speaker-slides')).toEqual({
      kind: 'speaker-slides',
      speaker: 'w',
      slides: 'x',
    });
  });
  it('SLIDES is disabled without a slides camera', () => {
    const noSlides = { ...base, cams: cams.filter((c) => c.role !== 'slides') };
    expect(shotOf(noSlides, 'speaker-slides')).toBeNull();
  });
  it('VIRTUAL only for a wide camera on preview', () => {
    expect(shotOf(base, 'virtual')).toBeNull();
    const wide = { ...base, preview: { kind: 'solo', cam: 'w' } as ObShot };
    expect(shotOf(wide, 'virtual')).toEqual({
      kind: 'virtual',
      cam: 'w',
      target: 'speaker',
    });
  });
  it('every disabled option explains why', () => {
    for (const o of buildShotOptions({
      cams: [],
      preview: null,
      program: null,
    }))
      expect(o.shot == null && o.why.length > 0).toBe(true);
  });
});

describe('quadCams / sortCams', () => {
  it('skips dark cameras and a dark lead', () => {
    expect(quadCams(cams, 'a')).toEqual(['w', 's', 'g', 'x']);
    expect(quadCams(cams, null)).toEqual(['w', 's', 'g', 'x']);
  });
  it('sorts by bus number', () => {
    expect(sortCams(cams).map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('autopilotStatus', () => {
  it('OFF / ON / PAUSED with seconds left', () => {
    expect(autopilotStatus({ on: false, pausedUntilMs: 5000 }, 0)).toEqual({
      kind: 'off',
    });
    expect(autopilotStatus({ on: true, pausedUntilMs: null }, 0)).toEqual({
      kind: 'on',
    });
    expect(autopilotStatus({ on: true, pausedUntilMs: 4200 }, 1000)).toEqual({
      kind: 'paused',
      resumesInS: 4,
    });
    expect(autopilotStatus({ on: true, pausedUntilMs: 900 }, 1000)).toEqual({
      kind: 'on',
    });
  });
});

describe('isReplayEnabled', () => {
  it('match preset or a burst-replay ruleset', () => {
    const talk = obPresetRuleset('talk');
    expect(
      isReplayEnabled({
        config: { ...OB_DEFAULT_CONFIG, presetId: 'match' },
        ruleset: talk,
      }),
    ).toBe(true);
    expect(
      isReplayEnabled({
        config: OB_DEFAULT_CONFIG,
        ruleset: {
          ...talk,
          behaviours: { ...talk.behaviours, burstReplay: false },
        },
      }),
    ).toBe(false);
    expect(
      isReplayEnabled({
        config: OB_DEFAULT_CONFIG,
        ruleset: { ...talk, behaviours: { burstReplay: true } },
      }),
    ).toBe(true);
  });
});
