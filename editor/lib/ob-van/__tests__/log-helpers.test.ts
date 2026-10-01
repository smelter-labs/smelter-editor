import { describe, expect, it } from 'vitest';
import type { ObLogEntry } from '@smelter-editor/types';
import {
  isCutEntry,
  mergeObLog,
  reasonsLine,
  sourceTone,
} from '../log-helpers';

const entry = (id: number, patch: Partial<ObLogEntry> = {}): ObLogEntry => ({
  id,
  atMs: 1000 + id,
  source: 'auto',
  kind: 'cut',
  tone: 'good',
  label: 'CUT',
  text: `cam ${id}`,
  ...patch,
});

describe('mergeObLog', () => {
  it('merges newest first and dedupes by id (a re-sent entry wins)', () => {
    const prev = [entry(2), entry(1)];
    const out = mergeObLog(prev, [entry(3), entry(2, { text: 'updated' })]);
    expect(out.map((e) => e.id)).toEqual([3, 2, 1]);
    expect(out[1].text).toBe('updated');
  });

  it('caps the list', () => {
    const batch = Array.from({ length: 10 }, (_, i) => entry(i + 1));
    expect(mergeObLog([], batch, false, 4).map((e) => e.id)).toEqual([
      10, 9, 8, 7,
    ]);
  });

  it('reset replaces the list; an empty reset clears it', () => {
    expect(mergeObLog([entry(5)], [entry(1)], true).map((e) => e.id)).toEqual([
      1,
    ]);
    expect(mergeObLog([entry(5)], [], true)).toEqual([]);
  });

  it('an empty batch keeps the same array (no re-render)', () => {
    const prev = [entry(1)];
    expect(mergeObLog(prev, [])).toBe(prev);
  });
});

describe('log formatting', () => {
  it('joins reasons and folds the overflow', () => {
    expect(reasonsLine({ text: '', reasons: ['a', ' ', 'b'] })).toBe('a · b');
    expect(reasonsLine({ text: '', reasons: ['a', 'b', 'c'] }, 2)).toBe(
      'a · b · +1',
    );
    expect(reasonsLine({ text: '' })).toBe('');
  });

  it('maps sources to tones and knows cuts', () => {
    expect(sourceTone('operator')).toBe('chalk');
    expect(sourceTone('auto')).toBe('good');
    expect(sourceTone('llm')).toBe('ai');
    expect(sourceTone('system')).toBe('dim');
    expect(isCutEntry({ kind: 'take' })).toBe(true);
    expect(isCutEntry({ kind: 'fx' })).toBe(false);
  });
});
