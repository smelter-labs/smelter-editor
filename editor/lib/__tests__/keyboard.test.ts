import { describe, expect, it } from 'vitest';
import { shouldIgnoreGlobalShortcut } from '../keyboard';

describe('shouldIgnoreGlobalShortcut', () => {
  it('ignores native editable elements', () => {
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'input' } as EventTarget),
    ).toBe(true);
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'textarea' } as EventTarget),
    ).toBe(true);
  });

  it('ignores content editable targets', () => {
    expect(
      shouldIgnoreGlobalShortcut({ contentEditable: 'true' } as EventTarget),
    ).toBe(true);
  });

  it('does not ignore non-editable targets', () => {
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'button' } as EventTarget),
    ).toBe(false);
    expect(shouldIgnoreGlobalShortcut(null)).toBe(false);
  });
});
