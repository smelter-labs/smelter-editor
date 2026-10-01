'use client';

import React from 'react';
import {
  OB_TRANSITION_LIMITS,
  OB_TRANSITION_TYPES,
  type ObTransition,
  type ObTransitionType,
} from '@smelter-editor/types';
import { TRANSITION_LABEL, TRANSITION_NAME } from '@/lib/ob-van/view-labels';
import { Meta, Mono, OB, Segment, Stepper } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

const DURATION_STEP_MS = 100;

/**
 * The TAKE transition: type segment (CUT / DISS / WIPE / FADE / DIP / ZOOM)
 * and duration in ms. Reflects `state.config.transition`; every change is a
 * `transition` command echoed back by the server.
 */
export function TransitionPicker({
  transition,
  pending,
  compact = false,
}: {
  transition: ObTransition;
  pending: ObPending;
  compact?: boolean;
}) {
  const busy = pending.anyPending('transition');
  const setType = (type: ObTransitionType) => {
    if (type === transition.type) return;
    pending.send({ op: 'transition', transition: { type } });
  };
  const setDuration = (durationMs: number) => {
    if (durationMs === transition.durationMs) return;
    pending.send({ op: 'transition', transition: { durationMs } });
  };
  const lim = OB_TRANSITION_LIMITS.durationMs;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 0,
        flex: compact ? undefined : '1 1 360px',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Meta size={9}>TRANSITION</Meta>
        <Mono size={9} tracking={0.1} color={OB.dim2} uppercase={false}>
          {TRANSITION_NAME[transition.type]}
        </Mono>
        {busy ? (
          <span className='ob-blink'>
            <Meta size={9} color={OB.dim2}>
              …
            </Meta>
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: compact ? 'wrap' : 'nowrap',
        }}>
        <Segment<ObTransitionType>
          options={OB_TRANSITION_TYPES.map((t) => ({
            value: t,
            label: TRANSITION_LABEL[t],
            title: TRANSITION_NAME[t],
          }))}
          value={transition.type}
          onChange={setType}
          height={34}
          fontSize={10.5}
          gap={3}
          style={{ flex: '1 1 300px', minWidth: 0 }}
        />
        <Stepper
          value={transition.durationMs}
          min={lim.min}
          max={lim.max}
          step={DURATION_STEP_MS}
          onChange={setDuration}
          render={(v) => `${v} MS`}
          height={34}
          fontSize={11}
          label='transition duration'
          disabled={transition.type === 'cut'}
          style={{ width: 128, flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
