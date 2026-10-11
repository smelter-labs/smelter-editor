'use client';

import React from 'react';
import { formatKbtPoints } from '@smelter-editor/types';
import { KBT, cut, displayFont, kbtMonoFont } from './kbt-kit';
import { KbtAvatar } from './avatar';

/**
 * Avatar + name + points chip — the standings unit shared by the panel's
 * SHOW plate and the host heat screen. `large` is the broadcast-chrome
 * scale: cut-corner plate, display-face points.
 */
export function ScoreChip({
  name,
  color,
  photoUrl,
  points,
  large = false,
  weighted = false,
  style,
}: {
  name: string;
  color: string;
  photoUrl?: string | null;
  points: number;
  large?: boolean;
  /** Weighted scoring — points render with one decimal. */
  weighted?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: large ? 10 : 8,
        fontFamily: kbtMonoFont,
        fontSize: large ? 12 : 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: KBT.cream,
        border: `1px solid ${KBT.border}`,
        background: large ? KBT.plate : KBT.fill,
        clipPath: large ? cut(10) : undefined,
        padding: large ? '5px 14px 5px 10px' : '4px 10px',
        ...style,
      }}>
      <KbtAvatar
        name={name}
        color={color}
        photoUrl={photoUrl}
        size={large ? 22 : 18}
      />
      {name}
      {large ? (
        <span
          style={{
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 20,
            color: KBT.cream,
          }}>
          {formatKbtPoints(points, weighted)}
        </span>
      ) : (
        <span style={{ color: KBT.accent, fontWeight: 600 }}>
          {formatKbtPoints(points, weighted)}
        </span>
      )}
    </span>
  );
}
