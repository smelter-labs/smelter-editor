'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  FB,
  FbButton,
  Copy,
  Display,
  FooterHints,
  Meta,
  Mono,
  TagSignature,
  Wordmark,
  chainLink,
  noiseUrl,
} from '../fb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { getFbClips } from '@/app/actions/actions';
import {
  FB_DEMO_PRESETS,
  demoClipsMissing,
  type FbDemoPreset,
} from '../demo-presets';

/** The server's mp4 library (null until it answers — every demo stays enabled). */
function useClipLibrary(): Set<string> | null {
  const [library, setLibrary] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getFbClips().then(({ clips }) => {
      if (cancelled || clips.length === 0) return;
      setLibrary(new Set(clips.map((c) => c.fileName)));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return library;
}

/** Attract screen (hangs on the TV): the wordmark, the pitch, OPEN THE MATCH. */
export function TitleScreen({
  onStart,
  onDemo,
}: {
  onStart: () => void;
  /** One-press demo: preset teams + the demo clips, straight to PRE-MATCH. */
  onDemo: (preset: FbDemoPreset) => void;
}) {
  useArcadeKeys({ confirm: onStart });
  const library = useClipLibrary();
  const missing = FB_DEMO_PRESETS.map((p) =>
    library ? demoClipsMissing(p, library) : [],
  );

  // 1 / 2 / 3 start a demo (same input guard as useArcadeKeys).
  const onDemoRef = useRef(onDemo);
  onDemoRef.current = onDemo;
  const missingRef = useRef(missing);
  missingRef.current = missing;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      )
        return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx < 0 || idx >= FB_DEMO_PRESETS.length) return;
      if (missingRef.current[idx].length > 0) return;
      e.preventDefault();
      onDemoRef.current(FB_DEMO_PRESETS[idx]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

      {/* quick demos: teams + clips preset, one press to PRE-MATCH */}
      <div
        style={{
          position: 'absolute',
          left: 560,
          top: 484,
          width: 640,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
        <Meta
          size={10}
          tracking={0.22}
          color={FB.chalk}
          style={{ opacity: 0.8 }}>
          QUICK DEMOS · TEAMS + CLIPS PRESET · STRAIGHT TO PRE-MATCH
        </Meta>
        {FB_DEMO_PRESETS.map((preset, i) => {
          const gone = missing[i];
          return (
            <FbButton
              key={preset.id}
              size='sm'
              block
              variant='outline'
              keyBadge={String(i + 1)}
              label={preset.label}
              sub={
                gone.length > 0
                  ? `CLIP MISSING · ${gone.join(' · ')}`
                  : preset.sub
              }
              disabled={gone.length > 0}
              title={
                gone.length > 0
                  ? `Not in data/mp4s: ${gone.join(', ')}`
                  : preset.clips.map((c) => c.fileName).join(', ')
              }
              onClick={() => onDemo(preset)}
              style={{ justifyContent: 'space-between' }}
            />
          );
        })}
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
          hints={[
            { key: 'ENTER', label: 'START' },
            { key: '1-3', label: 'DEMO' },
          ]}
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
