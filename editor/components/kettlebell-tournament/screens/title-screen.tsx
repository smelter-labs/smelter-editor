'use client';

import React from 'react';
import {
  ArcadeText,
  BlueprintBackdrop,
  PixelButton,
  R5,
  RetroFooter,
  StarLine,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';

/** Attract screen: the marquee, the pitch, INSERT COIN. */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useArcadeKeys({ confirm: onStart });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: R5.bgDeep,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <BlueprintBackdrop />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}>
        <div style={{ fontSize: 74, lineHeight: 1 }}>🏋️</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}>
          <ArcadeText size={44}>KETTLEBELL</ArcadeText>
          <ArcadeText size={44}>TOURNAMENT</ArcadeText>
        </div>
        <StarLine size={11}>SWING · CLEAN · SNATCH</StarLine>
        <div
          style={{
            maxWidth: 660,
            textAlign: 'center',
            fontFamily: monoFont,
            fontSize: 14,
            lineHeight: 1.7,
            color: R5.inkMuted,
          }}>
          Scan in with your phone — its camera becomes your arena tile and the
          AI referee counts every rep. Heats of 2–4, an AMRAP clock, a final for
          the top lifters. Strong wins.
        </div>
        <div
          className='r5-blink'
          style={{
            fontFamily: pixelFont,
            fontSize: 15,
            letterSpacing: 3,
            color: R5.yellow,
            textShadow: `0 0 14px rgba(${R5.yellowRgb},0.7)`,
          }}>
          INSERT COIN
        </div>
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <RetroFooter
          tip='enter to start'
          right={
            <PixelButton
              accent='green'
              glyph='A'
              label='PRESS START'
              active
              onClick={onStart}
            />
          }
        />
      </div>
      <div className='r5-scanlines' />
    </div>
  );
}
