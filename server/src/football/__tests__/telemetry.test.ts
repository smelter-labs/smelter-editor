import { describe, expect, it } from 'vitest';
import {
  ballAt,
  ballMean,
  ballSpeedPx,
  centroidAt,
  onPitch,
  parseBall,
  parseClipMeta,
  parseZones,
  parseZxy,
  playersAt,
  projectPitch,
  sprintAt,
  statsAt,
  unprojectPitch,
  type FbCameraModel,
} from '../telemetry';

const CAM: FbCameraModel = {
  cx: 56.6025,
  d: 7.506,
  hc: 9.3208,
  f: 1593.9699,
  x0: 2239.0293,
  y0: 1068.1905,
  tilt: 0.4357,
};

describe('camera model', () => {
  it('projects the pitch into the panorama and back', () => {
    for (const [X, Y] of [
      [52.5, 34],
      [0, 68],
      [105, 0],
      [16.5, 13.85],
    ]) {
      const [px, py] = projectPitch(CAM, X, Y);
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(4450);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(2000);
      const [X2, Y2] = unprojectPitch(CAM, px, py);
      expect(X2).toBeCloseTo(X, 1);
      expect(Y2).toBeCloseTo(Y, 1);
    }
  });
  it('the near touchline is lower on the picture than the far one', () => {
    expect(projectPitch(CAM, 52.5, 68)[1]).toBeGreaterThan(
      projectPitch(CAM, 52.5, 0)[1],
    );
  });
});

describe('parsers', () => {
  it('reads the clip meta, zones, zxy and ball sidecars', () => {
    expect(
      parseClipMeta({
        session: 'pano',
        fps: 25,
        width: 4450,
        height: 2000,
        panoWidth: 4450,
        panoHeight: 2000,
        t0Utc: 1,
      }),
    ).toMatchObject({ session: 'pano', fps: 25 });
    const z = parseZones({
      pano: { w: 4450, h: 2000 },
      camera: { model: 'tilted-cylinder', ...CAM },
    });
    expect(z.camera?.f).toBeCloseTo(CAM.f);
    const zxy = parseZxy({
      hz: 10,
      durationMs: 1000,
      team: 'Tromsø',
      frame: 'pano',
      tags: [
        {
          id: 7,
          firstMs: 0,
          lastMs: 1000,
          x: [10, 11, 12, null],
          y: [30, 30, 30, null],
          v: [1, 8, 8, null],
          d: [0, 1, 2, null],
        },
      ],
      sprints: [{ tag: 7, startMs: 100, endMs: 300, topKmh: 28.8, meters: 4 }],
    });
    expect(zxy.tags[0].x[3]).toBeNaN();
    expect(zxy.tags[0].vMax[2]).toBe(8);
    const ball = parseBall({
      fps: 25,
      w: 4450,
      h: 2000,
      samples: [
        [40, 2000, 900, 50, 34],
        [0, 1990, 900, 49.5, 34],
      ],
    });
    expect(Array.from(ball.t)).toEqual([0, 40]);
    expect(ball.X[1]).toBe(50);
  });
  it('rejects malformed files', () => {
    expect(() => parseZxy({})).toThrow();
    expect(() => parseBall({ samples: 'x' })).toThrow();
    expect(() => parseZones({})).toThrow();
  });
});

describe('lookups', () => {
  const ball = parseBall({
    fps: 25,
    w: 4450,
    h: 2000,
    samples: [
      [0, 1000, 900, 20, 34],
      [40, 1040, 900, 21, 34],
      [80, 1080, 900, 22, 34],
      [2000, 3000, 900, 70, 34],
    ],
  });
  it('interpolates the ball inside a run and refuses to bridge a gap', () => {
    const b = ballAt(ball, 20)!;
    expect(b.px).toBeCloseTo(1020);
    expect(b.X).toBeCloseTo(20.5);
    expect(ballAt(ball, 1000)).toBeNull();
    expect(ballAt(ball, -10)).toBeNull();
  });
  it('averages a window and measures the speed', () => {
    const m = ballMean(ball, 0, 80)!;
    expect(m.px).toBeCloseTo(1040);
    expect(ballSpeedPx(ball, 40)).toBeCloseTo(1000, -1);
  });
  it('lists players on the pitch, the centroid, stats and sprints', () => {
    const zxy = parseZxy({
      hz: 10,
      durationMs: 1000,
      frame: 'pano',
      tags: [
        {
          id: 1,
          x: [10, 10, 10],
          y: [30, 30, 30],
          v: [1, 1, 1],
          d: [100, 110, 120],
        },
        {
          id: 2,
          x: [50, 50, 50],
          y: [40, 40, 40],
          v: [2, 9, 2],
          d: [0, 5, 10],
        },
        { id: 3, x: [90, 90, 90], y: [50, 50, 50], v: [3, 3, 3], d: [0, 0, 0] },
        {
          id: 4,
          x: [200, 200, 200],
          y: [-40, -40, -40],
          v: [0, 0, 0],
          d: [0, 0, 0],
        },
      ],
      sprints: [{ tag: 2, startMs: 100, endMs: 200, topKmh: 32.4, meters: 5 }],
    });
    expect(playersAt(zxy, 100).map((p) => p.tag)).toEqual([1, 2, 3]);
    expect(centroidAt(zxy, 100)!.x).toBeCloseTo(50);
    const stats = statsAt(zxy, 200);
    expect(stats.find((s) => s.tag === 1)!.meters).toBe(20);
    expect(stats.find((s) => s.tag === 2)!.topKmh).toBeCloseTo(32.4);
    expect(stats.find((s) => s.tag === 2)!.sprints).toBe(1);
    expect(sprintAt(zxy, 150)!.tag).toBe(2);
    expect(sprintAt(zxy, 5000)).toBeNull();
    expect(onPitch(-0.5, 10)).toBe(true);
    expect(onPitch(-3, 10)).toBe(false);
  });
});

describe('camera roll', () => {
  it('is optional and round-trips through unprojectPitch', () => {
    const rolled = { ...CAM, roll: -0.0161 };
    const [x0, y0] = projectPitch(CAM, 105, 34);
    const [x1, y1] = projectPitch(rolled, 105, 34);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThan(5);
    const [X, Y] = unprojectPitch(rolled, x1, y1);
    expect(X).toBeCloseTo(105, 0);
    expect(Y).toBeCloseTo(34, 0);
  });
});
