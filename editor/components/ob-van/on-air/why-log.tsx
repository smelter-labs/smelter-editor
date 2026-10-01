'use client';

import React from 'react';
import type { ObLogEntry } from '@smelter-editor/types';
import {
  LOG_TONE_COLOR_KEY,
  logTime,
  reasonsLine,
  sourceTone,
} from '@/lib/ob-van/log-helpers';
import { SOURCE_LABEL } from '@/lib/ob-van/view-labels';
import { Meta, Mono, OB, TagChip, type TagTone } from '../ob-kit';

const SOURCE_TAG: Record<ReturnType<typeof sourceTone>, TagTone> = {
  chalk: 'chalk',
  good: 'preview',
  ai: 'accent',
  dim: 'dim',
};

const TONE_COLOR: Record<
  (typeof LOG_TONE_COLOR_KEY)[keyof typeof LOG_TONE_COLOR_KEY],
  string
> = {
  dim: OB.dim,
  chalk: OB.chalk,
  good: OB.preview,
  amber: OB.amber,
  bad: OB.program,
  accent: OB.accent,
};

/** One WHY line: time · source badge · label · text, reasons underneath. */
export function WhyLine({
  entry,
  compact = false,
}: {
  entry: ObLogEntry;
  compact?: boolean;
}) {
  const reasons = reasonsLine(entry, compact ? 2 : 4);
  return (
    <div
      className='ob-slide'
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: compact ? '3px 0' : '5px 0',
        borderBottom: `1px solid ${OB.rule}`,
        minWidth: 0,
      }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Mono
          size={9}
          color={OB.dim2}
          tracking={0.04}
          style={{ flexShrink: 0 }}>
          {logTime(entry.atMs)}
        </Mono>
        <TagChip tone={SOURCE_TAG[sourceTone(entry.source)]} size={8}>
          {SOURCE_LABEL[entry.source]}
        </TagChip>
        <Mono
          size={10}
          weight={600}
          tracking={0.1}
          color={TONE_COLOR[LOG_TONE_COLOR_KEY[entry.tone]]}
          style={{ flexShrink: 0 }}>
          {entry.label}
        </Mono>
        <Mono
          size={10}
          tracking={0.02}
          uppercase={false}
          color={OB.chalk}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {entry.text}
        </Mono>
      </div>
      {reasons ? (
        <Mono
          size={9}
          tracking={0.02}
          uppercase={false}
          color={OB.dim}
          style={{
            paddingLeft: 56,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: compact ? 'nowrap' : 'normal',
          }}>
          {reasons}
        </Mono>
      ) : null}
    </div>
  );
}

/**
 * The WHY log: the newest entries, each cut with its source (OP / AUTO /
 * LLM) and the reasons the director gave.
 */
export function WhyLog({
  entries,
  max = 8,
}: {
  entries: ObLogEntry[];
  max?: number;
}) {
  if (entries.length === 0)
    return (
      <Meta size={9.5} tracking={0.06}>
        every cut lands here with its reason
      </Meta>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {entries.slice(0, max).map((e) => (
        <WhyLine key={e.id} entry={e} />
      ))}
    </div>
  );
}
