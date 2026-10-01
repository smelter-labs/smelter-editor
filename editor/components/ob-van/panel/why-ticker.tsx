'use client';

import React from 'react';
import type { ObLogEntry } from '@smelter-editor/types';
import { logTime, reasonsLine, sourceTone } from '@/lib/ob-van/log-helpers';
import { SOURCE_LABEL } from '@/lib/ob-van/view-labels';
import {
  Copy,
  Meta,
  Mono,
  OB,
  ObPlate,
  TagChip,
  type TagTone,
} from '../ob-kit';

const TAG_TONE: Record<ReturnType<typeof sourceTone>, TagTone> = {
  chalk: 'chalk',
  good: 'preview',
  ai: 'accent',
  dim: 'dim',
};

/** The three newest WHY entries: time, who (OP / AUTO / LLM / SYS), what, why. */
export function WhyTicker({
  log,
  count = 3,
  style,
}: {
  /** Newest first. */
  log: readonly ObLogEntry[];
  count?: number;
  style?: React.CSSProperties;
}) {
  const entries = log.slice(0, count);
  return (
    <ObPlate title='WHY' padding='8px 12px' gap={6} style={style}>
      {entries.length === 0 ? (
        <Meta size={9} color={OB.dim2}>
          every cut and its reasons land here
        </Meta>
      ) : (
        entries.map((e) => {
          const reasons = reasonsLine(e);
          return (
            <div
              key={e.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                minWidth: 0,
              }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                }}>
                <Mono size={9} color={OB.dim2} tracking={0.06}>
                  {logTime(e.atMs)}
                </Mono>
                <TagChip tone={TAG_TONE[sourceTone(e.source)]} size={8}>
                  {SOURCE_LABEL[e.source]}
                </TagChip>
                <Mono size={10} weight={600} tracking={0.1}>
                  {e.label}
                </Mono>
                <Copy
                  size={10.5}
                  color={OB.chalk}
                  lineHeight={1.3}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}>
                  {e.text}
                </Copy>
              </div>
              {reasons ? (
                <Copy
                  size={9.5}
                  color={OB.dim}
                  lineHeight={1.3}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    paddingLeft: 58,
                  }}>
                  {reasons}
                </Copy>
              ) : null}
            </div>
          );
        })
      )}
    </ObPlate>
  );
}
