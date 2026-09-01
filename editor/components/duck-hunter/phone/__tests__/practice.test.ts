import { describe, expect, it } from 'vitest';
import {
  PRACTICE_HIT_RADIUS,
  PRACTICE_SPOTS,
  freshPractice,
  markPracticeHit,
  pickPracticeHit,
  type PracticeTarget,
} from '../practice';

/** Two ducks far enough apart that a shot can only ever reach one of them. */
const APART: PracticeTarget[] = [
  { id: 0, x: 0.2, y: 0.2, hit: false },
  { id: 1, x: 0.8, y: 0.8, hit: false },
];

describe('freshPractice', () => {
  it('seeds one standing duck per spot, ids by index', () => {
    const t = freshPractice();
    expect(t).toHaveLength(PRACTICE_SPOTS.length);
    expect(t.map((d) => d.id)).toEqual([0, 1, 2]);
    expect(t.every((d) => !d.hit)).toBe(true);
    expect(t[0]).toMatchObject({
      x: PRACTICE_SPOTS[0].x,
      y: PRACTICE_SPOTS[0].y,
    });
  });
});

describe('pickPracticeHit', () => {
  it('bags the duck the shot lands on', () => {
    expect(pickPracticeHit(APART, { x: 0.8, y: 0.8 })).toBe(1);
  });

  it('misses outside the radius', () => {
    const just = PRACTICE_HIT_RADIUS + 0.001;
    expect(pickPracticeHit(APART, { x: 0.2 + just, y: 0.2 })).toBeNull();
  });

  it('counts the radius itself as a hit', () => {
    expect(
      pickPracticeHit(APART, { x: 0.2 + PRACTICE_HIT_RADIUS, y: 0.2 }),
    ).toBe(0);
  });

  it('skips a duck that is already down', () => {
    const downed = markPracticeHit(APART, 0);
    expect(pickPracticeHit(downed, { x: 0.2, y: 0.2 })).toBeNull();
  });

  it('bags exactly one when two ducks overlap the shot', () => {
    const stacked: PracticeTarget[] = [
      { id: 0, x: 0.5, y: 0.5, hit: false },
      { id: 1, x: 0.52, y: 0.5, hit: false },
    ];
    const first = pickPracticeHit(stacked, { x: 0.51, y: 0.5 });
    expect(first).toBe(0);
    const after = markPracticeHit(stacked, first);
    expect(after.filter((t) => t.hit)).toHaveLength(1);
    // The neighbour survives this shot but is still available for the next one.
    expect(pickPracticeHit(after, { x: 0.51, y: 0.5 })).toBe(1);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(APART);
    pickPracticeHit(APART, { x: 0.2, y: 0.2 });
    expect(JSON.stringify(APART)).toBe(before);
  });
});

describe('markPracticeHit', () => {
  it('marks only the named duck', () => {
    const after = markPracticeHit(APART, 1);
    expect(after.map((t) => t.hit)).toEqual([false, true]);
  });

  it('returns the same array for a miss, so React can bail out', () => {
    expect(markPracticeHit(APART, null)).toBe(APART);
    expect(markPracticeHit(markPracticeHit(APART, 0), 0)).toEqual(
      markPracticeHit(APART, 0),
    );
  });

  // The regression this module exists for: the old inline updater latched a
  // "already hit one" flag in an outer closure, so React's second invocation on
  // the same `prev` returned an array with no hits at all and the duck lived.
  it('is pure — two runs on the same input give the same result', () => {
    const prev = freshPractice();
    const a = markPracticeHit(prev, 2);
    const b = markPracticeHit(prev, 2);
    expect(b).toEqual(a);
    expect(b.filter((t) => t.hit).map((t) => t.id)).toEqual([2]);
    expect(prev.every((t) => !t.hit)).toBe(true);
  });

  it('ignores an unknown id', () => {
    expect(markPracticeHit(APART, 99)).toBe(APART);
  });
});

describe('the fire-at-centre case', () => {
  it('a freshly centred crosshair can bag the middle duck', () => {
    // The centre spot sits exactly PRACTICE_HIT_RADIUS below the reset aim.
    expect(pickPracticeHit(freshPractice(), { x: 0.5, y: 0.5 })).toBe(2);
  });
});
