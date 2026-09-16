import { describe, expect, it } from 'vitest';
import type { PersonBox } from '../../../app/store';
import { PeopleTracker } from '../people-tracker';

/** A square box of side `s` centered at (cx, cy). */
const box = (cx: number, cy: number, s: number): PersonBox => ({
  x: cx - s / 2,
  y: cy - s / 2,
  w: s,
  h: s,
});

/** The bird profile as RoomState builds it for the YOLO source. */
const birdTracker = () =>
  new PeopleTracker({
    maxMisses: 2,
    withLead: true,
    fastMovers: true,
    identityMs: 2500,
    mergeOverlapping: true,
    maxVelDtMs: 2500,
  });

const uniqueIds = (ids: number[]) => new Set(ids).size;

describe('PeopleTracker — fast-mover (bird) profile', () => {
  // A small bird (box 0.03) crossing the frame at 0.08 per 300 ms response
  // moves ~2.7× its own box per response — hopeless for the size-scaled gate.
  it('keeps one id on a small fast bird across a straight flight', () => {
    const tr = birdTracker();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      const out = tr.update([box(0.1 + i * 0.08, 0.5, 0.03)], i * 300);
      expect(out).toHaveLength(1);
      ids.push(out[0].id);
    }
    expect(uniqueIds(ids)).toBe(1);
  });

  it('hides a lost bird after maxMisses responses and re-adopts its id within identityMs', () => {
    const tr = birdTracker();
    const first = tr.update([box(0.1, 0.5, 0.03)], 0)[0].id;
    tr.update([box(0.18, 0.5, 0.03)], 300);
    tr.update([box(0.26, 0.5, 0.03)], 600);
    // Two empty responses: the last box is still held (presence grace).
    expect(tr.update([], 900)).toHaveLength(1);
    expect(tr.update([], 1200)).toHaveLength(1);
    // Third miss: hidden — nothing reported, but the identity is remembered.
    expect(tr.update([], 1500)).toHaveLength(0);
    // Back where a straight flight would have taken it: same id.
    const back = tr.update([box(0.58, 0.5, 0.03)], 1800);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(first);
  });

  it('forgets a lost bird after identityMs and mints a new id', () => {
    const tr = birdTracker();
    const first = tr.update([box(0.1, 0.5, 0.03)], 0)[0].id;
    tr.update([box(0.18, 0.5, 0.03)], 300);
    for (let t = 600; t <= 3000; t += 300) tr.update([], t);
    const back = tr.update([box(0.3, 0.5, 0.03)], 3300);
    expect(back).toHaveLength(1);
    expect(back[0].id).not.toBe(first);
  });

  it('keeps two crossing birds on their own ids', () => {
    const tr = birdTracker();
    const idsA: number[] = [];
    const idsB: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = box(0.1 + i * 0.08, 0.45, 0.03); // left → right
      const b = box(0.9 - i * 0.08, 0.55, 0.03); // right → left
      const out = tr.update([a, b], i * 300);
      expect(out).toHaveLength(2);
      const nearest = (p: PersonBox) =>
        out.reduce((best, o) =>
          Math.hypot(o.x - p.x, o.y - p.y) <
          Math.hypot(best.x - p.x, best.y - p.y)
            ? o
            : best,
        );
      idsA.push(nearest(a).id);
      idsB.push(nearest(b).id);
    }
    expect(uniqueIds(idsA)).toBe(1);
    expect(uniqueIds(idsB)).toBe(1);
    expect(idsA[0]).not.toBe(idsB[0]);
  });

  it('never lets a fresh speck hijack an established bird', () => {
    const tr = birdTracker();
    const bird = (i: number) => box(0.1 + i * 0.08, 0.5, 0.03);
    const birdId = tr.update([bird(0)], 0)[0].id;
    tr.update([bird(1)], 300);
    tr.update([bird(2)], 600);
    // A one-off speck appears just behind the bird (inside its old gate).
    const withSpeck = tr.update([bird(3), box(0.28, 0.52, 0.03)], 900);
    expect(withSpeck).toHaveLength(2);
    const nearestTo = (p: PersonBox, out: typeof withSpeck) =>
      out.reduce((best, o) =>
        Math.hypot(o.x - p.x, o.y - p.y) <
        Math.hypot(best.x - p.x, best.y - p.y)
          ? o
          : best,
      );
    expect(nearestTo(bird(3), withSpeck).id).toBe(birdId);
    // Next response the speck is gone; its tentative track (wide initiation
    // gate) must not out-bid the bird's own track for the bird's detection.
    const after = tr.update([bird(4)], 1200);
    expect(nearestTo(bird(4), after).id).toBe(birdId);
    const later = tr.update([bird(5)], 1500);
    expect(nearestTo(bird(5), later).id).toBe(birdId);
  });

  it('does not hand a big bird’s id to a tiny speck after the bird leaves', () => {
    const tr = birdTracker();
    const big = (i: number) => box(0.2 + i * 0.05, 0.5, 0.15);
    const bigId = tr.update([big(0)], 0)[0].id;
    tr.update([big(1)], 300);
    tr.update([big(2)], 600);
    // Bird gone; a speck shows up right where it would have been.
    const out = tr.update([box(0.35, 0.5, 0.02)], 900);
    const speck = out.find((o) => o.w < 0.05)!;
    expect(speck).toBeDefined();
    expect(speck.id).not.toBe(bigId);
  });

  it('merges a like-sized second box inside a matched bird, but not a much smaller one', () => {
    const tr = birdTracker();
    tr.update([box(0.5, 0.5, 0.06)], 0);
    // YOLO double box / motion halo: same bird, slightly different box.
    const dup = tr.update([box(0.5, 0.5, 0.06), box(0.51, 0.5, 0.04)], 300);
    expect(dup).toHaveLength(1);
    // A tiny bird crossing in front of a flock box is still its own target.
    const small = tr.update([box(0.5, 0.5, 0.06), box(0.51, 0.5, 0.015)], 600);
    expect(small).toHaveLength(2);
  });

  it('keeps one id under an irregular response cadence', () => {
    const tr = birdTracker();
    const v = 0.08 / 300; // per ms
    const ids: number[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const out = tr.update([box(0.1 + v * t, 0.5, 0.03)], t);
      ids.push(out[0].id);
      t += i % 2 === 0 ? 150 : 450;
    }
    expect(uniqueIds(ids)).toBe(1);
  });
});

describe('PeopleTracker — people profile (defaults)', () => {
  it('still splits a fast small mover into new ids (no widened gate)', () => {
    const tr = new PeopleTracker();
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        ...tr
          .update([box(0.1 + i * 0.08, 0.5, 0.03)], i * 300)
          .map((b) => b.id),
      );
    }
    expect(uniqueIds(ids)).toBeGreaterThan(1);
  });

  it('holds a lost person for 5 misses, then retires without identity memory', () => {
    const tr = new PeopleTracker();
    const id = tr.update([box(0.5, 0.5, 0.2)], 0)[0].id;
    for (let i = 1; i <= 5; i++) {
      const out = tr.update([], i * 300);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe(id);
    }
    expect(tr.update([], 1800)).toHaveLength(0);
    // Back in place — but the track is gone, so it is a new person.
    expect(tr.update([box(0.5, 0.5, 0.2)], 2100)[0].id).not.toBe(id);
  });

  it('matches a slow person by nearest center within the size-scaled gate', () => {
    const tr = new PeopleTracker();
    const id = tr.update([box(0.5, 0.5, 0.2)], 0)[0].id;
    // 0.1 per response is within 1.5 × 0.2 (capped at 0.12).
    expect(tr.update([box(0.6, 0.5, 0.2)], 300)[0].id).toBe(id);
    // A jump across the frame is a different person.
    const far = tr.update([box(0.6, 0.5, 0.2), box(0.1, 0.1, 0.2)], 600);
    expect(far).toHaveLength(2);
    expect(far.find((b) => b.x < 0.2)!.id).not.toBe(id);
  });
});
