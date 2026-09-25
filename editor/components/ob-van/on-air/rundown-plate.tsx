'use client';

import React from 'react';
import type { ObState } from '@smelter-editor/types';
import { presetLabel } from '@/lib/ob-van/presets-meta';
import { Chip, Display, Meta, Mono, OB, TagChip } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/** The rundown on air: current segment, what is NEXT, PREV / NEXT keys. */
export function RundownPlate({
  rundown,
  pending,
}: {
  rundown: ObState['rundown'];
  pending: ObPending;
}) {
  const { items, index } = rundown;
  if (items.length === 0)
    return (
      <Meta size={9.5} tracking={0.06}>
        no rundown — one continuous show
      </Meta>
    );
  // index −1 = the show has not reached its first segment yet.
  const current = index >= 0 ? (items[index] ?? null) : null;
  const next = items[index + 1] ?? null;
  const busy = pending.anyPending('segment');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mono size={9} weight={600} color={OB.dim2}>
          {Math.max(0, index + 1)}/{items.length}
        </Mono>
        <Display
          size={17}
          weight={700}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {current?.title ?? 'NOT STARTED'}
        </Display>
        {current?.preset ? (
          <TagChip tone='accent'>{presetLabel(current.preset)}</TagChip>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Chip
          dense
          label='PREV'
          disabled={index <= 0 || busy}
          onClick={() => pending.send({ op: 'segment', action: 'prev' })}
        />
        <Chip
          dense
          tone='preview'
          label='NEXT'
          pending={busy}
          disabled={!next || busy}
          onClick={() => pending.send({ op: 'segment', action: 'next' })}
        />
        <Mono
          size={9.5}
          tracking={0.06}
          color={OB.dim}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {next ? `next: ${next.title}` : 'last segment'}
        </Mono>
      </div>
    </div>
  );
}
