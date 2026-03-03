import { describe, expect, it } from 'vitest';
import { parseMacroControlCommand } from '../useVoiceCommands';

describe('parseMacroControlCommand', () => {
  it('detects autoplay toggle commands', () => {
    expect(parseMacroControlCommand('enable auto play macro')).toBe(
      'ENABLE_AUTO_PLAY',
    );
    expect(parseMacroControlCommand('turn off macro auto play')).toBe(
      'DISABLE_AUTO_PLAY',
    );
  });

  it('detects step-by-step execution controls', () => {
    expect(parseMacroControlCommand('next step')).toBe('NEXT_STEP');
    expect(parseMacroControlCommand('run next step')).toBe('NEXT_STEP');
    expect(parseMacroControlCommand('play macro')).toBe('PLAY_MACRO');
    expect(parseMacroControlCommand('resume macro')).toBe('PLAY_MACRO');
  });

  it('detects stop execution command variants', () => {
    expect(parseMacroControlCommand('stop macro now')).toBe('STOP_EXECUTION');
    expect(parseMacroControlCommand('cancel macro execution')).toBe(
      'STOP_EXECUTION',
    );
    expect(parseMacroControlCommand('abort macro')).toBe('STOP_EXECUTION');
  });

  it('does not capture unrelated macro mode commands', () => {
    expect(parseMacroControlCommand('start macro mode')).toBeNull();
    expect(parseMacroControlCommand('end macro')).toBeNull();
    expect(parseMacroControlCommand('galactic transmission')).toBeNull();
  });
});
