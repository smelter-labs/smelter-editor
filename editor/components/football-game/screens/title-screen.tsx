'use client';

import React from 'react';
import {
  FB,
  FbButton,
  Copy,
  Display,
  FooterHints,
  Mono,
  TagSignature,
  Wordmark,
  chainLink,
  noiseUrl,
} from '../fb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';

/** Attract screen (hangs on the TV): the wordmark, the pitch, OPEN THE MATCH. */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useArcadeKeys({ confirm: onStart });

  return (
    <div
      className='fb-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: `${FB.page} ${noiseUrl(0.12)}`,
        overflow: 'hidden',
      }}>
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
      {/* the centre circle */}
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
      {/* chalk touchline */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 80,
          height: 3,
          background: 'rgba(232,228,218,.35)',
        }}
      />
      <TagSignature
        text='90'
        size={347}
        rotate={-6}
        stroke='rgba(232,228,218,.14)'
        strokeWidth={2}
        shadow='11px 11px 0 rgba(47,191,113,.18)'
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
          SMELTER FOOTBALL
        </Display>
        <Mono
          size={13}
          tracking={0.24}
          color={FB.chalk}
          style={{ opacity: 0.8 }}>
          STADIUM PANORAMA · VIRTUAL DIRECTOR · AI EVENTS
        </Mono>
      </div>

      <div style={{ position: 'absolute', left: 80, top: 467, width: 427 }}>
        <Copy size={13} color='rgba(232,228,218,.85)' lineHeight={1.7}>
          A stadium panorama or three fixed cameras. A virtual director follows
          the ball, the telemetry calls chances, shots and corners with instant
          replay, and the tagged players run on a live minimap. A moderator
          confirms the goals and runs the clock.
        </Copy>
      </div>

      <div style={{ position: 'absolute', left: 80, top: 600 }}>
        <FbButton
          size='lg'
          active
          label='OPEN THE MATCH'
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
          borderTop: `1px solid ${FB.rule}`,
        }}>
        <FooterHints
          hints={[{ key: 'ENTER', label: 'START' }]}
          right={
            <Mono
              size={10}
              tracking={0.22}
              color={FB.chalk}
              style={{ opacity: 0.7 }}>
              TOUCHLINE · v1 · HOST
            </Mono>
          }
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}
