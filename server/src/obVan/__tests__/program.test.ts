import { describe, expect, it } from 'vitest';
import type { ObShot } from '@smelter-editor/types';
import {
  OB_DIP_FADE_MS,
  begin,
  dipOpacity,
  initialProgram,
  onAirCams,
  scheduleAt,
  settle,
  stagedShot,
  standaloneDip,
  tallyOf,
} from '../program';

const A: ObShot = { kind: 'solo', cam: 'a' };
const B: ObShot = { kind: 'solo', cam: 'b' };
const C: ObShot = { kind: 'solo', cam: 'c' };
const CAMS = ['a', 'b', 'c'];

function onA(now = 1000) {
  return begin(initialProgram(0), A, { type: 'cut', durationMs: 0 }, now, {
    source: 'operator',
  }).state;
}

describe('begin', () => {
  it('a cut switches at once, no transition', () => {
    const { state, live } = begin(
      onA(),
      B,
      { type: 'cut', durationMs: 0 },
      2000,
      {
        source: 'operator',
      },
    );
    expect(live).toBeNull();
    expect(state.program).toEqual(B);
    expect(state.sinceMs).toBe(2000);
    expect(state.transition).toBeNull();
  });

  it('the first shot has nothing to dissolve from', () => {
    const { live } = begin(
      initialProgram(0),
      A,
      { type: 'dissolve', durationMs: 400 },
      5,
      {
        source: 'operator',
      },
    );
    expect(live).toBeNull();
  });

  it('dissolve: live transition A → B settling after its duration', () => {
    const { state, live } = begin(
      onA(),
      B,
      { type: 'dissolve', durationMs: 400 },
      2000,
      {
        source: 'auto',
      },
    );
    expect(live).toMatchObject({
      type: 'dissolve',
      from: A,
      to: B,
      cutAtMs: null,
      settleAtMs: 2400,
    });
    expect(state.source).toBe('auto');
    expect(stagedShot(state, 2100)).toEqual(B);
    expect(settle(state, 2399).transition).not.toBeNull();
    expect(settle(state, 2400).transition).toBeNull();
  });

  it('a take during a transition finishes the old one first', () => {
    const mid = begin(onA(), B, { type: 'dissolve', durationMs: 1000 }, 2000, {
      source: 'operator',
    }).state;
    const { state, live } = begin(
      mid,
      C,
      { type: 'dissolve', durationMs: 400 },
      2300,
      {
        source: 'operator',
      },
    );
    expect(live?.from).toEqual(B);
    expect(onAirCams(state).sort()).toEqual(['b', 'c']);
  });

  it('fade goes through black: the stage keeps A until the half-way cut', () => {
    const { state, live } = begin(
      onA(),
      B,
      { type: 'fade', durationMs: 800 },
      2000,
      {
        source: 'operator',
      },
    );
    expect(live?.cutAtMs).toBe(2400);
    expect(state.dip).toEqual({
      startedAtMs: 2000,
      inMs: 400,
      holdMs: 0,
      outMs: 400,
    });
    expect(stagedShot(state, 2399)).toEqual(A);
    expect(stagedShot(state, 2400)).toEqual(B);
    expect(state.sinceMs).toBe(2400);
  });

  it('dip holds black; the cut lands when the plate is opaque', () => {
    const { state, live } = begin(
      onA(),
      B,
      { type: 'dip', durationMs: 0, holdMs: 500 },
      2000,
      {
        source: 'operator',
      },
    );
    expect(live?.cutAtMs).toBe(2000 + OB_DIP_FADE_MS);
    expect(live?.settleAtMs).toBe(2000 + OB_DIP_FADE_MS * 2 + 500);
    expect(dipOpacity(state.dip, live!.cutAtMs!)).toBe(1);
  });

  it('TAKE swaps program and preview', () => {
    const withPvw = { ...onA(), preview: B };
    const { state } = begin(withPvw, B, { type: 'cut', durationMs: 0 }, 2000, {
      source: 'operator',
      swapPreview: true,
    });
    expect(state.program).toEqual(B);
    expect(state.preview).toEqual(A);
  });
});

describe('tallyOf', () => {
  it('program red, preview green, others off', () => {
    const state = { ...onA(), preview: B };
    expect(tallyOf(state, CAMS)).toEqual({
      a: 'program',
      b: 'preview',
      c: 'off',
    });
  });

  it('during a dissolve both pictures are on air; after it only the new one', () => {
    const { state } = begin(
      { ...onA(), preview: C },
      B,
      { type: 'dissolve', durationMs: 400 },
      2000,
      {
        source: 'operator',
      },
    );
    expect(tallyOf(state, CAMS)).toEqual({
      a: 'program',
      b: 'program',
      c: 'preview',
    });
    expect(tallyOf(settle(state, 2400), CAMS)).toEqual({
      a: 'off',
      b: 'program',
      c: 'preview',
    });
  });

  it('program wins over preview on the same camera', () => {
    expect(tallyOf({ ...onA(), preview: A }, CAMS).a).toBe('program');
  });
});

describe('dipOpacity', () => {
  const dip = standaloneDip(1000, 400);
  it('ramps in, holds, ramps out', () => {
    expect(dipOpacity(dip, 999)).toBe(0);
    expect(dipOpacity(dip, 1000)).toBe(0);
    expect(dipOpacity(dip, 1150)).toBeCloseTo(0.5);
    expect(dipOpacity(dip, 1300)).toBe(1);
    expect(dipOpacity(dip, 1600)).toBe(1);
    expect(dipOpacity(dip, 1700)).toBe(1);
    expect(dipOpacity(dip, 1850)).toBeCloseTo(0.5);
    expect(dipOpacity(dip, 2000)).toBe(0);
    expect(dipOpacity(null, 1500)).toBe(0);
  });
  it('settle clears a finished dip', () => {
    const state = { ...initialProgram(0), dip };
    expect(settle(state, 1999).dip).not.toBeNull();
    expect(settle(state, 2000).dip).toBeNull();
  });
});

describe('scheduleAt', () => {
  it('never in the past and strictly after the previous change', () => {
    expect(scheduleAt(5000, 2000, 0)).toEqual({ applyAtMs: 5000, late: false });
    expect(scheduleAt(5000, 2000, 5000)).toEqual({
      applyAtMs: 5001,
      late: false,
    });
    expect(scheduleAt(1500, 2000, 0)).toEqual({ applyAtMs: 2000, late: true });
  });
  it('more than 2 s late is skipped', () => {
    expect(scheduleAt(-1, 2000, 0)).toBeNull();
    expect(scheduleAt(0, 2000, 0)).toEqual({ applyAtMs: 2000, late: true });
  });
});
