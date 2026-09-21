import { describe, expect, it, vi } from 'vitest';
import { FB_DEFAULT_CONFIG, type FbConfig } from '@smelter-editor/types';
import {
  DEFAULT_FB_UI_CONFIG,
  sanitizeReplayDelay,
  serverConfigToUi,
  uiConfigToPatch,
} from '../use-fb-room';

// The hook module pulls in the server actions; only its pure helpers run here.
vi.mock('@/app/actions/actions', () => ({}));

describe('host UI config ↔ server config', () => {
  it('round-trips the server defaults', () => {
    const ui = serverConfigToUi(structuredClone(FB_DEFAULT_CONFIG), '1080p');
    expect(ui.halfMin).toBe(45);
    expect(ui.resolution).toBe('1080p');
    const patch = uiConfigToPatch(ui);
    const { teams, halfMs, perf, director, ai, ...flags } = patch;
    expect(halfMs).toBe(FB_DEFAULT_CONFIG.halfMs);
    expect(teams).toEqual(FB_DEFAULT_CONFIG.teams);
    expect(perf).toEqual(FB_DEFAULT_CONFIG.perf);
    expect(director).toEqual(FB_DEFAULT_CONFIG.director);
    expect(ai).toEqual(FB_DEFAULT_CONFIG.ai);
    expect(flags).toEqual({
      clockFromClip: true,
      attacksLeft: null,
      autoFlow: false,
      replayDelayMs: 1500,
      replay: true,
      minimap: true,
    });
  });

  it('carries the host knobs the server understands', () => {
    const patch = uiConfigToPatch({
      ...DEFAULT_FB_UI_CONFIG,
      halfMin: 5,
      autoFlow: true,
      replayDelayMs: 0,
      attacksLeft: 'B',
    });
    expect(patch).toMatchObject({
      halfMs: 300_000,
      autoFlow: true,
      replayDelayMs: 0,
      attacksLeft: 'B',
    });
  });

  it('tolerates a server config from before autoFlow existed', () => {
    const old = structuredClone(FB_DEFAULT_CONFIG) as Partial<FbConfig>;
    delete old.autoFlow;
    delete old.replayDelayMs;
    const ui = serverConfigToUi(old as FbConfig, '720p');
    expect(ui.autoFlow).toBe(false);
    expect(ui.replayDelayMs).toBe(1500);
  });

  it('snaps the replay delay to the stepper grid', () => {
    expect(sanitizeReplayDelay(1240)).toBe(1000);
    expect(sanitizeReplayDelay(9000)).toBe(5000);
    expect(sanitizeReplayDelay(-1)).toBe(0);
    expect(sanitizeReplayDelay('soon')).toBe(1500);
  });
});
