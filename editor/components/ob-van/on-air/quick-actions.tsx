'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { mainCamOf } from '@/lib/ob-van/tally';
import { TRANSITION_LABEL } from '@/lib/ob-van/view-labels';
import { BigKey, ObButton, useArmed } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * The host's desk keys on air: TAKE (preview → program with the event
 * transition), CUT, AUTO, L3 on the preview camera, REPLAY (when the
 * preset has it) and a two-press WRAP.
 */
export function QuickActions({
  state,
  pending,
  replayEnabled,
  onWrap,
}: {
  state: ObState;
  pending: ObPending;
  replayEnabled: boolean;
  onWrap: () => void;
}) {
  const { armed, arm, disarm } = useArmed(4000);
  const hasPreview = state.preview != null;
  const l3Cam = mainCamOf(state.preview) ?? mainCamOf(state.program.shot);
  const l3Cmd: ObOperatorCommand | null = l3Cam
    ? state.lowerThird?.camId === l3Cam
      ? { op: 'lower_third', clear: true }
      : { op: 'lower_third', camId: l3Cam }
    : null;
  const programCam = mainCamOf(state.program.shot);
  const t = state.config.transition;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
      <BigKey
        label='TAKE'
        sub={`${TRANSITION_LABEL[t.type]}${t.type === 'cut' ? '' : ` ${t.durationMs}`}`}
        keyBadge='↵'
        tone='program'
        lit={hasPreview}
        disabled={!hasPreview}
        pending={pending.anyPending('take')}
        height={58}
        onClick={() => pending.send({ op: 'take' })}
        style={{ flex: 1.4, minWidth: 0 }}
      />
      <BigKey
        label='CUT'
        keyBadge='SPACE'
        disabled={!hasPreview}
        pending={pending.anyPending('cut')}
        height={58}
        onClick={() => pending.send({ op: 'cut' })}
        style={{ flex: 1, minWidth: 0 }}
      />
      <BigKey
        label='AUTO'
        keyBadge='A'
        tone='accent'
        lit={state.autoPilot.on}
        pending={pending.anyPending('auto')}
        height={58}
        onClick={() =>
          pending.send({ op: 'auto', enabled: !state.autoPilot.on })
        }
        style={{ flex: 1, minWidth: 0 }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: 1,
          minWidth: 0,
        }}>
        <ObButton
          size='xs'
          block
          label={state.lowerThird ? 'L3 OFF' : 'L3'}
          keyBadge='L'
          disabled={!l3Cmd}
          pending={l3Cmd ? pending.isPending(l3Cmd) : false}
          onClick={() => l3Cmd && pending.send(l3Cmd)}
        />
        {replayEnabled ? (
          <ObButton
            size='xs'
            block
            label='REPLAY'
            keyBadge='R'
            disabled={!programCam}
            pending={pending.anyPending('replay')}
            onClick={() =>
              pending.send(
                programCam
                  ? { op: 'replay', camId: programCam }
                  : { op: 'replay' },
              )
            }
          />
        ) : (
          <ObButton
            size='xs'
            block
            label='DIP'
            title='Dip to black and back'
            pending={pending.anyPending('dip')}
            onClick={() => pending.send({ op: 'dip' })}
          />
        )}
      </div>
      <ObButton
        size='md'
        variant={armed === 'wrap' ? 'dangerSolid' : 'danger'}
        label={armed === 'wrap' ? 'SURE?' : 'WRAP'}
        title='End the show: stats, recording, notes'
        onClick={() => {
          if (armed !== 'wrap') return arm('wrap');
          disarm();
          onWrap();
        }}
        style={{ height: 58, minWidth: 76 }}
      />
    </div>
  );
}
