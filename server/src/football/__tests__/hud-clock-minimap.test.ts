import { describe, expect, it } from 'vitest';
import {
  MINIMAP_PITCH,
  clockFace,
  formatClock,
  minimapLines,
  minimapPoint,
  monoWidth,
  tagChipRect,
} from '../../inputs/fbHudMetrics';

const HALF = 45 * 60_000;
const face = (
  phase: Parameters<typeof clockFace>[0]['phase'],
  period: 1 | 2,
  elapsedMs: number,
) => clockFace({ phase, period, elapsedMs, halfMs: HALF });

describe('score-bug clock face', () => {
  it('formats the match minute', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(61_900)).toBe('1:01');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(90 * 60_000)).toBe('90:00');
  });

  it('pre-match shows the format of the match', () => {
    expect(face('lobby', 1, 0)).toMatchObject({
      main: 'PRE-MATCH',
      tag: "2 × 45'",
    });
  });

  it('counts up through the first half and on from 45:00 in the second', () => {
    expect(face('live', 1, 12 * 60_000 + 41_000)).toMatchObject({
      main: '12:41',
      tag: '1ST HALF',
      tagTone: 'grass',
    });
    expect(face('live', 2, 3 * 60_000)).toMatchObject({
      main: '48:00',
      tag: '2ND HALF',
    });
  });

  it('runs into added time past the half length, in either half', () => {
    expect(face('live', 1, HALF)).toMatchObject({
      main: '45:00',
      mainColor: 'amber',
      tag: "+0' ADDED",
    });
    expect(face('live', 2, HALF + 2 * 60_000 + 30_000)).toMatchObject({
      main: '92:30',
      tag: "+2' ADDED",
    });
  });

  it('paused keeps the minute; the breaks show HT / FT', () => {
    expect(face('paused', 2, 60_000)).toMatchObject({
      main: '46:00',
      tag: 'PAUSED',
      mainColor: 'amber',
    });
    expect(face('halftime', 1, HALF).main).toBe('HT');
    expect(face('ended', 2, HALF).main).toBe('FT');
  });
});

describe('minimap geometry', () => {
  it('maps the pitch corners and the centre spot onto the plate', () => {
    const p = MINIMAP_PITCH;
    expect(minimapPoint(0, 0)).toEqual({ x: p.x, y: p.y });
    expect(minimapPoint(105, 68)).toEqual({ x: p.x + p.w, y: p.y + p.h });
    expect(minimapPoint(52.5, 34)).toEqual({
      x: p.x + p.w / 2,
      y: p.y + p.h / 2,
    });
  });

  it('clamps a wild position to just outside the lines', () => {
    const p = MINIMAP_PITCH;
    const far = minimapPoint(900, -900);
    expect(far.x).toBeCloseTo(p.x + (108 / 105) * p.w);
    expect(far.y).toBeCloseTo(p.y + (-3 / 68) * p.h);
  });

  it('draws the outline, the halfway line and both penalty boxes inside the pitch', () => {
    const lines = minimapLines();
    expect(lines).toHaveLength(13);
    const p = MINIMAP_PITCH;
    for (const l of lines) {
      expect(l.x).toBeGreaterThanOrEqual(p.x - 0.5);
      expect(l.y).toBeGreaterThanOrEqual(p.y - 0.5);
      expect(l.x + l.w).toBeLessThanOrEqual(p.x + p.w + 0.5);
      expect(l.y + l.h).toBeLessThanOrEqual(p.y + p.h + 0.5);
    }
  });

  it('a tag chip hugs its text, centred', () => {
    expect(monoWidth('#12', 10)).toBe(18);
    expect(tagChipRect('#12', 10, 100, 5, 14)).toEqual({
      x: 83,
      y: 5,
      w: 34,
      h: 14,
    });
  });
});
