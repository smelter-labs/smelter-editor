'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { Chip, Meta, OB } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';
import { sortCams } from './shot-builder';

/**
 * Lower thirds: one chip per camera with a talent (`L3 · CAM 2 · Ada`), the
 * one on air lit, and CLEAR. A lower third the auto pilot / LLM set for a
 * name without a camera shows as text.
 */
export function LowerThirdBar({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  const cams = sortCams(state.cams).filter(
    (c) => c.talent != null && c.talent.trim().length > 0,
  );
  const active = state.lowerThird;
  const clearCmd: ObOperatorCommand = { op: 'lower_third', clear: true };
  const orphan =
    active != null && !cams.some((c) => c.id === active.camId) ? active : null;
  return (
    <div
      role='group'
      aria-label='lower thirds'
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
      }}>
      <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
        L3
      </Meta>
      {cams.length === 0 ? (
        <Meta size={9} color={OB.dim2}>
          no talent names — set them on the phones or the host
        </Meta>
      ) : null}
      {cams.map((cam) => {
        const on = active?.camId === cam.id;
        const cmd: ObOperatorCommand = on
          ? clearCmd
          : { op: 'lower_third', camId: cam.id };
        return (
          <Chip
            key={cam.id}
            dense
            label={`L3 · CAM ${cam.number} · ${cam.talent ?? ''}`}
            active={on}
            pending={pending.isPending(cmd)}
            onClick={() => pending.send(cmd)}
            title={on ? 'On air — press to clear' : `Show ${cam.talent}`}
            style={{ maxWidth: 240 }}
          />
        );
      })}
      {orphan ? (
        <Meta
          size={9}
          color={OB.chalk}
          style={{
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          ON AIR · {orphan.name}
        </Meta>
      ) : null}
      <Chip
        dense
        label='CLEAR'
        disabled={active == null}
        pending={pending.isPending(clearCmd)}
        onClick={() => pending.send(clearCmd)}
        title='Take the lower third off'
      />
    </div>
  );
}
