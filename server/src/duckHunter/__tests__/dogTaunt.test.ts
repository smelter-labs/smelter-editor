import { describe, expect, it } from 'vitest';
import type { DuckViewport } from '../duckFlight';
import { contentToPx, pxToContent } from '../duckFlight';
import type { DogEntity } from '../dogTaunt';
import {
  DOG_DEATH_MS,
  DOG_FALL_MS,
  DOG_FREEZE_MS,
  DOG_LAUGH_MS,
  DOG_RISE_MS,
  DOG_TAUNT_MS,
  DOG_YELP_MS,
  dogExpired,
  dogLaughFrame,
  dogPhase,
  dogPose,
  dogRectPx,
  dogShootable,
} from '../dogTaunt';

const V: DuckViewport = {
  width: 1920,
  height: 1080,
  frameW: 1280,
  frameH: 720,
};

function dog(over: Partial<DogEntity> = {}): DogEntity {
  return { id: 1, x: 0.5, at: 1000, ...over };
}

describe('dogTaunt phases', () => {
  it('walks rise → laugh → drop → gone', () => {
    const d = dog();
    expect(dogPhase(d, 1000)).toBe('rise');
    expect(dogPhase(d, 1000 + DOG_RISE_MS - 1)).toBe('rise');
    expect(dogPhase(d, 1000 + DOG_RISE_MS)).toBe('laugh');
    expect(dogPhase(d, 1000 + DOG_RISE_MS + DOG_LAUGH_MS - 1)).toBe('laugh');
    expect(dogPhase(d, 1000 + DOG_RISE_MS + DOG_LAUGH_MS)).toBe('drop');
    expect(dogPhase(d, 1000 + DOG_TAUNT_MS - 1)).toBe('drop');
    expect(dogPhase(d, 1000 + DOG_TAUNT_MS)).toBe('gone');
  });

  it('walks yelp → hang → fall → gone once shot', () => {
    const d = dog({ diedAt: 2000 });
    expect(dogPhase(d, 2000)).toBe('yelp');
    expect(dogPhase(d, 2000 + DOG_YELP_MS - 1)).toBe('yelp');
    expect(dogPhase(d, 2000 + DOG_YELP_MS)).toBe('hang');
    expect(dogPhase(d, 2000 + DOG_FREEZE_MS)).toBe('fall');
    expect(dogPhase(d, 2000 + DOG_DEATH_MS - 1)).toBe('fall');
    expect(dogPhase(d, 2000 + DOG_DEATH_MS)).toBe('gone');
  });
});

describe('dogShootable', () => {
  // The whole product rule: the dog is a target only while it laughs at you.
  it('is true only during the laugh window', () => {
    const d = dog();
    expect(dogShootable(d, 1000)).toBe(false); // rising
    expect(dogShootable(d, 1000 + DOG_RISE_MS)).toBe(true);
    expect(dogShootable(d, 1000 + DOG_RISE_MS + DOG_LAUGH_MS - 1)).toBe(true);
    expect(dogShootable(d, 1000 + DOG_RISE_MS + DOG_LAUGH_MS)).toBe(false); // dropping
    expect(dogShootable(d, 1000 + DOG_TAUNT_MS)).toBe(false); // gone
  });

  it('is false the instant it is shot, even mid-laugh', () => {
    const mid = 1000 + DOG_RISE_MS + DOG_LAUGH_MS / 2;
    expect(dogShootable(dog(), mid)).toBe(true);
    expect(dogShootable(dog({ diedAt: mid }), mid)).toBe(false);
  });
});

describe('dogExpired', () => {
  it('retires an untouched dog after the full taunt', () => {
    const d = dog();
    expect(dogExpired(d, 1000 + DOG_TAUNT_MS - 1)).toBe(false);
    expect(dogExpired(d, 1000 + DOG_TAUNT_MS)).toBe(true);
  });

  it('keeps a shot dog alive for its whole death beat', () => {
    const d = dog({ diedAt: 2000 });
    expect(dogExpired(d, 2000 + DOG_DEATH_MS - 1)).toBe(false);
    expect(dogExpired(d, 2000 + DOG_DEATH_MS)).toBe(true);
  });
});

describe('dogPose', () => {
  it('yelps on impact, then shows the shot pose through the fall', () => {
    const d = dog({ diedAt: 2000 });
    expect(dogPose(d, 1000 + DOG_RISE_MS)).toBe('laugh');
    expect(dogPose(d, 2000)).toBe('yelp');
    expect(dogPose(d, 2000 + DOG_YELP_MS)).toBe('shot');
    expect(dogPose(d, 2000 + DOG_FREEZE_MS)).toBe('shot');
  });
});

describe('dogLaughFrame', () => {
  it('alternates between the two laugh frames', () => {
    const d = dog();
    expect(dogLaughFrame(d, 1000)).toBe(0);
    expect(dogLaughFrame(d, 1000 + 200)).toBe(1);
    expect(dogLaughFrame(d, 1000 + 400)).toBe(0);
  });
});

describe('dogRectPx', () => {
  it('starts fully below the bottom edge and stands on it while laughing', () => {
    const d = dog();
    const start = dogRectPx(d, 1000, V);
    expect(start.top).toBe(V.height); // entirely off-screen at t=0
    const up = dogRectPx(d, 1000 + DOG_RISE_MS, V);
    expect(up.top).toBe(V.height - up.height);
  });

  it('rises monotonically and sinks monotonically', () => {
    const d = dog();
    const rise = [0, 0.25, 0.5, 0.75, 1].map(
      (t) => dogRectPx(d, 1000 + DOG_RISE_MS * t, V).top,
    );
    for (let i = 1; i < rise.length; i++) {
      expect(rise[i]).toBeLessThanOrEqual(rise[i - 1]);
    }
    const dropStart = 1000 + DOG_RISE_MS + DOG_LAUGH_MS;
    const drop = [0, 0.25, 0.5, 0.75, 0.99].map(
      (t) => dogRectPx(d, dropStart + 300 * t, V).top,
    );
    for (let i = 1; i < drop.length; i++) {
      expect(drop[i]).toBeGreaterThanOrEqual(drop[i - 1]);
    }
  });

  it('hangs in place through the yelp, then falls clear of the frame', () => {
    const d = dog({ diedAt: 2000 });
    const rest = V.height - dogRectPx(d, 2000, V).height;
    expect(dogRectPx(d, 2000, V).top).toBe(rest);
    expect(dogRectPx(d, 2000 + DOG_YELP_MS, V).top).toBe(rest);
    const landed = dogRectPx(d, 2000 + DOG_FREEZE_MS + DOG_FALL_MS, V);
    expect(landed.top).toBeGreaterThanOrEqual(V.height);
  });

  it('clamps horizontally inside the frame at both extremes', () => {
    for (const x of [0, 0.5, 1]) {
      const r = dogRectPx(dog({ x }), 1000 + DOG_RISE_MS, V);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(V.width);
    }
  });

  it('keeps a constant box size across the whole beat', () => {
    // The box never changes shape, so the sprite cannot visibly jump when the
    // pose swaps from laugh (29x40) to shot (19x33) at the moment of impact.
    const d = dog({ diedAt: 2000 });
    const sizes = [1000, 1000 + DOG_RISE_MS, 2000, 2000 + DOG_FREEZE_MS].map(
      (t) => `${dogRectPx(d, t, V).width}x${dogRectPx(d, t, V).height}`,
    );
    expect(new Set(sizes).size).toBe(1);
  });
});

describe('hit-stop timing', () => {
  it('unfreezes the flock exactly as the dog starts to fall', () => {
    // If the freeze outlasted the hang the ducks would still be stopped while
    // the dog drops; if it ended sooner they'd resume mid-yelp.
    expect(DOG_FREEZE_MS).toBe(DOG_DEATH_MS - DOG_FALL_MS);
  });
});

describe('pxToContent', () => {
  it('round-trips contentToPx on a non-square viewport', () => {
    for (const [x, y] of [
      [0, 0],
      [0.25, 0.75],
      [1, 1],
    ]) {
      const { px, py } = contentToPx(x, y, V);
      const back = pxToContent(px, py, V);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });
});
