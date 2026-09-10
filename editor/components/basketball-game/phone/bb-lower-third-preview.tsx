'use client';

import React from 'react';
import { BB, BbPlate, Display, Meta, Mono, StatusPill } from '../bb-kit';

/** What the broadcast shows while this commentator is on air. */
export function LowerThirdPreview({ name }: { name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', paddingTop: 30 }}>
        <StatusPill
          tone='onair'
          size={11}
          height={30}
          style={{ position: 'absolute', left: 0, top: 0 }}>
          ON AIR
        </StatusPill>
        <BbPlate
          fill={BB.plate}
          cutPx={14}
          style={{
            height: 88,
            padding: '0 20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 4,
          }}>
          <Display size={34} weight={800}>
            {name.trim() || 'YOUR NAME'}
          </Display>
          <Mono
            size={11}
            tracking={0.22}
            color={BB.chalk}
            style={{ opacity: 0.7 }}>
            COMMENTARY · BLACKTOP
          </Mono>
        </BbPlate>
      </div>
      <Meta size={11} tracking={0.18} color={BB.dim2}>
        PREVIEW OF YOUR LOWER THIRD
      </Meta>
    </div>
  );
}
