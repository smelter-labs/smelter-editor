'use client';

import React from 'react';
import { OB_DEFAULT_CONFIG } from '@smelter-editor/types';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { OB_RESOLUTIONS, type ObResolution } from '@/lib/ob-van/ui-config';
import {
  Copy,
  Display,
  FooterHints,
  Meta,
  Mono,
  OB,
  ObButton,
  Segment,
  Wordmark,
  deskGrid,
  scanLines,
} from '../ob-kit';

/** Decorative bus: eight lamps, one on program, one on preview. */
function LampRow() {
  return (
    <div aria-hidden style={{ display: 'flex', gap: 10 }}>
      {Array.from({ length: 8 }, (_, i) => {
        const tone = i === 1 ? OB.program : i === 4 ? OB.preview : null;
        return (
          <div
            key={i}
            style={{
              width: 58,
              height: 46,
              borderRadius: 3,
              border: `1px solid ${tone ?? OB.rule2}`,
              background: tone ? `${tone}22` : OB.plate,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              boxShadow: tone ? `0 0 18px ${tone}33` : 'none',
            }}>
            <Display size={20} weight={800} color={tone ?? OB.dim}>
              {i + 1}
            </Display>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: tone ?? OB.fillStrong,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Attract screen: the wordmark, what it does, NEW EVENT. */
export function TitleScreen({
  creating,
  resolution,
  onResolution,
  eventName,
  onNewEvent,
}: {
  creating: boolean;
  resolution: ObResolution;
  onResolution: (r: ObResolution) => void;
  eventName: string;
  onNewEvent: () => void;
}) {
  useArcadeKeys({ confirm: () => !creating && onNewEvent() });

  return (
    <div
      className='ob-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: OB.page,
        backgroundImage: deskGrid(0.03),
        backgroundSize: '40px 40px',
        overflow: 'hidden',
      }}>
      {/* monitor wall glow on the right */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -120,
          top: 70,
          width: 620,
          height: 360,
          borderRadius: 6,
          border: `2px solid ${OB.program}`,
          background: `radial-gradient(ellipse at 40% 45%, #1b2230, ${OB.page} 75%)`,
          backgroundImage: scanLines(0.035),
          boxShadow: '0 0 80px rgba(255,45,45,.12)',
          opacity: 0.9,
        }}>
        <span
          style={{
            position: 'absolute',
            top: 14,
            left: 16,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}>
          <span
            className='ob-pulse'
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: OB.program,
            }}
          />
          <Mono size={12} weight={600} tracking={0.24} color={OB.program}>
            PROGRAM
          </Mono>
        </span>
        <div
          style={{
            position: 'absolute',
            left: 28,
            bottom: 34,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 14px',
            background: 'rgba(10,12,16,.82)',
            borderLeft: `3px solid ${OB.accent}`,
          }}>
          <Display size={22} weight={700}>
            ANNA KOWALSKA
          </Display>
          <Mono size={10} tracking={0.16} color={OB.dim}>
            KEYNOTE · CAM 2
          </Mono>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 92,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
        <Wordmark size={132} />
        <Display size={34} weight={600} tracking={0.32} color={OB.dim}>
          AI DIRECTOR
        </Display>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 336,
          width: 470,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}>
        <Copy size={13} color='rgba(230,233,239,.82)' lineHeight={1.7}>
          Phones and files become cameras. Cut it yourself on the desk — or hand
          it to the auto pilot, which sees three seconds ahead and cuts on
          speech, motion and your rules. Every cut says why.
        </Copy>
        <LampRow />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 560,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 22,
        }}>
        <ObButton
          size='lg'
          variant='program'
          active={!creating}
          locked={creating}
          label={creating ? 'OPENING…' : 'NEW EVENT'}
          keyBadge='ENTER'
          onClick={onNewEvent}
          style={{ minWidth: 250 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Meta size={9}>OUTPUT</Meta>
          <Segment
            options={OB_RESOLUTIONS.map((r) => ({
              value: r,
              label: r.toUpperCase(),
            }))}
            value={resolution}
            onChange={onResolution}
            height={32}
            style={{ width: 170 }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 72,
          top: 470,
          width: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
        {[
          ['1', 'SETUP', 'event, preset, cameras join by QR'],
          ['2', 'ON AIR', 'you cut, or the auto pilot does'],
          ['3', 'WRAP', 'stats, recording, director’s notes'],
        ].map(([n, title, sub]) => (
          <div
            key={n}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              borderTop: `1px solid ${OB.rule}`,
              paddingTop: 8,
            }}>
            <Mono size={11} weight={600} color={OB.dim2}>
              {n}
            </Mono>
            <Display size={18} weight={700} tracking={0.08}>
              {title}
            </Display>
            <Mono size={10.5} tracking={0.04} uppercase={false} color={OB.dim}>
              {sub}
            </Mono>
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          padding: '0 72px',
          borderTop: `1px solid ${OB.rule}`,
        }}>
        <FooterHints
          hints={[{ key: 'ENTER', label: 'NEW EVENT' }]}
          right={
            <Mono size={9.5} tracking={0.18} color={OB.dim2}>
              {eventName && eventName !== OB_DEFAULT_CONFIG.eventName
                ? `${eventName} · `
                : ''}
              OB VAN · HOST
            </Mono>
          }
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}
