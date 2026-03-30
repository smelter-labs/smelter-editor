// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { shouldIgnoreGlobalShortcut } from '../keyboard';

describe('shouldIgnoreGlobalShortcut', () => {
  it('ignores native editable elements', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');

    expect(shouldIgnoreGlobalShortcut(input)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(textarea)).toBe(true);
  });

  it('ignores content editable targets', () => {
    const editableDiv = document.createElement('div');
    editableDiv.contentEditable = 'true';

    expect(shouldIgnoreGlobalShortcut(editableDiv)).toBe(true);
  });

  it('does not ignore non-editable targets', () => {
    const button = document.createElement('button');

    expect(shouldIgnoreGlobalShortcut(button)).toBe(false);
    expect(shouldIgnoreGlobalShortcut(null)).toBe(false);
  });
});
