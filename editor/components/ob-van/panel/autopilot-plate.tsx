'use client';

import React from 'react';
import type { ObState } from '@smelter-editor/types';
import {
  effectiveHold,
  formatSeconds,
  secondsUntil,
} from '@/lib/ob-van/pacing';
import { shotLabel } from '@/lib/ob-van/view-labels';
import { Copy, Meta, Mono, OB, ObPlate, StatusPill, Toggle } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';
import { autopilotStatus } from './panel-model';
import { useServerNow } from './use-server-now';

/**
 * The auto pilot at a glance: toggle, ON / PAUSED (resumes in N s) / OFF,
 * the next scheduled cut with its reason and the hold it works with.
 * Countdowns run on the server clock with a 250 ms tick.
 */
export function AutopilotPlate({
  state,
  pending,
  clockOffsetMs,
  style,
}: {
  state: ObState;
  pending: ObPending;
  clockOffsetMs: number;
  style?: React.CSSProperties;
}) {
  const now = useServerNow(clockOffsetMs);
  const ap = state.autoPilot;
  const status = autopilotStatus(ap, now);
  const hold = effectiveHold(state);
  const next = ap.next;
  const nextIn = next ? secondsUntil(next.atMs, now) : null;
  const pill =
    status.kind === 'on' ? (
      <StatusPill tone='ai' pulse>
        ON
      </StatusPill>
    ) : status.kind === 'paused' ? (
      <StatusPill tone='amber'>PAUSED</StatusPill>
    ) : (
      <StatusPill tone='idle'>OFF</StatusPill>
    );

  return (
    <ObPlate
      title='AUTO PILOT'
      right={pill}
      bar={OB.accent}
      padding='10px 12px 10px 14px'
      gap={7}
      style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Toggle
          on={ap.on}
          tone='accent'
          label={ap.on ? 'DIRECTING' : 'MANUAL'}
          pending={pending.anyPending('auto')}
          onChange={(on) => pending.send({ op: 'auto', enabled: on })}
        />
        {status.kind === 'paused' ? (
          <Mono size={10} weight={600} tracking={0.12} color={OB.amber}>
            RESUMES IN {status.resumesInS} S
          </Mono>
        ) : null}
      </div>
      {ap.on && next ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Mono size={10.5} weight={600} tracking={0.12} color={OB.accent}>
            NEXT CUT IN {nextIn ?? 0} S → {shotLabel(next.shot, state.cams)}
          </Mono>
          {next.reason ? (
            <Copy
              size={10.5}
              lineHeight={1.35}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {next.reason}
            </Copy>
          ) : null}
        </div>
      ) : (
        <Meta size={9} color={OB.dim2}>
          {ap.on
            ? status.kind === 'paused'
              ? 'you have the desk — it takes over again after the pause'
              : 'watching the signals — no cut scheduled'
            : 'manual desk — press A to hand over'}
        </Meta>
      )}
      <Meta size={9}>
        HOLD {formatSeconds(hold.minHoldMs)} – {formatSeconds(hold.maxHoldMs)}
        {hold.overridden ? ' · OVERRIDE' : ` · ${state.config.pacingDial}`}
      </Meta>
    </ObPlate>
  );
}
