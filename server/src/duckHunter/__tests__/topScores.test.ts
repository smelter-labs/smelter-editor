import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TopScoresStore, defaultInitials } from '../topScores';

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

describe('TopScoresStore', () => {
  it('sorts by score desc then age, caps at 10, ranks inserts', () => {
    const store = new TopScoresStore(tempDir());
    for (let i = 0; i < 10; i++) {
      store.submit({ name: `P${i}`, score: i + 10, mode: 'time', at: i });
    }
    // Better than everything → rank 1; worse than everything → off the table.
    expect(store.submit({ name: 'Top', score: 99, mode: 'time', at: 50 }).rank).toBe(1);
    expect(store.submit({ name: 'Low', score: 1, mode: 'time', at: 51 }).rank).toBeNull();
    const rows = store.snapshot('time');
    expect(rows).toHaveLength(10);
    expect(rows[0].name).toBe('Top');
    // Equal scores: the earlier entry keeps the higher rank.
    expect(
      store.submit({ name: 'Late', score: 99, mode: 'time', at: 60 }).rank,
    ).toBe(2);
  });

  it('keeps modes separate', () => {
    const store = new TopScoresStore(tempDir());
    store.submit({ name: 'Timer', score: 5, mode: 'time', at: 1 });
    store.submit({ name: 'Pointer', score: 7, mode: 'points', at: 2 });
    expect(store.snapshot('time')).toHaveLength(1);
    expect(store.snapshot('points')).toHaveLength(1);
    expect(store.snapshot('points')[0].name).toBe('Pointer');
  });

  it('persists to disk and reloads in a fresh instance', async () => {
    const dir = tempDir();
    const store = new TopScoresStore(dir);
    store.submit({ name: 'Bob', score: 3, mode: 'time', at: 1 });
    await store.flush();
    const raw = JSON.parse(
      readFileSync(path.join(dir, 'top-scores.json'), 'utf-8'),
    );
    expect(raw.v).toBe(1);
    const reloaded = new TopScoresStore(dir);
    expect(reloaded.snapshot('time')).toMatchObject([
      { name: 'Bob', initials: 'BOB', score: 3 },
    ]);
  });

  it('tolerates a corrupt or alien file (starts empty, then overwrites)', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'top-scores.json'), '{not json');
    const store = new TopScoresStore(dir);
    expect(store.snapshot('time')).toEqual([]);
    writeFileSync(
      path.join(dir, 'top-scores.json'),
      JSON.stringify({ v: 1, entries: { time: [{ bogus: true }], points: 7 } }),
    );
    const store2 = new TopScoresStore(dir);
    expect(store2.snapshot('time')).toEqual([]);
    expect(store2.snapshot('points')).toEqual([]);
  });
});
