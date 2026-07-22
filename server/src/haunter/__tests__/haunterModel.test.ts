import { describe, expect, it } from 'vitest';
import type { TrackedPersonBox } from '../../app/store';
import type { DuckViewport } from '../../duckHunter/duckFlight';
import {
  LOOKING_MS,
  MAX_HAUNTERS,
  assignGhosts,
  haunterState,
  hoverTargetPx,
  reconcileCount,
  spawnGhosts,
  stepGhost,
} from '../haunterModel';

// Square viewport with frame == output, so content [0,1] maps 1:1 onto pixels
// (no cover offset) and expected distances are easy to reason about.
const V: DuckViewport = {
  width: 1000,
  height: 1000,
  frameW: 1000,
  frameH: 1000,
};

function person(
  id: number,
  cx: number,
  cy: number,
  size = 0.1,
): TrackedPersonBox {
  return {
    id,
    color: id % 4,
    x: cx - size / 2,
    y: cy - size / 2,
    w: size,
    h: size,
  };
}

/** A single idle ghost parked at output-px (px, py). */
function ghostAt(px: number, py: number, idx = 0) {
  const [g] = spawnGhosts(1, V.width, V.height);
  g.idx = idx;
  g.px = px;
  g.py = py;
  g.anchorX = px;
  g.anchorY = py;
  return g;
}

describe('assignGhosts', () => {
  it('attaches a free ghost to the nearest person within the threshold', () => {
    const g = ghostAt(500, 500);
    const near = person(1, 0.55, 0.5); // 50px away
    const far = person(2, 0.8, 0.5); // 300px away
    assignGhosts([g], [near, far], V, 200, 0);
    expect(g.targetId).toBe(1);
  });

  it('does not attach beyond the threshold', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.9, 0.9)], V, 100, 0);
    expect(g.targetId).toBeNull();
  });

  it('never assigns two ghosts to one person (1:1)', () => {
    const a = ghostAt(400, 500, 0);
    const b = ghostAt(600, 500, 1);
    assignGhosts([a, b], [person(7, 0.5, 0.5)], V, 500, 0);
    const targets = [a.targetId, b.targetId];
    expect(targets.filter((t) => t === 7)).toHaveLength(1);
    expect(targets.filter((t) => t == null)).toHaveLength(1);
  });

  it('is sticky: a closer newcomer does not steal a haunted person', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 0);
    expect(g.targetId).toBe(1);
    // Person 2 shows up right on top of the ghost; person 1 is still tracked.
    assignGhosts([g], [person(1, 0.7, 0.5), person(2, 0.5, 0.5)], V, 300, 0);
    expect(g.targetId).toBe(1);
  });

  it('releases the ghost onto the home row when the person disappears', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 0);
    g.px = 620;
    g.py = 780; // ghost has followed its person down the screen
    assignGhosts([g], [], V, 300, 0);
    expect(g.targetId).toBeNull();
    // Keeps its x, but anchors back up top so it slowly floats home.
    expect(g.anchorX).toBe(620);
    expect(g.anchorY).toBe(280);
  });

  it('re-attaches an idle ghost to a new unclaimed person in range', () => {
    const a = ghostAt(300, 500, 0);
    const b = ghostAt(700, 500, 1);
    assignGhosts([a, b], [person(1, 0.3, 0.5)], V, 150, 0);
    expect(a.targetId).toBe(1);
    expect(b.targetId).toBeNull();
    // A second person appears near the idle ghost; the first keeps its target.
    assignGhosts([a, b], [person(1, 0.3, 0.5), person(2, 0.7, 0.5)], V, 150, 0);
    expect(a.targetId).toBe(1);
    expect(b.targetId).toBe(2);
  });

  it('prefers the globally closest ghost-person pair', () => {
    const a = ghostAt(450, 500, 0); // 50px from the person
    const b = ghostAt(420, 500, 1); // 80px from the person
    assignGhosts([a, b], [person(1, 0.5, 0.5)], V, 300, 0);
    expect(a.targetId).toBe(1);
    expect(b.targetId).toBeNull();
  });

  it('breaks exact-distance ties deterministically by ghost idx', () => {
    const a = ghostAt(400, 500, 0);
    const b = ghostAt(600, 500, 1);
    // Person exactly halfway — both ghosts are 100px away.
    assignGhosts([a, b], [person(1, 0.5, 0.5)], V, 300, 0);
    expect(a.targetId).toBe(1);
    expect(b.targetId).toBeNull();
  });
});

describe('haunterState', () => {
  it('is bored while the ghost has no target', () => {
    const g = ghostAt(500, 500);
    expect(haunterState(g, 0)).toBe('bored');
  });

  it('only looks for LOOKING_MS after noticing someone, then hunts', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 1000);
    expect(haunterState(g, 1000)).toBe('looking');
    expect(haunterState(g, 1000 + LOOKING_MS - 1)).toBe('looking');
    expect(haunterState(g, 1000 + LOOKING_MS)).toBe('hunting');
  });

  it('drops back to bored when the person leaves, and a re-acquisition restarts the looking timer', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 1000);
    assignGhosts([g], [], V, 300, 5000);
    expect(haunterState(g, 5000)).toBe('bored');
    // The same person comes back — the ghost looks again before hunting.
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 6000);
    expect(haunterState(g, 6000)).toBe('looking');
    expect(haunterState(g, 6000 + LOOKING_MS)).toBe('hunting');
  });

  it('keeps hunting the same person across re-assignments (sticky, no timer reset)', () => {
    const g = ghostAt(500, 500);
    assignGhosts([g], [person(1, 0.55, 0.5)], V, 300, 1000);
    // Subsequent detection frames with the same track id must not re-stamp.
    assignGhosts([g], [person(1, 0.6, 0.5)], V, 300, 1000 + LOOKING_MS);
    expect(haunterState(g, 1000 + LOOKING_MS)).toBe('hunting');
  });
});

describe('reconcileCount', () => {
  it('grows by appending fresh idle ghosts and keeps survivors intact', () => {
    const ghosts = spawnGhosts(2, V.width, V.height);
    ghosts[0].targetId = 5;
    const grown = reconcileCount(ghosts, 4, V.width, V.height);
    expect(grown).toHaveLength(4);
    expect(grown[0].targetId).toBe(5);
    expect(grown.map((g) => g.idx)).toEqual([0, 1, 2, 3]);
  });

  it('shrinks by dropping the highest indices', () => {
    const ghosts = spawnGhosts(4, V.width, V.height);
    const shrunk = reconcileCount(ghosts, 2, V.width, V.height);
    expect(shrunk.map((g) => g.idx)).toEqual([0, 1]);
  });

  it('clamps the count to [1, MAX_HAUNTERS]', () => {
    expect(spawnGhosts(0, V.width, V.height)).toHaveLength(1);
    expect(spawnGhosts(99, V.width, V.height)).toHaveLength(MAX_HAUNTERS);
  });
});

describe('stepGhost', () => {
  it('moves toward the hover target without overshooting it', () => {
    const g = ghostAt(100, 100);
    g.targetId = 1;
    const target = { px: 500, py: 500 };
    const before = Math.hypot(target.px - g.px, target.py - g.py);
    stepGhost(g, target, 16, 0, 1, V.width, V.height);
    const after = Math.hypot(target.px - g.px, target.py - g.py);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it('caps the per-tick step so the ghost follows instead of teleporting', () => {
    const g = ghostAt(0, 500);
    // Even with an absurd dt-vs-distance, one tick can't cross the screen.
    stepGhost(g, { px: 1000, py: 500 }, 100, 0, 1, V.width, V.height);
    expect(g.px).toBeLessThan(200);
  });

  it('floats back to a distant anchor slowly (idle speed cap)', () => {
    const g = ghostAt(620, 780);
    g.anchorY = 280; // released: home row is far above
    const startY = g.py;
    for (let t = 0; t < 1000; t += 16) {
      stepGhost(g, null, 16, t, 1, V.width, V.height);
    }
    // Idle cap is 5% of min(w, h) per second — nowhere near the hunt speed.
    expect(startY - g.py).toBeGreaterThan(20);
    expect(startY - g.py).toBeLessThanOrEqual(55);
    // ...but it does get home eventually.
    for (let t = 1000; t < 20_000; t += 16) {
      stepGhost(g, null, 16, t, 1, V.width, V.height);
    }
    expect(Math.abs(g.py - 280)).toBeLessThan(60);
  });

  it('idles near its anchor (drift + bob stay small)', () => {
    const g = ghostAt(500, 500);
    let draw = { px: g.px, py: g.py };
    for (let t = 0; t < 10_000; t += 16) {
      draw = stepGhost(g, null, 16, t, 1, V.width, V.height);
    }
    expect(Math.abs(draw.px - 500)).toBeLessThan(60);
    expect(Math.abs(draw.py - 500)).toBeLessThan(60);
  });
});

describe('hoverTargetPx', () => {
  it('hovers above the head, horizontally centered on the box', () => {
    const t = hoverTargetPx(person(1, 0.5, 0.5, 0.2), V, 100);
    expect(t.px).toBe(500);
    expect(t.py).toBeLessThan(400); // above the box top (y=0.4 → 400px)
  });

  it('clamps the target onto the screen for people at the top edge', () => {
    const t = hoverTargetPx(person(1, 0.5, 0.02, 0.04), V, 100);
    expect(t.py).toBeGreaterThanOrEqual(50);
  });
});
