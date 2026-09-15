import { describe, expect, it } from 'vitest';
import type { FbAiLogEntry } from '@smelter-editor/types';
import { aiLogTime, aiLogToneKey, mergeAiLog } from '../ai-log-helpers';

const entry = (id: number, label = 'CHANCE'): FbAiLogEntry => ({
  id,
  atMs: id * 1000,
  kind: 'event',
  tone: 'grass',
  label,
  text: `e${id}`,
});

describe('mergeAiLog', () => {
  it('replaces the list on a reset snapshot', () => {
    const prev = [entry(9)];
    const next = mergeAiLog(
      prev,
      {
        type: 'fb_ai_log',
        roomId: 'r',
        reset: true,
        entries: [entry(3), entry(2)],
      },
      60,
    );
    expect(next.map((e) => e.id)).toEqual([3, 2]);
  });

  it('prepends a batch newest-first and drops known ids', () => {
    const prev = [entry(2), entry(1)];
    const next = mergeAiLog(
      prev,
      {
        type: 'fb_ai_log',
        roomId: 'r',
        entries: [entry(2), entry(3), entry(4)],
      },
      60,
    );
    expect(next.map((e) => e.id)).toEqual([4, 3, 2, 1]);
  });

  it('caps the list', () => {
    const prev = [entry(2), entry(1)];
    const next = mergeAiLog(
      prev,
      { type: 'fb_ai_log', roomId: 'r', entries: [entry(3)] },
      2,
    );
    expect(next.map((e) => e.id)).toEqual([3, 2]);
  });

  it('returns the same list when nothing is new', () => {
    const prev = [entry(2)];
    expect(
      mergeAiLog(
        prev,
        { type: 'fb_ai_log', roomId: 'r', entries: [entry(2)] },
        60,
      ),
    ).toBe(prev);
  });
});

describe('aiLogTime', () => {
  it('formats ages', () => {
    expect(aiLogTime(0, 3000)).toBe('3s');
    expect(aiLogTime(0, 72_000)).toBe('1m12s');
    expect(aiLogTime(0, 14 * 60_000)).toBe('14m');
    expect(aiLogTime(0, 2 * 3_600_000)).toBe('2h');
  });
});

describe('aiLogToneKey', () => {
  it('maps the grass tone onto the kit accent', () => {
    expect(aiLogToneKey('grass')).toBe('electric');
    expect(aiLogToneKey('amber')).toBe('amber');
  });
});
