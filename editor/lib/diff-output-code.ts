import { diffArrays, diffWordsWithSpace } from 'diff';

export type TextRange = { start: number; end: number };

export type CodeDiffHighlight = {
  /** Character ranges in the new code to highlight (1-based line numbers) */
  changedRanges: Map<number, TextRange[]>;
  /** Lines removed from the previous version */
  removedLines: string[];
  /** Lines added in the new version */
  addedLines: string[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
};

const EMPTY_HIGHLIGHT: CodeDiffHighlight = {
  changedRanges: new Map(),
  removedLines: [],
  addedLines: [],
  addedCount: 0,
  removedCount: 0,
  changedCount: 0,
};

export function getChangedCharacterRanges(
  oldLine: string,
  newLine: string,
): TextRange[] {
  if (oldLine === newLine) return [];

  const parts = diffWordsWithSpace(oldLine, newLine);
  const ranges: TextRange[] = [];
  let offset = 0;

  for (const part of parts) {
    if (part.added) {
      ranges.push({ start: offset, end: offset + part.value.length });
      offset += part.value.length;
    } else if (!part.removed) {
      offset += part.value.length;
    }
  }

  return ranges;
}

export function computeCodeDiff(prev: string, next: string): CodeDiffHighlight {
  if (prev === next || !prev) {
    return {
      changedRanges: new Map(),
      removedLines: [],
      addedLines: [],
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
    };
  }

  const prevLines = prev.split('\n');
  const nextLines = next.split('\n');
  const parts = diffArrays(prevLines, nextLines);

  const changedRanges = new Map<number, TextRange[]>();
  const removedLines: string[] = [];
  const addedLines: string[] = [];
  let nextLineNum = 1;
  let addedCount = 0;
  let removedCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.removed && !part.added) {
      const nextPart = parts[i + 1];
      if (nextPart?.added && !nextPart.removed) {
        const removed = part.value as string[];
        const added = nextPart.value as string[];

        for (let j = 0; j < added.length; j++) {
          const oldLine = removed[j] ?? '';
          const newLine = added[j]!;
          if (oldLine && oldLine !== newLine) {
            removedLines.push(oldLine);
            removedCount++;
            addedLines.push(newLine);
          }
          const ranges = getChangedCharacterRanges(oldLine, newLine);
          if (ranges.length > 0) {
            changedRanges.set(nextLineNum, ranges);
          }
          nextLineNum++;
          addedCount++;
        }

        for (let j = added.length; j < removed.length; j++) {
          removedLines.push(removed[j]!);
          removedCount++;
        }

        i++;
        continue;
      }

      removedLines.push(...(part.value as string[]));
      removedCount += part.value.length;
      continue;
    }

    if (part.added && !part.removed) {
      for (const line of part.value as string[]) {
        changedRanges.set(nextLineNum, [{ start: 0, end: line.length }]);
        addedLines.push(line);
        nextLineNum++;
        addedCount++;
      }
      continue;
    }

    if (!part.added && !part.removed) {
      nextLineNum += part.value.length;
    }
  }

  if (
    changedRanges.size === 0 &&
    removedLines.length === 0 &&
    addedLines.length === 0
  ) {
    return EMPTY_HIGHLIGHT;
  }

  return {
    changedRanges,
    removedLines,
    addedLines,
    addedCount,
    removedCount,
    changedCount: changedRanges.size,
  };
}

export function hasCodeDiff(highlight: CodeDiffHighlight): boolean {
  return highlight.changedCount > 0 || highlight.removedCount > 0;
}
