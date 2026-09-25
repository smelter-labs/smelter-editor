'use client';

import React from 'react';
import {
  OB_CONFIG_LIMITS,
  OB_PRESET_IDS,
  type ObRundownItem,
} from '@smelter-editor/types';
import { newSegmentId } from '@/lib/ob-van/ui-config';
import { presetLabel } from '@/lib/ob-van/presets-meta';
import { Chip, Meta, Mono, OB, ObSelect, TextField } from '../ob-kit';

/**
 * RUNDOWN on SETUP: the show's segments in order. A segment can switch the
 * auto pilot to another preset's rules while it is on (a talk, then a live
 * music set). NEXT on the desk walks it; the title bug shows the segment.
 */
export function RundownEditor({
  items,
  onChange,
}: {
  items: ObRundownItem[];
  onChange: (items: ObRundownItem[]) => void;
}) {
  const update = (i: number, patch: Partial<ObRundownItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const full = items.length >= OB_CONFIG_LIMITS.rundown.max;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.length === 0 ? (
        <Meta size={9.5} tracking={0.06}>
          no segments — one continuous show
        </Meta>
      ) : null}
      {items.map((item, i) => (
        <div
          key={item.id}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Mono
            size={10}
            weight={600}
            color={OB.dim2}
            style={{ width: 16, textAlign: 'right', flexShrink: 0 }}>
            {i + 1}
          </Mono>
          <TextField
            value={item.title}
            onChange={(title) => update(i, { title })}
            placeholder='segment title'
            label={`Segment ${i + 1} title`}
            maxLength={40}
            height={28}
            fontSize={11}
          />
          <ObSelect
            value={item.preset ?? ''}
            height={28}
            onChange={(v) => {
              const preset = OB_PRESET_IDS.find((p) => p === v);
              update(i, { preset });
            }}
            style={{ width: 86, flexShrink: 0 }}
            title='Switch the auto pilot to this preset while the segment is on'>
            <option value=''>SAME</option>
            {OB_PRESET_IDS.map((p) => (
              <option key={p} value={p}>
                {presetLabel(p)}
              </option>
            ))}
          </ObSelect>
          <Chip
            dense
            label='↑'
            title='Move up'
            disabled={i === 0}
            onClick={() => move(i, -1)}
          />
          <Chip
            dense
            label='↓'
            title='Move down'
            disabled={i === items.length - 1}
            onClick={() => move(i, 1)}
          />
          <Chip
            dense
            tone='danger'
            label='×'
            title='Remove segment'
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Chip
          dense
          label='+ SEGMENT'
          disabled={full}
          onClick={() =>
            onChange([
              ...items,
              { id: newSegmentId(), title: `SEGMENT ${items.length + 1}` },
            ])
          }
        />
      </div>
    </div>
  );
}
