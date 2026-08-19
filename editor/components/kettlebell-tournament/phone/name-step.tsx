'use client';

import React from 'react';
import { PixelPanel, R5, monoFont, pixelFont } from '../../duck-hunter/retro-kit';
import { ActionButton } from '../../duck-hunter/phone/phone-shell';

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
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 16,
      }}>
      <PixelPanel
        accent='cyan'
        cut={10}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 16px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 11,
            letterSpacing: 1.5,
            color: R5.cyan,
          }}>
          LIFTER NAME
        </span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value.slice(0, 20))}
          placeholder='E.G. IRON ANIA'
          autoCapitalize='characters'
          autoComplete='off'
          spellCheck={false}
          style={{
            fontFamily: pixelFont,
            fontSize: 16,
            letterSpacing: 2,
            color: R5.ink,
            background: 'rgba(120,150,200,0.12)',
            border: `1px solid rgba(${R5.gridRgb},0.6)`,
            padding: '12px 12px',
            outline: 'none',
            width: '100%',
          }}
        />
        <span
          style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
          Your name rides your camera tile on the big screen. Reconnecting with
          the same name restores your scores.
        </span>
      </PixelPanel>
      <ActionButton
        accent='green'
        label='REGISTER'
        sub='join the tournament roster'
        disabled={trimmed.length === 0}
        active={trimmed.length > 0}
        onClick={onContinue}
      />
    </div>
  );
}
