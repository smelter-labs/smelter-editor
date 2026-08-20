'use client';

import React, { useState } from 'react';
import { KBT, KbtButton, Label, Plate, kbtMonoFont } from '../kbt-kit';

/** Step 2 — pick a lifter name (shown on the tile, scoreboard and podium). */
export function NameStep({
  name,
  onName,
  onContinue,
}: {
  name: string;
  onName: (v: string) => void;
  onContinue: () => void;
}) {
  const trimmed = name.trim();
  const [focused, setFocused] = useState(false);
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
        <Label size={10}>LIFTER NAME</Label>
        <input
          value={name}
          onChange={(e) => onName(e.target.value.slice(0, 20))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder='E.G. IRON ANIA'
          autoCapitalize='characters'
          autoComplete='off'
          spellCheck={false}
          style={{
            fontFamily: kbtMonoFont,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: KBT.cream,
            background: KBT.fill,
            border: `1px solid ${focused ? KBT.accent : KBT.border}`,
            borderRadius: 0,
            padding: '12px 12px',
            outline: 'none',
            width: '100%',
          }}
        />
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            color: KBT.dim,
          }}>
          Your name rides your camera tile on the big screen. Reconnecting with
          the same name restores your scores.
        </span>
      </Plate>
      <KbtButton
        block
        variant='solid'
        label='REGISTER'
        sub='join the tournament roster'
        disabled={trimmed.length === 0}
        active={trimmed.length > 0}
        onClick={onContinue}
      />
    </div>
  );
}
