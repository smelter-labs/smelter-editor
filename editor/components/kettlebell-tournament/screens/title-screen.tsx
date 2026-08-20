'use client';

import React from 'react';
import {
  Backdrop,
  DisplayText,
  FooterHint,
  KBT,
  KbtButton,
  Label,
  kbtMonoFont,
  skewBar,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';

/** Attract screen: the marque, the pitch, START A TOURNAMENT. */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useArcadeKeys({ confirm: onStart });

  return (
    <div
      className='kbt-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: KBT.page,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <Backdrop />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 30,
        }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 24 }}>
          <span
            style={{
              width: 26,
              clipPath: skewBar(12),
              background: KBT.accent,
              flexShrink: 0,
            }}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
            <DisplayText size={104} weight={800} tracking={3}>
              SMELTER
            </DisplayText>
            <DisplayText
              size={104}
              weight={800}
              tracking={3}
              color={KBT.accent}>
              KETTLEBELL
            </DisplayText>
          </div>
        </div>
        <Label size={13} tracking={5}>
          LIVE TOURNAMENT · CAST IRON DIVISION
        </Label>
        <div
          style={{
            maxWidth: 620,
            textAlign: 'center',
            fontFamily: kbtMonoFont,
            fontSize: 13,
            lineHeight: 1.8,
            letterSpacing: 0.5,
            color: KBT.dim,
          }}>
          Scan in with your phone — its camera becomes your arena tile and the
          AI referee counts every rep. Heats of 2–4, an AMRAP clock, a final for
          the top lifters. Strong wins.
        </div>
        <KbtButton label='START A TOURNAMENT' active onClick={onStart} />
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          padding: '10px 32px 16px',
          borderTop: `1px solid ${KBT.border}`,
        }}>
        <FooterHint hints={[{ key: 'ENTER', label: 'START' }]} />
      </div>
    </div>
  );
}
