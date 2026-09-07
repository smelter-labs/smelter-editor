import { describe, expect, it } from 'vitest';
import {
  clampRim,
  clientToNorm,
  defaultRim,
  hitTest,
  moveHandle,
  normToLocal,
  nudgeRim,
  scaleRim,
} from '../phone/rim-calibration';

const ASPECT = 16 / 9;

describe('rim calibration math', () => {
  it('clamps the ellipse into the frame and sane radii', () => {
    expect(clampRim({ cx: -1, cy: 2, rx: 0, ry: 5 })).toEqual({
      cx: 0,
      cy: 1,
      rx: 0.01,
      ry: 0.3,
    });
  });

  it('hits the handles before the body, and the body inside the ellipse', () => {
    const rim = defaultRim();
    expect(hitTest(rim, rim.cx + rim.rx, rim.cy, ASPECT)).toBe('rx');
    expect(hitTest(rim, rim.cx, rim.cy + rim.ry, ASPECT)).toBe('ry');
    expect(hitTest(rim, rim.cx, rim.cy, ASPECT)).toBe('center');
    expect(hitTest(rim, 0.1, 0.9, ASPECT)).toBeNull();
  });

  it('drags the centre and resizes by handle, never below the minimum', () => {
    const rim = defaultRim();
    expect(moveHandle(rim, 'center', 0.3, 0.4)).toMatchObject({
      cx: 0.3,
      cy: 0.4,
    });
    expect(moveHandle(rim, 'rx', rim.cx + 0.1, rim.cy).rx).toBeCloseTo(0.1);
    expect(moveHandle(rim, 'ry', rim.cx, rim.cy - 0.05).ry).toBeCloseTo(0.05);
    expect(moveHandle(rim, 'rx', rim.cx, rim.cy).rx).toBe(0.01);
  });

  it('nudges and scales', () => {
    const rim = defaultRim();
    const nudged = nudgeRim(rim, 0.01, -0.01);
    expect(nudged.cx).toBeCloseTo(0.51);
    expect(nudged.cy).toBeCloseTo(0.34);
    const bigger = scaleRim(rim, 2);
    expect(bigger.rx).toBeCloseTo(0.12);
    expect(bigger.ry).toBeCloseTo(0.04);
  });

  it('maps client points through object-fit: contain letterboxing both ways', () => {
    // 1280×720 video shown in a 640×640 square → 640×360 centred (y offset 140).
    const rect = { left: 0, top: 0, width: 640, height: 640 };
    expect(clientToNorm(rect, 1280, 720, 320, 320)).toEqual({ x: 0.5, y: 0.5 });
    expect(clientToNorm(rect, 1280, 720, 320, 50)).toBeNull(); // letterbox bar
    const local = normToLocal(rect, 1280, 720, 0.5, 0.5);
    expect(local.x).toBe(320);
    expect(local.y).toBe(320);
    expect(local.scale).toBe(0.5);
  });
});
