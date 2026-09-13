import { describe, expect, it } from 'vitest';
import type { BbUltraAiStatus } from '@smelter-editor/types';
import {
  ultraAiChipLabel,
  ultraAiChipTitle,
  ultraAiChipTone,
} from '../ultra-ai-helpers';

const ALL: BbUltraAiStatus[] = [
  'off',
  'no_clip',
  'loading',
  'armed',
  'no_events',
];

describe('ultraAiChipLabel', () => {
  it('names every status and never leaks the replay vocabulary', () => {
    expect(ALL.map(ultraAiChipLabel)).toEqual([
      'ULTRA AI · OFF',
      'ULTRA AI · NO CLIP',
      'ULTRA AI · LOADING',
      'ULTRA AI · ARMED',
      'ULTRA AI · NO PLAYS',
    ]);
    for (const s of ALL) {
      const text = `${ultraAiChipLabel(s)} ${ultraAiChipTitle(s, true)} ${ultraAiChipTitle(s, false)}`;
      expect(text).not.toMatch(/ground|truth|replay|events\.json|\bGT\b/i);
    }
  });
});

describe('ultraAiChipTone', () => {
  it('is amber only when the clip has no plays', () => {
    expect(ultraAiChipTone('no_events')).toBe('amber');
    for (const s of ALL.filter((x) => x !== 'no_events')) {
      expect(ultraAiChipTone(s)).toBe('electric');
    }
  });
});

describe('ultraAiChipTitle', () => {
  it('tells an operator without a clip what to do first', () => {
    expect(ultraAiChipTitle('off', false)).toMatch(/USE FILE/);
    expect(ultraAiChipTitle('off', true)).not.toMatch(/USE FILE/);
    expect(ultraAiChipTitle('no_clip', false)).toMatch(/USE FILE/);
    expect(ultraAiChipTitle('no_events', true)).toMatch(/live model/);
  });
});
