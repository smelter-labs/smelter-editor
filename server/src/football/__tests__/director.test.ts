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
  type FollowState,
} from '../director';
import type { FbDirectorConfig } from '@smelter-editor/types';

const PANO = { w: 4450, h: 2000 };
const ASPECT = 16 / 9;
const CFG: FbDirectorConfig = {
  zoom: 'normal',
  switchStyle: 'glide',
  lookaheadMs: 500,
  averageMs: 200,
  smoothTimeMs: 600,
  deadZonePx: 60,
  maxSpeedPxS: 1200,
  catchUp: true,
};

/** One follow step towards a ball at (x, 900). */
function follow(
  prev: FollowState | null,
  x: number,
  dtMs: number,
  cfg: FbDirectorConfig = CFG,
): FollowState {
  return stepFollow(
    prev,
    { target: { x, y: 900 }, speedPxS: 0, dtMs, auto: false, lostForMs: 0 },
    cfg,
    PANO,
    ASPECT,
    null,
  );
}

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
  it('rests inside the dead zone and eases toward a moved target', () => {
    const s0 = follow(null, 2000, 0);
    const same = follow(s0, 2030, 100);
    expect(same.cx).toBe(s0.cx);
    const moved = follow(s0, 2400, 100);
    expect(moved.cx).toBeGreaterThan(s0.cx);
    expect(moved.cx).toBeLessThan(2400);
    // …and settles on the edge of the dead zone, not on the ball
    let s = s0;
    for (let i = 0; i < 100; i++) s = follow(s, 2400, 100);
    expect(Math.abs(s.cx - (2400 - CFG.deadZonePx))).toBeLessThan(2);
  });
  it('starts and changes direction without a kink in the velocity', () => {
    // The ball jumps away, then back: the step size may only change a little
    // from one tick to the next (the old one-pole filter jumped at once).
    let s = follow(null, 2000, 0);
    const steps: number[] = [];
    for (let i = 0; i < 60; i++) {
      const next = follow(s, i < 30 ? 2500 : 1700, 100);
      steps.push(next.cx - s.cx);
      s = next;
    }
    const peak = Math.max(...steps.map(Math.abs));
    for (let i = 1; i < steps.length; i++)
      expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThan(peak * 0.6);
    expect(Math.abs(steps[0])).toBeLessThan(peak * 0.6);
  });
  it('keeps gliding behind a slow ball instead of stop-and-go', () => {
    // 150 px/s: once the ball leaves the dead zone the window moves on every
    // tick and converges on the ball's own speed.
    let s = follow(null, 2000, 0);
    const steps: number[] = [];
    for (let i = 1; i <= 80; i++) {
      const next = follow(s, 2000 + i * 15, 100);
      steps.push(next.cx - s.cx);
      s = next;
    }
    const moving = steps.slice(10);
    for (const d of moving) expect(d).toBeGreaterThan(0);
    for (const d of steps.slice(-10)) expect(Math.abs(d - 15)).toBeLessThan(1);
  });
  it('respects the speed limit but catches up on long balls', () => {
    const run = (x: number, cfg: FbDirectorConfig) => {
      let s = follow(null, 1000, 0);
      let peak = 0;
      for (let i = 0; i < 30; i++) {
        const next = follow(s, x, 100, cfg);
        peak = Math.max(peak, (next.cx - s.cx) / 0.1);
        s = next;
      }
      return peak;
    };
    // 500 px away: below the catch-up range, the limit holds
    expect(run(1500, { ...CFG, maxSpeedPxS: 300 })).toBeLessThanOrEqual(301);
    expect(run(1500, CFG)).toBeGreaterThan(301);
    // a long ball lifts the limit…
    const far = run(3500, CFG);
    expect(far).toBeGreaterThan(CFG.maxSpeedPxS);
    expect(far).toBeLessThanOrEqual(2501);
    // …unless catch-up is off
    expect(run(3500, { ...CFG, catchUp: false })).toBeLessThanOrEqual(
      CFG.maxSpeedPxS + 1,
    );
  });
  it('a longer smooth time and a wider dead zone slow the window down', () => {
    const s0 = follow(null, 2000, 0);
    const after = (cfg: FbDirectorConfig) => {
      let s = s0;
      for (let i = 0; i < 5; i++) s = follow(s, 2400, 100, cfg);
      return s.cx - s0.cx;
    };
    expect(after({ ...CFG, smoothTimeMs: 1500 })).toBeLessThan(after(CFG));
    expect(after({ ...CFG, deadZonePx: 300 })).toBeLessThan(after(CFG));
    expect(after({ ...CFG, deadZonePx: 0 })).toBeGreaterThan(after(CFG));
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
