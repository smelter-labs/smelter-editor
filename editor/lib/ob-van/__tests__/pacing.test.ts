import { describe, expect, it } from 'vitest';
import { obPresetRuleset, OB_DEFAULT_CONFIG } from '@smelter-editor/types';
import {
  clampAnalystIntervalS,
  clampResumeAfterMs,
  dialHold,
  effectiveHold,
  formatClock,
  formatSeconds,
  secondsUntil,
} from '../pacing';

describe('pacing', () => {
  const talk = obPresetRuleset('talk');

  it('the dial multiplies the ruleset hold, clamped to the limits', () => {
    expect(dialHold(talk, 'lively')).toEqual({
      minHoldMs: talk.pacing.minHoldMs,
      maxHoldMs: talk.pacing.maxHoldMs,
    });
    expect(dialHold(talk, 'calm').minHoldMs).toBe(
      Math.round(talk.pacing.minHoldMs * 1.6),
    );
    const tiny = { pacing: { ...talk.pacing, minHoldMs: 600 } };
    expect(dialHold(tiny, 'frantic').minHoldMs).toBe(500);
  });

  it('an operator override beats the dial', () => {
    const base = {
      ruleset: talk,
      config: { ...OB_DEFAULT_CONFIG, pacingDial: 'calm' as const },
      overrides: { pacing: { minHoldMs: 1234 }, preferCam: null },
    };
    const hold = effectiveHold(base);
    expect(hold.minHoldMs).toBe(1234);
    expect(hold.overridden).toBe(true);
    expect(hold.maxHoldMs).toBe(dialHold(talk, 'calm').maxHoldMs);
  });

  it('clamps resume-after and the analyst interval to the UI ranges', () => {
    expect(clampResumeAfterMs(1000)).toBe(5000);
    expect(clampResumeAfterMs(90000)).toBe(60000);
    expect(clampResumeAfterMs(12400)).toBe(12000);
    expect(clampResumeAfterMs('x')).toBe(20000);
    expect(clampAnalystIntervalS(5)).toBe(10);
    expect(clampAnalystIntervalS(500)).toBe(120);
    expect(clampAnalystIntervalS(null)).toBe(15);
  });

  it('countdowns and labels', () => {
    expect(secondsUntil(null, 0)).toBeNull();
    expect(secondsUntil(2500, 1000)).toBe(2);
    expect(secondsUntil(500, 1000)).toBe(0);
    expect(formatSeconds(2500)).toBe('2.5 s');
    expect(formatSeconds(12000)).toBe('12 s');
    expect(formatSeconds(65000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(59_000)).toBe('0:59');
  });
});
