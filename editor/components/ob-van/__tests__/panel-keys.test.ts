import { describe, expect, it } from 'vitest';
import { OB_TRANSITION_TYPES } from '@smelter-editor/types';
import {
  nextTransitionType,
  panelKeyToCommand,
  type PanelKeyContext,
} from '../panel/panel-keys';

const cams = [
  { id: 'a', number: 1, connected: true },
  { id: 'b', number: 2, connected: true },
  { id: 'c', number: 3, connected: false },
];

function ctx(over: Partial<PanelKeyContext> = {}): PanelKeyContext {
  return {
    cams,
    preview: { kind: 'solo', cam: 'b' },
    program: { kind: 'solo', cam: 'a' },
    autoOn: false,
    transitionType: 'dissolve',
    lowerThirdCamId: null,
    rundownLength: 0,
    replayEnabled: false,
    ...over,
  };
}

describe('panelKeyToCommand — digits', () => {
  it('maps a digit to that camera number on preview', () => {
    expect(panelKeyToCommand('2', ctx())).toEqual({
      op: 'preview',
      shot: { kind: 'solo', cam: 'b' },
    });
    expect(panelKeyToCommand('3', ctx())).toEqual({
      op: 'preview',
      shot: { kind: 'solo', cam: 'c' },
    });
  });
  it('returns null for a number with no camera', () => {
    expect(panelKeyToCommand('7', ctx())).toBeNull();
    expect(panelKeyToCommand('0', ctx())).toBeNull();
  });
});

describe('panelKeyToCommand — transport', () => {
  it('Enter takes only with a preview', () => {
    expect(panelKeyToCommand('Enter', ctx())).toEqual({ op: 'take' });
    expect(panelKeyToCommand('Enter', ctx({ preview: null }))).toBeNull();
  });
  it('Space and . cut only with a preview', () => {
    expect(panelKeyToCommand(' ', ctx())).toEqual({ op: 'cut' });
    expect(panelKeyToCommand('.', ctx())).toEqual({ op: 'cut' });
    expect(panelKeyToCommand(' ', ctx({ preview: null }))).toBeNull();
    expect(panelKeyToCommand('.', ctx({ preview: null }))).toBeNull();
  });
  it('A toggles the auto pilot', () => {
    expect(panelKeyToCommand('a', ctx())).toEqual({
      op: 'auto',
      enabled: true,
    });
    expect(panelKeyToCommand('A', ctx({ autoOn: true }))).toEqual({
      op: 'auto',
      enabled: false,
    });
  });
});

describe('panelKeyToCommand — lower third', () => {
  it('L shows the lower third of the preview camera', () => {
    expect(panelKeyToCommand('l', ctx())).toEqual({
      op: 'lower_third',
      camId: 'b',
    });
  });
  it('L clears when the preview camera already has it', () => {
    expect(panelKeyToCommand('L', ctx({ lowerThirdCamId: 'b' }))).toEqual({
      op: 'lower_third',
      clear: true,
    });
  });
  it('L falls back to the program camera without a preview', () => {
    expect(panelKeyToCommand('l', ctx({ preview: null }))).toEqual({
      op: 'lower_third',
      camId: 'a',
    });
  });
  it('L does nothing with neither preview nor program', () => {
    expect(
      panelKeyToCommand('l', ctx({ preview: null, program: null })),
    ).toBeNull();
  });
});

describe('panelKeyToCommand — transition, rundown, replay', () => {
  it('T moves to the next transition type', () => {
    expect(panelKeyToCommand('t', ctx())).toEqual({
      op: 'transition',
      transition: { type: nextTransitionType('dissolve') },
    });
  });
  it('N needs a rundown', () => {
    expect(panelKeyToCommand('n', ctx())).toBeNull();
    expect(panelKeyToCommand('N', ctx({ rundownLength: 3 }))).toEqual({
      op: 'segment',
      action: 'next',
    });
  });
  it('R only when replay is enabled, on the program camera', () => {
    expect(panelKeyToCommand('r', ctx())).toBeNull();
    expect(panelKeyToCommand('R', ctx({ replayEnabled: true }))).toEqual({
      op: 'replay',
      camId: 'a',
    });
    expect(
      panelKeyToCommand('r', ctx({ replayEnabled: true, program: null })),
    ).toEqual({ op: 'replay' });
  });
  it('ignores unmapped keys', () => {
    expect(panelKeyToCommand('x', ctx())).toBeNull();
    expect(panelKeyToCommand('Escape', ctx())).toBeNull();
  });
});

describe('nextTransitionType', () => {
  it('cycles through every type and wraps', () => {
    const seen: string[] = [];
    let t = OB_TRANSITION_TYPES[0];
    for (let i = 0; i < OB_TRANSITION_TYPES.length; i++) {
      seen.push(t);
      t = nextTransitionType(t);
    }
    expect(new Set(seen).size).toBe(OB_TRANSITION_TYPES.length);
    expect(t).toBe(OB_TRANSITION_TYPES[0]);
  });
});
