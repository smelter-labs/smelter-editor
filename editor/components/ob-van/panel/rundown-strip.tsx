'use client';

import React, { useState } from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { Chip, Meta, OB, TagChip } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * The rundown as a horizontal strip: segments in order, the current one
 * lit, PREV / NEXT and click-to-go. Hidden (a meta line) with no rundown.
 */
export function RundownStrip({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  // All segment moves share one pending key: remember which chip was hit.
  const [pressed, setPressed] = useState<number | 'prev' | 'next' | null>(null);
  const { items, index } = state.rundown;
  const busy = pending.anyPending('segment');
  const go = (cmd: ObOperatorCommand, mark: number | 'prev' | 'next') => {
    if (pending.send(cmd)) setPressed(mark);
  };

  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
          RUNDOWN
        </Meta>
        <Meta size={9} color={OB.dim2}>
          no rundown — the host adds segments in setup
        </Meta>
      </div>
    );
  }

  return (
    <div
      role='group'
      aria-label='rundown'
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
        RUNDOWN
      </Meta>
      <Chip
        dense
        label='PREV'
        disabled={index <= 0}
        pending={busy && pressed === 'prev'}
        onClick={() => go({ op: 'segment', action: 'prev' }, 'prev')}
      />
      <div
        className='ob-scroll'
        style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          minWidth: 0,
          flex: 1,
          paddingBottom: 2,
        }}>
        {items.map((item, i) => (
          <Chip
            key={item.id}
            dense
            active={i === index}
            label={`${i + 1} · ${item.title}`}
            leading={
              item.preset ? (
                <TagChip tone='dim' size={7.5}>
                  {item.preset}
                </TagChip>
              ) : undefined
            }
            pending={busy && pressed === i}
            onClick={
              i === index
                ? undefined
                : () => go({ op: 'segment', action: 'goto', index: i }, i)
            }
            title={item.title}
            style={{ maxWidth: 200 }}
          />
        ))}
      </div>
      <Chip
        dense
        label='NEXT'
        leading={<span style={{ opacity: 0.7 }}>N</span>}
        disabled={index >= items.length - 1}
        pending={busy && pressed === 'next'}
        onClick={() => go({ op: 'segment', action: 'next' }, 'next')}
      />
    </div>
  );
}
