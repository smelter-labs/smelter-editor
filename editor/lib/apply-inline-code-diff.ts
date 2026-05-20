import type { CSSProperties } from 'react';
import type { TextRange } from './diff-output-code';

export type SyntaxTreeNode = {
  type: 'text' | 'element';
  tagName?: string;
  value?: string;
  properties?: {
    className?: string[];
    style?: CSSProperties;
    key?: string;
  };
  children?: SyntaxTreeNode[];
};

const DIFF_HIGHLIGHT_STYLE: CSSProperties = {
  backgroundColor: 'rgba(0, 243, 255, 0.1)',
  boxShadow: 'inset 0 0 0 1px rgba(0, 243, 255, 0.35)',
  borderRadius: '2px',
  boxDecorationBreak: 'clone',
  color: '#00f3ff',
};

function isLineNumberNode(node: SyntaxTreeNode): boolean {
  return node.properties?.className?.includes('linenumber') ?? false;
}

function splitTextNode(
  text: string,
  absoluteStart: number,
  ranges: TextRange[],
): SyntaxTreeNode[] {
  if (!text) return [];

  const absoluteEnd = absoluteStart + text.length;
  const relevant = ranges.filter(
    (range) => range.end > absoluteStart && range.start < absoluteEnd,
  );
  if (relevant.length === 0) {
    return [{ type: 'text', value: text }];
  }

  const splitPoints = new Set<number>([0, text.length]);
  for (const range of relevant) {
    splitPoints.add(Math.max(0, range.start - absoluteStart));
    splitPoints.add(Math.min(text.length, range.end - absoluteStart));
  }

  const points = [...splitPoints].sort((a, b) => a - b);
  const parts: SyntaxTreeNode[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (start === end) continue;

    const segment = text.slice(start, end);
    const segmentStart = absoluteStart + start;
    const segmentEnd = absoluteStart + end;
    const isChanged = relevant.some(
      (range) => range.start < segmentEnd && range.end > segmentStart,
    );

    if (isChanged) {
      parts.push({
        type: 'element',
        tagName: 'mark',
        properties: {
          className: ['output-code-diff'],
          style: DIFF_HIGHLIGHT_STYLE,
        },
        children: [{ type: 'text', value: segment }],
      });
    } else {
      parts.push({ type: 'text', value: segment });
    }
  }

  return parts;
}

function applyRangesToNode(
  node: SyntaxTreeNode,
  ranges: TextRange[],
  offset: { value: number },
): SyntaxTreeNode[] {
  if (isLineNumberNode(node)) {
    return [node];
  }

  if (node.type === 'text') {
    const text = node.value ?? '';
    const start = offset.value;
    offset.value += text.length;
    return splitTextNode(text, start, ranges);
  }

  if (node.children) {
    const children = node.children.flatMap((child) =>
      applyRangesToNode(child, ranges, offset),
    );
    return [{ ...node, children }];
  }

  return [node];
}

export function applyInlineDiffHighlights(
  row: SyntaxTreeNode,
  ranges: TextRange[],
): SyntaxTreeNode {
  if (ranges.length === 0) return row;

  const offset = { value: 0 };
  const children = (row.children ?? []).flatMap((child) =>
    applyRangesToNode(child, ranges, offset),
  );

  return { ...row, children };
}
