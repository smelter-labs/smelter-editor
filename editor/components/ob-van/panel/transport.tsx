'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { mainCamOf } from '@/lib/ob-van/tally';
import { TRANSITION_LABEL } from '@/lib/ob-van/view-labels';
import { BigKey, Chip } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';
import { isReplayEnabled } from './panel-model';
import { TransitionPicker } from './transition-picker';

/**
 * The transport: TAKE (preview → program with the transition), CUT (hard),
 * AUTO (the auto pilot), the transition picker and — for the match preset or
 * a burst-replay ruleset — REPLAY of the program camera.
 */
export function Transport({
  state,
  pending,
  desk,
}: {
  state: ObState;
  pending: ObPending;
  desk: boolean;
}) {
  const hasPreview = state.preview != null;
  const t = state.config.transition;
  const autoOn = state.autoPilot.on;
  const keyH = desk ? 64 : 58;
  const programCam = mainCamOf(state.program.shot);
  const replayCmd: ObOperatorCommand = programCam
    ? { op: 'replay', camId: programCam }
    : { op: 'replay' };
  const replay = isReplayEnabled(state);

  const keys = (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flex: desk ? '0 0 auto' : undefined,
      }}>
      <BigKey
        label='TAKE'
        sub={
          t.type === 'cut'
            ? 'CUT'
            : `${TRANSITION_LABEL[t.type]} ${t.durationMs}MS`
        }
        keyBadge='ENTER'
        tone='program'
        lit={hasPreview}
        disabled={!hasPreview}
        pending={pending.isPending({ op: 'take' })}
        onClick={() => pending.send({ op: 'take' })}
        height={keyH}
        title='Preview to program with the transition'
        style={{ flex: desk ? undefined : 1, minWidth: desk ? 124 : 0 }}
      />
      <BigKey
        label='CUT'
        sub='HARD'
        keyBadge='SPACE'
        disabled={!hasPreview}
        pending={pending.isPending({ op: 'cut' })}
        onClick={() => pending.send({ op: 'cut' })}
        height={keyH}
        title='Preview to program, hard cut'
        style={{ flex: desk ? undefined : 1, minWidth: desk ? 100 : 0 }}
      />
      <BigKey
        label='AUTO'
        sub={autoOn ? 'ON' : 'OFF'}
        keyBadge='A'
        tone='accent'
        lit={autoOn}
        pending={pending.anyPending('auto')}
        onClick={() => pending.send({ op: 'auto', enabled: !autoOn })}
        height={keyH}
        title='Auto pilot on / off'
        style={{ flex: desk ? undefined : 1, minWidth: desk ? 100 : 0 }}
      />
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: desk ? 'row' : 'column',
        alignItems: desk ? 'flex-end' : 'stretch',
        gap: desk ? 14 : 10,
        minWidth: 0,
      }}>
      {keys}
      <TransitionPicker transition={t} pending={pending} compact={!desk} />
      {replay ? (
        <Chip
          label={state.replay ? 'REPLAY ON' : 'REPLAY'}
          leading={<span style={{ opacity: 0.7 }}>R</span>}
          tone='amber'
          active={state.replay != null}
          pending={pending.isPending(replayCmd)}
          onClick={() => pending.send(replayCmd)}
          title='Instant replay of the program camera'
          style={{ height: 34, alignSelf: desk ? 'flex-end' : 'flex-start' }}
        />
      ) : null}
    </div>
  );
}
