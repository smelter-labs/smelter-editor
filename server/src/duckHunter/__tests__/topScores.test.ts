import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TopScoresStore, defaultInitials, variantKey } from '../topScores';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'duck-top-scores-'));
}

describe('defaultInitials', () => {
  it('uppercases, strips symbols, pads to 3', () => {
    expect(defaultInitials('piotr')).toBe('PIO');
    expect(defaultInitials('x!')).toBe('XAA');
    expect(defaultInitials('***')).toBe('AAA');
  });
});

describe('variantKey', () => {
  it('keys by mode plus its knob', () => {
    expect(variantKey({ mode: 'time', durationMs: 60_000 })).toBe('time:60000');
    expect(variantKey({ mode: 'points', targetScore: 25 })).toBe('points:25');
    // The other mode's knob never leaks into the key.
    expect(
      variantKey({ mode: 'time', durationMs: 30_000, targetScore: 25 }),
    ).toBe('time:30000');
  });
});

describe('TopScoresStore', () => {
  it('sorts by score desc then age, caps at 10, ranks inserts', () => {
    const store = new TopScoresStore(tempDir());
    const variant = { mode: 'time', durationMs: 60_000 } as const;
    for (let i = 0; i < 10; i++) {
      store.submit({ name: `P${i}`, score: i + 10, ...variant, at: i });
    }
    // Better than everything → rank 1; worse than everything → off the table.
    expect(
      store.submit({ name: 'Top', score: 99, ...variant, at: 50 }).rank,
    ).toBe(1);
    expect(
      store.submit({ name: 'Low', score: 1, ...variant, at: 51 }).rank,
    ).toBeNull();
    const rows = store.snapshot(variant);
    expect(rows).toHaveLength(10);
    expect(rows[0].name).toBe('Top');
    // Equal scores: the earlier entry keeps the higher rank.
    expect(
      store.submit({ name: 'Late', score: 99, ...variant, at: 60 }).rank,
    ).toBe(2);
  });

  it('keeps round variants separate, not just modes', () => {
    const store = new TopScoresStore(tempDir());
    store.submit({
      name: 'Short',
      score: 5,
      mode: 'time',
      durationMs: 30_000,
      at: 1,
    });
    store.submit({
      name: 'Long',
      score: 40,
      mode: 'time',
      durationMs: 120_000,
      at: 2,
    });
    store.submit({
      name: 'Pointer',
      score: 25,
      mode: 'points',
      targetScore: 25,
      at: 3,
    });
    // A 30s score never competes with a 120s one…
    expect(store.snapshot({ mode: 'time', durationMs: 30_000 })).toMatchObject([
      { name: 'Short' },
    ]);
    expect(store.snapshot({ mode: 'time', durationMs: 120_000 })).toMatchObject(
      [{ name: 'Long' }],
    );
    expect(store.snapshot({ mode: 'time', durationMs: 60_000 })).toEqual([]);
    // …and points targets are variants of their own.
    expect(store.snapshot({ mode: 'points', targetScore: 25 })).toMatchObject([
      { name: 'Pointer' },
    ]);
    expect(store.snapshot({ mode: 'points', targetScore: 50 })).toEqual([]);
  });

  it('snapshotAll returns every variant keyed by variantKey', () => {
    const store = new TopScoresStore(tempDir());
    store.submit({
      name: 'A',
      score: 1,
      mode: 'time',
      durationMs: 30_000,
      at: 1,
    });
    store.submit({
      name: 'B',
      score: 2,
      mode: 'points',
      targetScore: 10,
      at: 2,
    });
    const all = store.snapshotAll();
    expect(Object.keys(all).sort()).toEqual(['points:10', 'time:30000']);
    expect(all['time:30000'][0].name).toBe('A');
  });

  it('persists to disk and reloads in a fresh instance', async () => {
    const dir = tempDir();
    const store = new TopScoresStore(dir);
    store.submit({
      name: 'Bob',
      score: 3,
      mode: 'time',
      durationMs: 60_000,
      at: 1,
    });
    await store.flush();
    const raw = JSON.parse(
      readFileSync(path.join(dir, 'top-scores.json'), 'utf-8'),
    );
    expect(raw.v).toBe(2);
    const reloaded = new TopScoresStore(dir);
    expect(
      reloaded.snapshot({ mode: 'time', durationMs: 60_000 }),
    ).toMatchObject([
      { name: 'Bob', initials: 'BOB', score: 3, durationMs: 60_000 },
    ]);
  });

  it('tolerates a corrupt, alien or legacy-v1 file (starts empty)', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'top-scores.json'), '{not json');
    const store = new TopScoresStore(dir);
    expect(store.snapshotAll()).toEqual({});

    writeFileSync(
      path.join(dir, 'top-scores.json'),
      JSON.stringify({ v: 2, tables: { 'time:60000': [{ bogus: true }] } }),
    );
    const store2 = new TopScoresStore(dir);
    expect(store2.snapshotAll()).toEqual({});

    // v1 rows never recorded their round variant — there is no honest table
    // to migrate them into, so a v1 file reads as empty.
    writeFileSync(
      path.join(dir, 'top-scores.json'),
      JSON.stringify({
        v: 1,
        entries: {
          time: [
            { initials: 'BOB', name: 'Bob', score: 3, mode: 'time', at: 1 },
          ],
          points: [],
        },
      }),
    );
    const store3 = new TopScoresStore(dir);
    expect(store3.snapshotAll()).toEqual({});
  });
});
