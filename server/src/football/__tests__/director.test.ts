import { describe, expect, it } from 'vitest';
import {
  BALL_LOST_WIDE_MS,
  FOLLOW_WIDTH,
  TRICAM_DWELL_MS,
  TRICAM_SWITCH_MS,
  clampCrop,
  cropForReplay,
  cropOf,
  goalCrop,
  resolvePanoView,
  stepFollow,
  stepTricam,
  tileForCrop,
  tricamCamForX,
  wideCrop,
} from '../director';
import type { FbDirectorConfig } from '@smelter-editor/types';

const PANO = { w: 4450, h: 2000 };
const ASPECT = 16 / 9;
const CFG: FbDirectorConfig = {
  zoom: 'normal',
  smoothing: 'smooth',
  switchStyle: 'glide',
  lookaheadMs: 500,
};

describe('crops', () => {
  it('the wide crop spans the full height at the output aspect', () => {
    const c = wideCrop(PANO, ASPECT, null);
    expect(c.h).toBe(2000);
    expect(c.w).toBe(Math.round(2000 * ASPECT));
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(PANO.w);
  });
  it('goal crops sit at the ends without a camera model', () => {
    const l = goalCrop('left', PANO, ASPECT, null);
    const r = goalCrop('right', PANO, ASPECT, null);
    expect(l.x).toBeLessThan(r.x);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(PANO.w);
  });
  it('clamps crops into the panorama', () => {
    expect(clampCrop({ x: -100, y: -50, w: 1600, h: 900 }, PANO)).toEqual({
      x: 0,
      y: 0,
      w: 1600,
      h: 900,
    });
    expect(clampCrop({ x: 4000, y: 1800, w: 1600, h: 900 }, PANO)).toEqual({
      x: 2850,
      y: 1100,
      w: 1600,
      h: 900,
    });
  });
  it('the replay crop widens the follow window around the ball', () => {
    const c = cropForReplay({ x: 2000, y: 900 }, CFG, PANO, ASPECT);
    expect(c.w).toBe(FOLLOW_WIDTH.normal + 200);
    expect(c.x + c.w / 2).toBe(2000);
  });
  it('resolves auto to follow and keeps fixed views', () => {
    expect(resolvePanoView('auto')).toBe('follow');
    expect(resolvePanoView('left-goal')).toBe('left-goal');
  });
});

describe('stepFollow', () => {
  it('snaps to the ball on the first step', () => {
    const s = stepFollow(
      null,
      {
        target: { x: 2000, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(s.cx).toBe(2000);
    expect(s.w).toBe(FOLLOW_WIDTH.normal);
    // the ball sits a little below the window centre
    expect(s.cy).toBeLessThan(900);
  });
  it('eases toward a moved target with a dead zone', () => {
    const s0 = stepFollow(
      null,
      {
        target: { x: 2000, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    const same = stepFollow(
      s0,
      {
        target: { x: 2030, y: 900 },
        speedPxS: 0,
        dtMs: 250,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(same.cx).toBe(s0.cx);
    const moved = stepFollow(
      s0,
      {
        target: { x: 2400, y: 900 },
        speedPxS: 0,
        dtMs: 250,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(moved.cx).toBeGreaterThan(s0.cx);
    expect(moved.cx).toBeLessThan(2400);
  });
  it('caps the velocity but catches up on long balls', () => {
    const s0 = stepFollow(
      null,
      {
        target: { x: 1000, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    const near = stepFollow(
      s0,
      {
        target: { x: 1800, y: 900 },
        speedPxS: 0,
        dtMs: 250,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(near.cx - s0.cx).toBeLessThanOrEqual(1200 * 0.25 + 1);
    const far = stepFollow(
      s0,
      {
        target: { x: 3500, y: 900 },
        speedPxS: 0,
        dtMs: 250,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(far.cx - s0.cx).toBeGreaterThan(near.cx - s0.cx);
    expect(far.cx - s0.cx).toBeLessThanOrEqual(2500 * 0.25 + 1);
  });
  it('widens with the ball speed in auto and never past the cap', () => {
    const slow = stepFollow(
      null,
      {
        target: { x: 2000, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: true,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    const fast = stepFollow(
      null,
      {
        target: { x: 2000, y: 900 },
        speedPxS: 5000,
        dtMs: 0,
        auto: true,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(fast.w).toBeGreaterThan(slow.w);
    expect(fast.w).toBeLessThanOrEqual(FOLLOW_WIDTH.normal + 600);
  });
  it('drifts to the wide view once the ball is lost', () => {
    const s0 = stepFollow(
      null,
      {
        target: { x: 500, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    let s = s0;
    for (let i = 0; i < 40; i++)
      s = stepFollow(
        s,
        {
          target: null,
          speedPxS: 0,
          dtMs: 250,
          auto: false,
          lostForMs: BALL_LOST_WIDE_MS + i * 250,
        },
        CFG,
        PANO,
        ASPECT,
        null,
      );
    const wide = wideCrop(PANO, ASPECT, null);
    expect(Math.abs(s.w - wide.w)).toBeLessThan(50);
  });
  it('a fixed view eases at exactly its width without the vertical bias', () => {
    const s0 = stepFollow(
      null,
      {
        target: { x: 2000, y: 900 },
        speedPxS: 0,
        dtMs: 0,
        auto: false,
        lostForMs: 0,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    // 10 s of director ticks: the width converges on the fixed view.
    let s = s0;
    for (let i = 0; i < 40; i++)
      s = stepFollow(
        s,
        {
          target: { x: 2000, y: 1000 },
          speedPxS: 0,
          dtMs: 250,
          auto: false,
          lostForMs: 0,
          fixedWidth: 3556,
        },
        CFG,
        PANO,
        ASPECT,
        null,
      );
    expect(Math.abs(s.w - 3556)).toBeLessThan(2);
    expect(Math.abs(s.cy - 1000)).toBeLessThan(2);
    // a single long step gets most of the way there
    const one = stepFollow(
      s0,
      {
        target: { x: 2000, y: 1000 },
        speedPxS: 0,
        dtMs: 5000,
        auto: false,
        lostForMs: 0,
        fixedWidth: 3556,
      },
      CFG,
      PANO,
      ASPECT,
      null,
    );
    expect(Math.abs(one.w - 3556)).toBeLessThan(20);
  });
});

describe('tileForCrop', () => {
  it('scales the panorama so the crop fills the output and offsets it to the origin', () => {
    const crop = cropOf({ cx: 2000, cy: 900, w: 1600 }, ASPECT, PANO);
    const tile = tileForCrop(crop, PANO, { width: 1280, height: 720 });
    const k = 1280 / crop.w;
    expect(tile.width).toBe(Math.round(PANO.w * k));
    expect(tile.height).toBe(Math.round(PANO.h * k));
    expect(tile.x).toBe(-Math.round(crop.x * k));
    expect(tile.y).toBe(-Math.round(crop.y * k));
    // the crop lands on the output
    expect(tile.x + crop.x * k).toBeCloseTo(0, 0);
  });
});

describe('tricam cut rule', () => {
  it('maps thirds with the attack shift', () => {
    expect(tricamCamForX(10, null)).toBe('left');
    expect(tricamCamForX(52, null)).toBe('centre');
    expect(tricamCamForX(90, null)).toBe('right');
    expect(tricamCamForX(32, false)).toBe('left');
    expect(tricamCamForX(38, true)).toBe('centre');
  });
  it('needs the centroid past the band for a while and a dwell before cutting', () => {
    const avail = ['left', 'centre', 'right'] as const;
    let s = stepTricam(null, null, null, 0, [...avail]);
    expect(s.cam).toBe('centre');
    s = stepTricam(s, 20, null, 100, [...avail]);
    expect(s.cam).toBe('centre');
    expect(s.candidate?.cam).toBe('left');
    s = stepTricam(s, 20, null, 100 + TRICAM_SWITCH_MS, [...avail]);
    expect(s.cam).toBe('centre'); // dwell not met yet
    s = stepTricam(s, 20, null, TRICAM_DWELL_MS + 10, [...avail]);
    expect(s.cam).toBe('left');
    // back inside the band: stays
    s = stepTricam(s, 37, null, TRICAM_DWELL_MS + 200, [...avail]);
    expect(s.cam).toBe('left');
    expect(s.candidate).toBeNull();
  });
  it('never picks a camera that is not attached', () => {
    let s = stepTricam(null, null, null, 0, ['centre', 'right']);
    s = stepTricam(s, 5, null, 100, ['centre', 'right']);
    s = stepTricam(s, 5, null, TRICAM_DWELL_MS + TRICAM_SWITCH_MS + 100, [
      'centre',
      'right',
    ]);
    expect(s.cam).toBe('centre');
  });
});
