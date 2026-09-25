import { describe, expect, it } from 'vitest';
import type { ObShot } from '@smelter-editor/types';
import {
  mainCamOf,
  shotCamIds,
  tallyFor,
  tallyMap,
  tallyVibration,
} from '../tally';

const solo = (cam: string): ObShot => ({ kind: 'solo', cam });

describe('tally', () => {
  it('program wins over preview', () => {
    const program: ObShot = { kind: 'split', cams: ['a', 'b'] };
    expect(tallyFor('a', program, solo('a'))).toBe('program');
    expect(tallyFor('b', program, solo('c'))).toBe('program');
    expect(tallyFor('c', program, solo('c'))).toBe('preview');
    expect(tallyFor('d', program, solo('c'))).toBe('off');
    expect(tallyFor('a', null, null)).toBe('off');
  });

  it('an empty grid means every live camera', () => {
    const grid: ObShot = { kind: 'grid', cams: [] };
    expect(shotCamIds(grid, ['a', 'b'])).toEqual(['a', 'b']);
    const map = tallyMap(
      [
        { id: 'a', live: true },
        { id: 'b', live: false },
      ],
      grid,
      null,
    );
    expect(map).toEqual({ a: 'program', b: 'off' });
  });

  it('pip / slides count both cameras, main first', () => {
    const pip: ObShot = { kind: 'pip', main: 'a', inset: 'b' };
    expect(tallyFor('b', pip, null)).toBe('program');
    expect(mainCamOf(pip)).toBe('a');
    expect(
      mainCamOf({ kind: 'speaker-slides', speaker: 's', slides: 'x' }),
    ).toBe('s');
    expect(mainCamOf(null)).toBeNull();
  });

  it('vibrates going on air and briefly coming off', () => {
    expect(tallyVibration('off', 'program')).toEqual([200, 100, 200]);
    expect(tallyVibration('preview', 'program')).toEqual([200, 100, 200]);
    expect(tallyVibration('program', 'off')).toEqual([80]);
    expect(tallyVibration('off', 'preview')).toBeNull();
    expect(tallyVibration(null, 'program')).toBeNull();
    expect(tallyVibration('program', 'program')).toBeNull();
  });
});
