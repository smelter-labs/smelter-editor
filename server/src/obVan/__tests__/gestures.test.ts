import { describe, expect, it } from 'vitest';
import {
  describeObGestureCommand,
  isObGestureName,
  obGestureCommand,
} from '../gestures';

describe('gestures → commands', () => {
  it('every gesture command is scoped to the camera it was seen on', () => {
    for (const name of ['open_palm', 'thumbs_up', 'peace', 'fist'] as const) {
      const cmd = obGestureCommand(name, 'cam-7', {});
      expect(cmd.op).toBe('fx');
      expect(cmd.op === 'fx' && cmd.camId).toBe('cam-7');
    }
  });

  it("open palm toggles the camera's own spotlight override", () => {
    expect(obGestureCommand('open_palm', 'c1', {})).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { spotlight: true },
    });
    expect(obGestureCommand('open_palm', 'c1', { spotlight: true })).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { spotlight: false },
    });
    // A show-wide grade on air does not change the toggle: only the
    // camera's own override counts.
    expect(obGestureCommand('open_palm', 'c1', { grade: 'neon' })).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { spotlight: true },
    });
  });

  it('thumbs-up / peace grade; a fist clears the camera', () => {
    expect(obGestureCommand('thumbs_up', 'c1', {})).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { grade: 'neon' },
    });
    expect(obGestureCommand('peace', 'c1', {})).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { grade: 'vhs' },
    });
    expect(
      obGestureCommand('fist', 'c1', { grade: 'neon', spotlight: true }),
    ).toEqual({
      op: 'fx',
      camId: 'c1',
      effects: { grade: 'none', spotlight: false },
    });
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
