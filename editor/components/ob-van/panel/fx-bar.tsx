'use client';

import React, { useState } from 'react';
import {
  OB_GRADES,
  type ObGrade,
  type ObOperatorCommand,
  type ObState,
} from '@smelter-editor/types';
import { GRADE_LABEL } from '@/lib/ob-van/view-labels';
import { Chip, Meta, OB } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * Program effects: colour grade, SPOTLIGHT (vignette), SOFT BG (blurred
 * backdrop behind split / PiP), DIP to black and the TITLE BUG. Lit from
 * `state.effects` / `state.titleBug`.
 */
export function FxBar({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  // Every grade press shares one pending key: remember which chip was hit
  // so only that one runs the bar.
  const [pressedGrade, setPressedGrade] = useState<ObGrade | null>(null);
  const fx = state.effects;
  const gradeBusy = pending.isPending({ op: 'fx', effects: { grade: 'none' } });

  const spotlightCmd: ObOperatorCommand = {
    op: 'fx',
    effects: { spotlight: !fx.spotlight },
  };
  const softCmd: ObOperatorCommand = {
    op: 'fx',
    effects: { softBackground: !fx.softBackground },
  };
  const titleCmd: ObOperatorCommand = {
    op: 'title_bug',
    visible: !state.titleBug.visible,
  };
  const dipCmd: ObOperatorCommand = { op: 'dip' };

  return (
    <div
      role='group'
      aria-label='effects'
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
      }}>
      <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
        FX
      </Meta>
      {OB_GRADES.map((g) => (
        <Chip
          key={g}
          dense
          label={GRADE_LABEL[g]}
          active={fx.grade === g}
          pending={gradeBusy && pressedGrade === g}
          onClick={() => {
            if (fx.grade === g) return;
            if (pending.send({ op: 'fx', effects: { grade: g } }))
              setPressedGrade(g);
          }}
          title={`Grade: ${g}`}
        />
      ))}
      <span
        aria-hidden
        style={{ width: 1, height: 20, background: OB.rule2, margin: '0 4px' }}
      />
      <Chip
        dense
        label='SPOTLIGHT'
        active={fx.spotlight}
        pending={pending.isPending(spotlightCmd)}
        onClick={() => pending.send(spotlightCmd)}
        title='Vignette on the program picture'
      />
      <Chip
        dense
        label='SOFT BG'
        active={fx.softBackground}
        pending={pending.isPending(softCmd)}
        onClick={() => pending.send(softCmd)}
        title='Blurred main camera behind split / PiP shots'
      />
      <Chip
        dense
        label='TITLE BUG'
        active={state.titleBug.visible}
        pending={pending.isPending(titleCmd)}
        onClick={() => pending.send(titleCmd)}
        title='Event / segment bug in the corner'
      />
      <Chip
        dense
        label='DIP'
        tone='amber'
        pending={pending.isPending(dipCmd)}
        onClick={() => pending.send(dipCmd)}
        title='Dip the program to black'
      />
    </div>
  );
}
