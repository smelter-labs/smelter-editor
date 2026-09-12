import { describe, expect, it } from 'vitest';
import {
  clockFace,
  monoWidth,
  pipFrameOrigin,
  tagChipRect,
} from '../../inputs/bbHudMetrics';

const fmt = (ms: number) => {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

describe('bbHudMetrics', () => {
  it('tag chips hug Plex Mono text and centre on the clock cell', () => {
    expect(monoWidth('REG', 11)).toBeCloseTo(19.8);
    const r = tagChipRect('REG', 11, 459, 58, 16);
    expect(r).toEqual({ x: 441, y: 58, w: 36, h: 16 });
    const wide = tagChipRect('FIRST TO +2', 11, 459, 58, 16);
    expect(wide.w).toBe(89);
    expect(Math.abs(wide.x + wide.w / 2 - 459)).toBeLessThanOrEqual(1);
  });

  it('anchors the 496×320 frame 8/42 px outside the PiP window', () => {
    // 1080p: bbPipRect margin 56 → video at (1384, 754)
    expect(pipFrameOrigin({ x: 1384, y: 754 }, 1)).toEqual({ x: 1376, y: 712 });
    // 720p: same design px after dividing by k
    expect(pipFrameOrigin({ x: 922.67, y: 502.67 }, 2 / 3)).toEqual({
      x: 1376,
      y: 712,
    });
  });

  it('maps every clock phase to the design’s five states', () => {
    const base = { period: 'reg' as const, remainingMs: 372_000 };
    expect(clockFace({ ...base, phase: 'live' }, 2, null, fmt)).toEqual({
      main: '6:12',
      mainColor: 'chalk',
      tag: 'REG',
      tagTone: 'electric',
    });
    expect(
      clockFace({ ...base, phase: 'live', remainingMs: 7_000 }, 2, null, fmt)
        .mainColor,
    ).toBe('bad');
    expect(clockFace({ ...base, phase: 'paused' }, 2, null, fmt)).toMatchObject(
      { mainColor: 'amber', tag: 'PAUSED', tagTone: 'amber' },
    );
    expect(
      clockFace({ ...base, phase: 'overtime', period: 'ot' }, 3, null, fmt),
    ).toEqual({
      main: 'OT',
      mainColor: 'electric',
      tag: 'FIRST TO +3',
      tagTone: 'electric',
    });
    expect(
      clockFace({ ...base, phase: 'ended', period: 'ot' }, 2, null, fmt),
    ).toMatchObject({ main: 'FINAL', tag: 'AFTER OT', tagTone: 'chalk' });
    expect(clockFace({ ...base, phase: 'ended' }, 2, null, fmt).tag).toBe(
      'FULL TIME',
    );
    expect(clockFace({ ...base, phase: 'lobby' }, 2, 600_000, fmt)).toEqual({
      main: 'WARM-UP',
      mainColor: 'dim',
      tag: '10:00',
      tagTone: 'outline',
    });
  });
});
