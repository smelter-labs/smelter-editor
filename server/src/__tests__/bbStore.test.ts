import { describe, expect, it } from 'vitest';
import type { BbHudState } from '../app/store';
import { bbPipRect, createRoomStore } from '../app/store';

function hud(score: number): BbHudState {
  return {
    stage: {
      scene: 'live',
      main: 'court',
      pip: null,
      caster: null,
      split: false,
    },
    teams: {
      A: { name: 'A', color: '#ff6a1f', score },
      B: { name: 'B', color: '#1f7bff', score: 0 },
    },
    clock: { phase: 'live', period: 'reg', remainingMs: 60_000, running: true },
    lastShot: null,
    pendingCount: 0,
    cams: {
      hoop: { inputId: null, live: false },
      court: { inputId: null, live: false },
    },
    lobby: null,
    ended: null,
    commentator: null,
    banner: null,
  };
}

describe('bbPipRect', () => {
  it('places a 480×270 tile in the bottom-right corner at 1080p and scales with height', () => {
    expect(bbPipRect({ width: 1920, height: 1080 })).toEqual({
      x: 1920 - 56 - 480,
      y: 1080 - 56 - 270,
      width: 480,
      height: 270,
    });
    const half = bbPipRect({ width: 960, height: 540 });
    expect(half.width).toBe(240);
    expect(half.height).toBe(135);
  });
});

describe('setBbGame', () => {
  it('ignores a snapshot identical to the current one and applies a changed one', () => {
    const store = createRoomStore();
    const first = hud(0);
    store.getState().setBbGame(first);
    const applied = store.getState().bbGame;
    store.getState().setBbGame(hud(0)); // fresh object, same content
    expect(store.getState().bbGame).toBe(applied);
    store.getState().setBbGame(hud(1));
    expect(store.getState().bbGame?.teams.A.score).toBe(1);
    store.getState().setBbGame(null);
    expect(store.getState().bbGame).toBeNull();
  });
});
