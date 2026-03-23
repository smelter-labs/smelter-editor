import { describe, expect, it } from 'vitest';
import { shouldIgnoreGlobalShortcut } from '../keyboard';

describe('shouldIgnoreGlobalShortcut', () => {
  it('ignores native editable elements', () => {
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'input' } as unknown as EventTarget),
    ).toBe(true);
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'textarea' } as unknown as EventTarget),
    ).toBe(true);
  });

  it('ignores content editable targets', () => {
    expect(
      shouldIgnoreGlobalShortcut({ contentEditable: 'true' } as unknown as EventTarget),
    ).toBe(true);
  });

  it('does not ignore non-editable targets', () => {
    expect(
      shouldIgnoreGlobalShortcut({ tagName: 'button' } as unknown as EventTarget),
    ).toBe(false);
    expect(shouldIgnoreGlobalShortcut(null)).toBe(false);
  });
});
