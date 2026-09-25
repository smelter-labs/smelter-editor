import { describe, expect, it } from 'vitest';
import {
  OB_DEFAULT_CONFIG,
  obPresetRuleset,
  type ObConfig,
} from '@smelter-editor/types';
import {
  DEFAULT_OB_UI_CONFIG,
  sanitizeObUiConfig,
  sanitizeRundown,
  sanitizeTransition,
  serverConfigToUi,
  uiConfigToPatch,
} from '../ui-config';

describe('OB UI config', () => {
  it('garbage becomes the defaults', () => {
    expect(sanitizeObUiConfig(null)).toEqual(DEFAULT_OB_UI_CONFIG);
    expect(sanitizeObUiConfig('x')).toEqual(DEFAULT_OB_UI_CONFIG);
    const out = sanitizeObUiConfig({
      presetId: 'rave',
      pacingDial: 'wild',
      audio: { mode: 'master' },
      autoPilot: { enabled: 'yes', resumeAfterMs: 999999 },
      resolution: '4k',
      lowerThirdMs: 10,
    });
    expect(out.presetId).toBe('talk');
    expect(out.pacingDial).toBe('lively');
    expect(out.audio).toEqual({ mode: 'follow' });
    expect(out.autoPilot).toEqual({ enabled: false, resumeAfterMs: 60000 });
    expect(out.resolution).toBe('1080p');
    expect(out.lowerThirdMs).toBe(1000);
  });

  it('keeps a stored custom ruleset, drops an unreadable one', () => {
    const rs = obPresetRuleset('gig');
    expect(
      sanitizeObUiConfig({ presetId: 'gig', ruleset: rs }).ruleset?.id,
    ).toBe(rs.id);
    expect(sanitizeObUiConfig({ ruleset: 'nope' }).ruleset).toBeNull();
  });

  it('cleans the rundown and the transition', () => {
    const items = sanitizeRundown([
      { id: 'a', title: 'Intro', preset: 'talk' },
      { id: 'a', title: 'Dup id', preset: 'custom' },
      { title: 5 },
      'x',
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'a', title: 'Intro', preset: 'talk' });
    expect(items[1].id).not.toBe('a');
    expect(items[1].preset).toBeUndefined();
    expect(sanitizeTransition({ type: 'wipe', durationMs: 99999 })).toEqual({
      type: 'wipe',
      durationMs: 3000,
    });
    expect(
      sanitizeTransition({ type: 'dip', durationMs: 200, holdMs: 700 }),
    ).toEqual({
      type: 'dip',
      durationMs: 200,
      holdMs: 700,
    });
  });

  it('round-trips the server defaults', () => {
    const cfg: ObConfig = structuredClone(OB_DEFAULT_CONFIG);
    const ui = serverConfigToUi(cfg, {
      record: true,
      resolution: '720p',
      rulesOrigin: 'llm',
    });
    expect(ui.record).toBe(true);
    expect(ui.resolution).toBe('720p');
    const patch = uiConfigToPatch(ui);
    expect(patch).toMatchObject({
      eventName: cfg.eventName,
      presetId: cfg.presetId,
      ruleset: null,
      pacingDial: cfg.pacingDial,
      autoPilot: cfg.autoPilot,
      resumeAfterMs: cfg.resumeAfterMs,
      transition: cfg.transition,
      audio: cfg.audio,
      captions: cfg.captions,
      titleBugVisible: cfg.titleBugVisible,
      lowerThirdMs: cfg.lowerThirdMs,
    });
  });

  it('the patch drops empty segments and never sends a blank event name', () => {
    const patch = uiConfigToPatch({
      ...DEFAULT_OB_UI_CONFIG,
      eventName: '   ',
      rundown: [
        { id: 'a', title: ' ' },
        { id: 'b', title: 'Q&A' },
      ],
    });
    expect(patch.eventName).toBe(OB_DEFAULT_CONFIG.eventName);
    expect(patch.rundown).toEqual([{ id: 'b', title: 'Q&A' }]);
  });
});
