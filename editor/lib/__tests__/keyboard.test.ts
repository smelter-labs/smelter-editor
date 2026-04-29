// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { shouldIgnoreGlobalShortcut } from '../keyboard';

describe('shouldIgnoreGlobalShortcut', () => {
  it('ignores native editable elements', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');

    expect(shouldIgnoreGlobalShortcut(input)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(textarea)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(select)).toBe(true);
  });

  it('ignores content editable targets and descendants', () => {
    const editableDiv = document.createElement('div');
    editableDiv.contentEditable = 'true';
    const paragraph = document.createElement('p');
    editableDiv.appendChild(paragraph);

    expect(shouldIgnoreGlobalShortcut(editableDiv)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(paragraph)).toBe(true);
  });

  it('does not ignore non-editable targets', () => {
    const button = document.createElement('button');

    expect(shouldIgnoreGlobalShortcut(button)).toBe(false);
    expect(shouldIgnoreGlobalShortcut(null)).toBe(false);
  });
});
