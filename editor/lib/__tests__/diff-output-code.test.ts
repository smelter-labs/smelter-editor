import { describe, expect, it } from 'vitest';
import {
  computeCodeDiff,
  getChangedCharacterRanges,
  hasCodeDiff,
} from '../diff-output-code';

describe('getChangedCharacterRanges', () => {
  it('returns empty array for identical lines', () => {
    expect(getChangedCharacterRanges('width={640}', 'width={640}')).toEqual([]);
  });

  it('highlights only changed values within a line', () => {
    const ranges = getChangedCharacterRanges(
      '        width={640}',
      '        width={800}',
    );
    expect(ranges.length).toBeGreaterThan(0);
    const highlighted = ranges
      .map((range) => '        width={800}'.slice(range.start, range.end))
      .join('');
    expect(highlighted).toContain('800');
    expect(highlighted).not.toContain('width=');
  });
});

describe('computeCodeDiff', () => {
  it('returns empty diff for identical strings', () => {
    const diff = computeCodeDiff('line1\nline2', 'line1\nline2');
    expect(hasCodeDiff(diff)).toBe(false);
    expect(diff.changedRanges.size).toBe(0);
    expect(diff.removedLines).toEqual([]);
  });

  it('returns empty diff on first render (empty prev)', () => {
    const diff = computeCodeDiff('', 'line1\nline2');
    expect(hasCodeDiff(diff)).toBe(false);
  });

  it('highlights added lines in new code', () => {
    const diff = computeCodeDiff('line1', 'line1\nline2');
    expect(diff.addedCount).toBe(1);
    expect(diff.changedRanges.has(2)).toBe(true);
    expect(diff.changedRanges.get(2)).toEqual([{ start: 0, end: 5 }]);
    expect(diff.removedLines).toEqual([]);
  });

  it('collects removed lines', () => {
    const diff = computeCodeDiff('line1\nline2', 'line1');
    expect(diff.removedCount).toBe(1);
    expect(diff.removedLines).toEqual(['line2']);
    expect(diff.changedRanges.size).toBe(0);
  });

  it('highlights only changed segments in modified lines', () => {
    const diff = computeCodeDiff('line1\nold-value', 'line1\nnew-value');
    expect(diff.removedLines).toEqual(['old-value']);
    expect(diff.removedCount).toBe(1);
    expect(diff.changedRanges.has(2)).toBe(true);

    const ranges = diff.changedRanges.get(2)!;
    const highlighted = ranges
      .map((range) => 'new-value'.slice(range.start, range.end))
      .join('');
    expect(highlighted).toContain('new');
    expect(highlighted).not.toContain('old');
  });
});
