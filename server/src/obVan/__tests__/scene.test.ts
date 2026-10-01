import { describe, expect, it } from 'vitest';
import type { ObEffects, ObShot } from '@smelter-editor/types';
import {
  audioMap,
  buildStage,
  fitRect,
  gridRects,
  overscanRect,
  pipRect,
  speakerSlidesRects,
  splitRects,
  transitionPlan,
  virtualTile,
  type ObSceneCam,
} from '../scene';
import { tileForCrop } from '../../football/director';

const HD = { width: 1920, height: 1080 };
const P720 = { width: 1280, height: 720 };
const FX: ObEffects = { grade: 'none', spotlight: false, softBackground: true };

function cams(n: number, over: Partial<ObSceneCam>[] = []): ObSceneCam[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    inputId: `in${i + 1}`,
    width: 1920,
    height: 1080,
    live: true,
    ...over[i],
  }));
}

const visible = (t: { width: number }) => t.width > 1;

function expectEveryInputOnce(
  stage: { tiles: { inputId: string }[] },
  list: ObSceneCam[],
) {
  const ids = stage.tiles.map((t) => t.inputId);
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids].sort()).toEqual(
    list
      .filter((c) => c.inputId)
      .map((c) => c.inputId as string)
      .sort(),
  );
}

describe('rect helpers', () => {
  it('fitRect keeps the aspect inside the box', () => {
    expect(fitRect(16 / 9, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const portrait = fitRect(9 / 16, { x: 0, y: 0, width: 1920, height: 1080 });
    expect(portrait.height).toBe(1080);
    expect(portrait.width).toBe(608);
    expect(portrait.x).toBe(656);
  });

  it('splitRects lays two 16:9 pictures side by side, centred', () => {
    for (const res of [HD, P720]) {
      const [a, b] = splitRects([16 / 9, 16 / 9], res);
      expect(a.y).toBe(b.y);
      expect(a.height).toBe(b.height);
      expect(b.x).toBeGreaterThan(a.x + a.width);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(res.width);
      expect(a.width / a.height).toBeCloseTo(16 / 9, 1);
    }
  });

  it('pipRect sits in the requested corner, sized S < M < L', () => {
    const s = pipRect('br', 'S', HD, 16 / 9);
    const m = pipRect('br', 'M', HD, 16 / 9);
    const l = pipRect('br', 'L', HD, 16 / 9);
    expect(s.width).toBeLessThan(m.width);
    expect(m.width).toBeLessThan(l.width);
    expect(m.x + m.width).toBe(1920 - 48);
    expect(m.y + m.height).toBe(1080 - 48);
    const tl = pipRect('tl', 'M', P720, 16 / 9);
    expect(tl.x).toBe(32);
    expect(tl.y).toBe(32);
  });

  it('gridRects: 3 cameras = two on top, one centred below', () => {
    const r = gridRects([16 / 9, 16 / 9, 16 / 9], HD);
    expect(r[0].y).toBe(r[1].y);
    expect(r[2].y).toBeGreaterThan(r[0].y);
    const centre = r[2].x + r[2].width / 2;
    expect(Math.abs(centre - 960)).toBeLessThanOrEqual(1);
  });

  it('speakerSlidesRects: slides big on the left, speaker on the right', () => {
    const r = speakerSlidesRects(16 / 9, 16 / 9, HD);
    expect(r.slides.x).toBeLessThan(r.speaker.x);
    expect(r.slides.width).toBeGreaterThan(r.speaker.width * 2);
    expect(r.speaker.x + r.speaker.width).toBeLessThanOrEqual(1920);
  });

  it('overscanRect grows around the centre', () => {
    const r = overscanRect({ x: 0, y: 0, width: 1000, height: 500 }, 1.2);
    expect(r).toEqual({ x: -100, y: -50, width: 1200, height: 600 });
  });
});

describe('buildStage', () => {
  it('solo: full frame, every other camera parked exactly once', () => {
    for (const res of [HD, P720]) {
      const list = cams(3);
      const stage = buildStage({ kind: 'solo', cam: 'c2' }, list, res, FX);
      expect(stage.tiles[0]).toMatchObject({
        inputId: 'in2',
        x: 0,
        y: 0,
        width: res.width,
        height: res.height,
      });
      expect(stage.tiles.filter(visible)).toHaveLength(1);
      expect(stage.tiles.filter((t) => !visible(t))).toEqual([
        { inputId: 'in1', x: 0, y: res.height - 1, width: 1, height: 1 },
        { inputId: 'in3', x: 0, y: res.height - 1, width: 1, height: 1 },
      ]);
      expect(stage.onAir).toEqual(['c2']);
      expectEveryInputOnce(stage, list);
    }
  });

  it('a portrait solo pillarboxes and gets the blurred backdrop', () => {
    const list = cams(1, [{ width: 1080, height: 1920 }]);
    const stage = buildStage({ kind: 'solo', cam: 'c1' }, list, HD, FX);
    expect(stage.tiles[0].height).toBe(1080);
    expect(stage.tiles[0].width).toBeLessThan(700);
    expect(stage.backdrop).toEqual({ inputId: 'in1' });
    const noSoft = buildStage({ kind: 'solo', cam: 'c1' }, list, HD, {
      ...FX,
      softBackground: false,
    });
    expect(noSoft.backdrop).toBeNull();
  });

  it('every shot kind places its cameras and parks the rest', () => {
    const list = cams(5);
    const shots: [ObShot, string[]][] = [
      [{ kind: 'split', cams: ['c1', 'c3'] }, ['c1', 'c3']],
      [
        { kind: 'pip', main: 'c2', inset: 'c4', corner: 'tl', size: 'S' },
        ['c2', 'c4'],
      ],
      [
        { kind: 'quad', cams: ['c1', 'c2', 'c3', 'c4'] },
        ['c1', 'c2', 'c3', 'c4'],
      ],
      [{ kind: 'grid', cams: [] }, ['c1', 'c2', 'c3', 'c4', 'c5']],
      [{ kind: 'grid', cams: ['c5', 'c1'] }, ['c5', 'c1']],
      [{ kind: 'speaker-slides', speaker: 'c1', slides: 'c2' }, ['c2', 'c1']],
    ];
    for (const res of [HD, P720]) {
      for (const [shot, onAir] of shots) {
        const stage = buildStage(shot, list, res, FX);
        expect(stage.onAir).toEqual(onAir);
        expect(stage.tiles.filter(visible).map((t) => t.inputId)).toEqual(
          onAir.map((c) => c.replace('c', 'in')),
        );
        expectEveryInputOnce(stage, list);
        for (const t of stage.tiles.filter(visible)) {
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.x + t.width).toBeLessThanOrEqual(res.width);
          expect(t.y + t.height).toBeLessThanOrEqual(res.height);
        }
      }
    }
  });

  it('pip draws the inset after the main picture (on top)', () => {
    const stage = buildStage(
      { kind: 'pip', main: 'c1', inset: 'c2' },
      cams(2),
      HD,
      FX,
    );
    expect(stage.tiles.map((t) => t.inputId)).toEqual(['in1', 'in2']);
    expect(stage.tiles[0].width).toBe(1920);
    expect(stage.tiles[1]).toMatchObject(pipRect('br', 'M', HD, 16 / 9));
  });

  it('grid [] skips cameras that are not live', () => {
    const list = cams(3, [{}, { live: false }, {}]);
    const stage = buildStage({ kind: 'grid', cams: [] }, list, HD, FX);
    expect(stage.onAir).toEqual(['c1', 'c3']);
    expectEveryInputOnce(stage, list);
  });

  it('cameras without an input are neither placed nor parked', () => {
    const list = cams(2, [{ inputId: null }]);
    const stage = buildStage(
      { kind: 'split', cams: ['c1', 'c2'] },
      list,
      HD,
      FX,
    );
    expect(stage.onAir).toEqual(['c2']);
    expect(stage.tiles.map((t) => t.inputId)).toEqual(['in2']);
  });

  it('virtual = tileForCrop of the current window', () => {
    const list = cams(2);
    const crop = { x: 400, y: 200, w: 960, h: 540 };
    const stage = buildStage(
      { kind: 'virtual', cam: 'c1' },
      list,
      HD,
      FX,
      crop,
    );
    const expected = tileForCrop(crop, { w: 1920, h: 1080 }, HD);
    expect(stage.tiles[0]).toEqual({ inputId: 'in1', ...expected });
    expect(stage.tiles[0].width).toBe(3840);
    expect(stage.tiles[0].x).toBe(-800);
    expect(virtualTile(crop, { width: 1920, height: 1080 }, HD)).toEqual(
      expected,
    );
    expect(stage.backdrop).toBeNull();
    // The spotlight follows the window on the camera's own picture.
    const lit = buildStage(
      { kind: 'virtual', cam: 'c1' },
      list,
      HD,
      { ...FX, spotlight: true },
      crop,
    );
    expect(lit.looks.in1).toEqual({
      grade: 'none',
      spotlight: true,
      focus: { cx: -0.083, cy: -0.13, scale: 0.5 },
    });
    // Before the first spring step: plain full frame.
    const first = buildStage(
      { kind: 'virtual', cam: 'c1' },
      list,
      HD,
      FX,
      null,
    );
    expect(first.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('looks: grade on every camera, spotlight on the shot’s main camera', () => {
    const list = cams(3);
    const stage = buildStage(
      { kind: 'pip', main: 'c2', inset: 'c1' },
      list,
      HD,
      {
        grade: 'warm',
        spotlight: true,
        softBackground: false,
      },
    );
    expect(stage.looks).toEqual({
      in1: { grade: 'warm', spotlight: false },
      in2: { grade: 'warm', spotlight: true },
      in3: { grade: 'warm', spotlight: false },
    });
  });

  it('null shot parks everything', () => {
    const stage = buildStage(null, cams(2), HD, FX);
    expect(stage.tiles.every((t) => !visible(t))).toBe(true);
    expect(stage.onAir).toEqual([]);
  });
});

describe('audioMap', () => {
  const list = cams(3);
  it('follow: the cameras on air', () => {
    expect([...audioMap({ mode: 'follow' }, ['c2'], list)]).toEqual([
      ['in1', 0],
      ['in2', 1],
      ['in3', 0],
    ]);
  });
  it('master: one camera always; unknown master falls back to follow', () => {
    expect([...audioMap({ mode: 'master', cam: 'c3' }, ['c1'], list)]).toEqual([
      ['in1', 0],
      ['in2', 0],
      ['in3', 1],
    ]);
    expect([
      ...audioMap({ mode: 'master', cam: 'nope' }, ['c1'], list),
    ]).toEqual([
      ['in1', 1],
      ['in2', 0],
      ['in3', 0],
    ]);
  });
  it('mix: everybody', () => {
    expect([...audioMap({ mode: 'mix' }, [], list).values()]).toEqual([
      1, 1, 1,
    ]);
  });
});

describe('transitionPlan', () => {
  const list = cams(3);
  const a = buildStage({ kind: 'solo', cam: 'c1' }, list, HD, FX);
  const b = buildStage({ kind: 'solo', cam: 'c2' }, list, HD, FX);

  it('cut: the target layout with 0 ms moves', () => {
    const plan = transitionPlan(a.tiles, b, 'cut', 0);
    expect(plan.tiles.map((t) => t.transitionDurationMs)).toEqual([0, 0, 0]);
    expect(plan.tiles[0]).toMatchObject({ inputId: 'in2', width: 1920 });
    expect(plan.transitions).toEqual([]);
    expect(plan.leaving).toEqual([]);
  });

  it('dissolve: incoming under, outgoing LAST at its old rect fading out', () => {
    const plan = transitionPlan(a.tiles, b, 'dissolve', 400);
    const order = plan.tiles.map((t) => t.inputId);
    expect(order.indexOf('in2')).toBeLessThan(order.indexOf('in1'));
    expect(plan.tiles.find((t) => t.inputId === 'in1')).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    expect(plan.transitions).toEqual([
      { inputId: 'in1', type: 'fade', durationMs: 400, direction: 'out' },
    ]);
    expect(plan.leaving).toEqual(['in1']);
    // Every input still exactly once.
    expect([...order].sort()).toEqual(['in1', 'in2', 'in3']);
  });

  it('dissolve into a PiP: the staying main glides, the inset fades in', () => {
    const pip = buildStage(
      { kind: 'pip', main: 'c1', inset: 'c2' },
      list,
      HD,
      FX,
    );
    const plan = transitionPlan(a.tiles, pip, 'dissolve', 500);
    expect(plan.tiles[0]).toMatchObject({
      inputId: 'in1',
      transitionDurationMs: 500,
    });
    expect(plan.transitions).toEqual([
      { inputId: 'in2', type: 'fade', durationMs: 500, direction: 'in' },
    ]);
    expect(plan.leaving).toEqual([]);
  });

  it('wipe uses the wipe shader on the outgoing picture', () => {
    const plan = transitionPlan(a.tiles, b, 'wipe', 600);
    expect(plan.transitions[0]).toEqual({
      inputId: 'in1',
      type: 'wipe-left',
      durationMs: 600,
      direction: 'out',
    });
  });

  it('an incoming input still under a fade-out is snapped back to full opacity', () => {
    const plan = transitionPlan(b.tiles, a, 'cut', 0, new Set(['in1']));
    expect(plan.transitions).toEqual([
      { inputId: 'in1', type: 'fade', durationMs: 0, direction: 'in' },
    ]);
  });

  it('zoom-punch: outgoing parked, incoming overscanned, then eased to its rect', () => {
    const plan = transitionPlan(a.tiles, b, 'zoom-punch', 350);
    const inc = plan.tiles.find((t) => t.inputId === 'in2');
    expect(inc).toMatchObject(
      overscanRect({ x: 0, y: 0, width: 1920, height: 1080 }),
    );
    expect(plan.tiles.find((t) => t.inputId === 'in1')?.width).toBe(1);
    expect(plan.followUp?.find((t) => t.inputId === 'in2')).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      transitionDurationMs: 350,
    });
  });

  it('fade / dip plans are cuts (the switch happens under black)', () => {
    for (const type of ['fade', 'dip'] as const) {
      const plan = transitionPlan(a.tiles, b, type, 600);
      expect(plan.transitions).toEqual([]);
      expect(plan.tiles.every((t) => t.transitionDurationMs === 0)).toBe(true);
    }
  });
});
