import { describe, expect, it } from 'vitest';
import {
  FrameTracker,
  detectFingerFrame,
  detectFrameSwitch,
  type Hand,
} from '../finger-frame';

// Synthetic MediaPipe-style landmarks, mirroring the Python worker's
// test_analysis.py builders (x right, y DOWN, wrist at the bottom).
function makeHand(fingers: boolean[], thumb: 'curl' | 'side'): Hand {
  const pts: [number, number][] = Array.from({ length: 21 }, () => [0, 0]);
  pts[0] = [0.5, 0.9]; // wrist
  const thumbTip: [number, number] =
    thumb === 'curl' ? [0.4, 0.72] : [0.15, 0.75];
  pts[1] = [0.4, 0.8];
  pts[2] = [0.35, 0.75];
  pts[3] = [0.33, 0.7];
  pts[4] = thumbTip;
  fingers.forEach((extended, i) => {
    const x = 0.35 + i * 0.1;
    const base = 5 + i * 4;
    pts[base] = [x, 0.6]; // mcp
    pts[base + 1] = [x, 0.5]; // pip
    pts[base + 2] = [x, 0.45]; // dip
    pts[base + 3] = extended ? [x, 0.3] : [x, 0.55]; // tip
  });
  return pts;
}

/** An L-shaped hand: thumb + index extended, the rest curled. */
const frameHand = (): Hand => makeHand([true, false, false, false], 'side');

const shiftHand = (h: Hand, dx: number, dy: number): Hand =>
  h.map(([x, y]) => [x + dx, y + dy]);

/** An L hand with the framing tips pulled into one cluster (still
 * extended by the wrist-ratio tests). */
function pinchHand(dx = 0, dy = 0): Hand {
  const h = frameHand();
  h[4] = [0.37 + dx, 0.36 + dy];
  h[8] = [0.38 + dx, 0.35 + dy];
  return h;
}

describe('detectFingerFrame', () => {
  it('two L-hands make a quad of the tips in cycle order', () => {
    const quad = detectFingerFrame([
      frameHand(),
      shiftHand(frameHand(), 0.3, 0.1),
    ]);
    expect(quad).not.toBeNull();
    const expected = [
      [0.15, 0.75],
      [0.35, 0.3],
      [0.45, 0.85],
      [0.65, 0.4],
    ];
    quad!.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 9);
      expect(p[1]).toBeCloseTo(expected[i][1], 9);
    });
  });

  it('one hand / no hands is not a frame', () => {
    expect(detectFingerFrame([frameHand()])).toBeNull();
    expect(detectFingerFrame([])).toBeNull();
    expect(detectFingerFrame(null)).toBeNull();
  });

  it('a fist, an open palm or a curled thumb breaks the frame', () => {
    expect(
      detectFingerFrame([
        frameHand(),
        makeHand([false, false, false, false], 'curl'),
      ]),
    ).toBeNull();
    expect(
      detectFingerFrame([
        frameHand(),
        makeHand([true, true, true, true], 'side'),
      ]),
    ).toBeNull();
    expect(
      detectFingerFrame([
        frameHand(),
        makeHand([true, false, false, false], 'curl'),
      ]),
    ).toBeNull();
  });

  it('one stray extended finger is tolerated', () => {
    expect(
      detectFingerFrame([
        frameHand(),
        makeHand([true, true, false, false], 'side'),
      ]),
    ).not.toBeNull();
  });

  it('a degenerate span is noise, not a frame', () => {
    const tiny = frameHand();
    tiny[4] = [0.35, 0.31]; // thumb tip on the index tip
    expect(detectFingerFrame([tiny, tiny])).toBeNull();
  });

  it('an off-picture tip keeps the quad shape (no clamping)', () => {
    const off = frameHand();
    off[4] = [-0.05, 0.75];
    const quad = detectFingerFrame([off, shiftHand(frameHand(), 0.3, 0.1)]);
    expect(quad?.[0]).toEqual([-0.05, 0.75]);
  });
});

describe('detectFrameSwitch', () => {
  it('four tips in a cluster fire the sign (and are no longer a frame)', () => {
    const hands = [pinchHand(), pinchHand(-0.005, 0.005)];
    expect(detectFrameSwitch(hands)).toBe(true);
    expect(detectFingerFrame(hands)).toBeNull();
  });

  it('a spread frame, a broken pose or one hand is not the sign', () => {
    expect(detectFrameSwitch([frameHand(), frameHand()])).toBe(false);
    expect(
      detectFrameSwitch([
        pinchHand(),
        makeHand([false, false, false, false], 'curl'),
      ]),
    ).toBe(false);
    expect(detectFrameSwitch([pinchHand()])).toBe(false);
  });
});

describe('FrameTracker', () => {
  const framePair = () => [frameHand(), shiftHand(frameHand(), 0.3, 0.1)];
  const pinchPair = () => [pinchHand(), pinchHand(-0.005, 0.005)];

  it('streams the quad while present and releases once after 12 misses', () => {
    const t = new FrameTracker();
    expect(t.update(framePair(), 0).send?.quad).not.toBeNull();
    expect(t.update(framePair(), 50).send?.quad).not.toBeNull();
    for (let i = 1; i <= 11; i++) {
      const res = t.update(null, 50 + i * 50);
      expect(res.send).toBeUndefined();
      // The preview keeps showing the last quad through the grace window.
      expect(res.quad).not.toBeNull();
    }
    expect(t.update(null, 700).send).toEqual({ quad: null });
    expect(t.update(null, 750).send).toBeUndefined();
    expect(t.update(null, 750).quad).toBeNull();
  });

  it('keeps a held frame through pose wobble (acquire strict, keep loose)', () => {
    // Index ratio ≈1.07: between the hold gate (1.02) and the acquire gate
    // (1.12) — a typical per-frame dip that used to drop the frame.
    const wobbly = (): Hand => {
      const h = frameHand();
      h[8] = [0.35, 0.468];
      return h;
    };
    const wobblyPair = () => [wobbly(), shiftHand(wobbly(), 0.3, 0.1)];
    // Stray "extended" middle+ring reads — ignored while held.
    const splayed = () => [
      makeHand([true, true, true, false], 'side'),
      shiftHand(makeHand([true, true, true, false], 'side'), 0.3, 0.1),
    ];

    // Cold tracker: the wobble is not good enough to acquire.
    const cold = new FrameTracker();
    expect(cold.update(wobblyPair(), 0).send).toBeUndefined();
    expect(cold.update(wobblyPair(), 0).quad).toBeNull();

    // Held tracker: the same hands keep streaming fresh quads.
    const held = new FrameTracker();
    expect(held.update(framePair(), 0).send?.quad).not.toBeNull();
    const w = held.update(wobblyPair(), 50);
    expect(w.send?.quad).not.toBeNull();
    expect(w.send?.quad?.[1][1]).toBeCloseTo(0.468, 9); // fresh tips, not stale
    expect(held.update(splayed(), 100).send?.quad).not.toBeNull();
  });

  it('fires the switch once after the hold, with a cooldown, pinch over frame', () => {
    const t = new FrameTracker();
    expect(t.update(pinchPair(), 0).switch).toBe(false); // hold starts
    const held = t.update(pinchPair(), 300);
    expect(held.switch).toBe(true);
    expect(held.quad).toBeNull(); // pinch outranks the frame
    expect(t.update(pinchPair(), 400).switch).toBe(false); // once per hold
    // Release, pinch again inside the cooldown: nothing.
    t.update(framePair(), 500);
    expect(t.update(pinchPair(), 600).switch).toBe(false);
    expect(t.update(pinchPair(), 900).switch).toBe(false);
    // Past the cooldown a fresh hold fires again.
    t.update(framePair(), 1700);
    t.update(pinchPair(), 1800);
    expect(t.update(pinchPair(), 2100).switch).toBe(true);
  });

  it('reset releases a shown frame exactly once', () => {
    const t = new FrameTracker();
    t.update(framePair(), 0);
    expect(t.reset()).toEqual({ quad: null });
    expect(t.reset()).toBeUndefined();
  });
});
