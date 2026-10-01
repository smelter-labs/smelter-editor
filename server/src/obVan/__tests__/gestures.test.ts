import { describe, expect, it } from 'vitest';
import type { ObEffects } from '@smelter-editor/types';
import {
  describeObGestureCommand,
  isObGestureName,
  obGestureCommand,
} from '../gestures';

const effects = (over: Partial<ObEffects> = {}): ObEffects => ({
  grade: 'none',
  spotlight: false,
  softBackground: true,
  ...over,
});

describe('gestures → commands', () => {
  it('open palm toggles the spotlight against the current effects', () => {
    expect(obGestureCommand('open_palm', effects())).toEqual({
      op: 'fx',
      effects: { spotlight: true },
    });
    expect(obGestureCommand('open_palm', effects({ spotlight: true }))).toEqual(
      { op: 'fx', effects: { spotlight: false } },
    );
  });

  it('thumbs-up / peace grade; a fist clears everything', () => {
    expect(obGestureCommand('thumbs_up', effects())).toEqual({
      op: 'fx',
      effects: { grade: 'neon' },
    });
    expect(obGestureCommand('peace', effects())).toEqual({
      op: 'fx',
      effects: { grade: 'vhs' },
    });
    expect(
      obGestureCommand('fist', effects({ grade: 'neon', spotlight: true })),
    ).toEqual({ op: 'fx', effects: { grade: 'none', spotlight: false } });
  });

  it('isObGestureName accepts only the known names', () => {
    expect(isObGestureName('open_palm')).toBe(true);
    expect(isObGestureName('peace')).toBe(true);
    expect(isObGestureName('wave')).toBe(false);
    expect(isObGestureName(3)).toBe(false);
  });

  it('describes the command for the log', () => {
    expect(
      describeObGestureCommand({ op: 'fx', effects: { grade: 'neon' } }),
    ).toBe('grade neon');
    expect(
      describeObGestureCommand({
        op: 'fx',
        effects: { grade: 'none', spotlight: false },
      }),
    ).toBe('clear · spotlight off');
    expect(
      describeObGestureCommand({ op: 'fx', effects: { spotlight: true } }),
    ).toBe('spotlight on');
  });
});
