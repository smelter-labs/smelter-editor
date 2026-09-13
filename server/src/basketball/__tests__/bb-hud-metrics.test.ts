import { describe, expect, it } from 'vitest';
import {
  ballDotRect,
  clockFace,
  coverTransform,
  monoWidth,
  pipFrameOrigin,
  rimOverlayRect,
  tagChipRect,
  zoneBandRects,
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

describe('bbHudMetrics — AI overlay geometry', () => {
  const r = (p: { x: number; y: number; w: number; h: number }) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
    w: Math.round(p.w),
    h: Math.round(p.h),
  });

  it('cover-fits a 4:3 frame into a 16:9 tile with centred overflow', () => {
    const disp = coverTransform({ w: 1920, h: 1080 }, 4 / 3);
    expect(r(disp)).toEqual({ x: 0, y: -180, w: 1920, h: 1440 });
    // same aspect → identity
    expect(r(coverTransform({ w: 480, h: 270 }, 16 / 9))).toEqual({
      x: 0,
      y: 0,
      w: 480,
      h: 270,
    });
    // portrait phone in a landscape tile: height covers, width overflows
    expect(r(coverTransform({ w: 480, h: 270 }, 9 / 16))).toEqual({
      x: 0,
      y: -292,
      w: 480,
      h: 853,
    });
    expect(coverTransform({ w: 100, h: 50 }, 0).w).toBe(100);
  });

  it('maps the demo hoop rim (cam7) into the PiP', () => {
    const rim = { cx: 0.222, cy: 0.178, rx: 0.02, ry: 0.007 };
    const disp = coverTransform({ w: 480, h: 270 }, 16 / 9);
    expect(r(rimOverlayRect(disp, rim))).toEqual({ x: 96, y: 46, w: 22, h: 4 });
    const bands = zoneBandRects(disp, rim, 16 / 9);
    // above band: 2.5 rx wide either side, 5 rx (in y units) tall, ends on cy
    expect(r(bands.above)).toEqual({ x: 83, y: 0, w: 48, h: 48 });
    expect(bands.above.y + bands.above.h).toBeCloseTo(0.178 * 270, 5);
    // net band hangs from the rim's lower edge
    expect(r(bands.net)).toEqual({ x: 93, y: 50, w: 27, h: 19 });
    expect(bands.net.y).toBeCloseTo((0.178 + 0.007) * 270, 5);
  });

  it('draws the ball as a centred square no smaller than minPx', () => {
    const disp = coverTransform({ w: 480, h: 270 }, 16 / 9);
    const tiny = ballDotRect(disp, { x: 0.5, y: 0.5, w: 0.005, h: 0.005 }, 8);
    expect(r(tiny)).toEqual({ x: 237, y: 132, w: 8, h: 8 });
    const big = ballDotRect(disp, { x: 0.1, y: 0.1, w: 0.1, h: 0.05 }, 8);
    expect(r(big)).toEqual({ x: 48, y: 10, w: 48, h: 48 });
  });
});
