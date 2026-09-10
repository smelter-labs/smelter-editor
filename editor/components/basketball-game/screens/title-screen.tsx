'use client';

import React from 'react';
import {
  BB,
  BbButton,
  Copy,
  Display,
  FooterHints,
  Mono,
  TagSignature,
  Wordmark,
  chainLink,
  noiseUrl,
} from '../bb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';

/** Attract screen (hangs on the TV): the wordmark, the pitch, OPEN THE COURT. */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useArcadeKeys({ confirm: onStart });

  return (
    <div
      className='bb-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: `${BB.page} ${noiseUrl(0.14)}`,
        overflow: 'hidden',
      }}>
      {/* chain-link on the right half */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: chainLink(0.05, 20),
          WebkitMaskImage: 'linear-gradient(90deg, transparent 40%, #000)',
          maskImage: 'linear-gradient(90deg, transparent 40%, #000)',
        }}
      />
      {/* the court's arc */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -133,
          bottom: -333,
          width: 1000,
          height: 1000,
          border: '3px solid rgba(232,228,218,.14)',
          borderRadius: '50%',
        }}
      />
      {/* chalk dashed rule */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 80,
          height: 3,
          background:
            'repeating-linear-gradient(90deg, rgba(232,228,218,.35) 0 15px, transparent 15px 27px)',
        }}
      />
      <TagSignature
        text='21'
        size={347}
        rotate={-6}
        stroke='rgba(232,228,218,.14)'
        strokeWidth={2}
        shadow='11px 11px 0 rgba(34,211,238,.18)'
        style={{ right: 80, top: 127 }}
      />

      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 120,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
        <Wordmark size={200} style={{ lineHeight: 0.85 }} />
        <Display size={37} weight={700} tracking={0.3} lineHeight={1}>
          SMELTER STREETBALL
        </Display>
        <Mono
          size={13}
          tracking={0.24}
          color={BB.chalk}
          style={{ opacity: 0.8 }}>
          ONE HOOP · FIRST TO 21 · AI REFEREE
        </Mono>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 467,
          width: 427,
        }}>
        <Copy size={13} color='rgba(232,228,218,.85)' lineHeight={1.7}>
          Two teams, one hoop, FIBA 3x3 rules. A phone on the rim watches every
          shot and calls the makes. A second phone shoots wide. A moderator
          courtside settles the arguments. Ten minutes on the clock, or first to
          twenty-one.
        </Copy>
      </div>

      <div style={{ position: 'absolute', left: 80, top: 600 }}>
        <BbButton
          size='lg'
          active
          label='OPEN THE COURT'
          keyBadge='ENTER'
          onClick={onStart}
          style={{ height: 51, fontSize: 25, padding: '0 29px' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 37,
          display: 'flex',
          alignItems: 'center',
          padding: '0 80px',
          borderTop: `1px solid ${BB.rule}`,
        }}>
        <FooterHints
          hints={[{ key: 'ENTER', label: 'START' }]}
          right={
            <Mono
              size={10}
              tracking={0.22}
              color={BB.chalk}
              style={{ opacity: 0.7 }}>
              BLACKTOP · v1 · HOST
            </Mono>
          }
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}
