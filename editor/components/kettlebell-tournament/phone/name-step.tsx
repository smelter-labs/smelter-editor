'use client';

import React from 'react';
import {
  KBT,
  KbtButton,
  KbtTextInput,
  Label,
  Plate,
  kbtMonoFont,
} from '../kbt-kit';

// Lifter and commentator run the same step with role-fitted copy — the
// commentator has no roster, no scores and no tile, just the booth.
const NAME_COPY = {
  lifter: {
    label: 'LIFTER NAME',
    placeholder: 'E.G. IRON ANIA',
    hint: 'Your name rides your camera tile on the big screen. Reconnecting with the same name restores your scores.',
    button: 'REGISTER',
    sub: 'join the tournament roster',
  },
  commentator: {
    label: 'COMMENTATOR NAME',
    placeholder: 'E.G. VOICE OF STEEL',
    hint: 'Your name badges the commentary lower-third on the broadcast. Reconnecting with the same name takes the booth back.',
    button: 'TAKE THE MIC',
    sub: 'claim the commentary booth',
  },
} as const;

/** Step 2 — pick a name (lifter: tile, scoreboard, podium; commentator: booth). */
export function NameStep({
  name,
  onName,
  onContinue,
  variant = 'lifter',
}: {
  name: string;
  onName: (v: string) => void;
  onContinue: () => void;
  variant?: 'lifter' | 'commentator';
}) {
  const copy = NAME_COPY[variant];
  const trimmed = name.trim();
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 16,
      }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '18px 16px',
        }}>
        <Label size={10}>{copy.label}</Label>
        <KbtTextInput
          value={name}
          onChange={onName}
          placeholder={copy.placeholder}
          maxLength={20}
          autoCapitalize='characters'
        />
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            color: KBT.dim,
          }}>
          {copy.hint}
        </span>
      </Plate>
      <KbtButton
        block
        variant='solid'
        label={copy.button}
        sub={copy.sub}
        disabled={trimmed.length === 0}
        active={trimmed.length > 0}
        onClick={onContinue}
      />
    </div>
  );
}
