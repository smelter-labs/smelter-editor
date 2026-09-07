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
} from '@/components/kettlebell-tournament/kbt-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';

/** Attract screen: the marque, the pitch, OPEN THE COURT. */
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <DisplayText size={104} weight={800} tracking={3}>
              BLACK
              <span style={{ color: KBT.accent }}>TOP</span>
            </DisplayText>
            <DisplayText size={44} weight={700} tracking={4} color={KBT.dim}>
              SMELTER STREETBALL
            </DisplayText>
          </div>
        </div>
        <Label size={13} tracking={5}>
          ONE HOOP · FIRST TO 21 · AI REFEREE
        </Label>
        <div
          style={{
            maxWidth: 640,
            textAlign: 'center',
            fontFamily: kbtMonoFont,
            fontSize: 13,
            lineHeight: 1.8,
            letterSpacing: 0.5,
            color: KBT.dim,
          }}>
          Two phones on tripods — one on the hoop, one on the court — and a
          moderator courtside. The hoop camera&apos;s AI counts every make and
          calls the team by jersey colour; the moderator confirms the close
          ones. FIBA 3x3 rules: first to 21 or ten minutes, overtime to +2.
        </div>
        <KbtButton label='OPEN THE COURT' active onClick={onStart} />
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
