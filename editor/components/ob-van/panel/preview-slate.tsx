'use client';

import React from 'react';
import type { ObCam, ObSignalSummary, ObState } from '@smelter-editor/types';
import { roleLabel } from '@/lib/ob-van/roles';
import { shotCamIds } from '@/lib/ob-van/tally';
import { formatSeconds } from '@/lib/ob-van/pacing';
import { shotLabel } from '@/lib/ob-van/view-labels';
import {
  CamSignals,
  Display,
  Meta,
  Mono,
  OB,
  RADIUS,
  TagChip,
  scanLines,
} from '../ob-kit';
import { liveCamIds } from './shot-builder';
import { useServerNow } from './use-server-now';

/**
 * The PREVIEW slate. There is no per-camera video on the panel (and no
 * multiview), so the green monitor shows what the preview shot is made of:
 * each camera's number, name, role and talent with its live signal meters,
 * plus how long program has held and the lower third on air. Nothing here
 * is invented — only what `ob_state` / `ob_signals` say.
 */
export function PreviewSlate({
  state,
  signals,
  clockOffsetMs,
  style,
}: {
  state: ObState;
  signals: Record<string, ObSignalSummary>;
  clockOffsetMs: number;
  style?: React.CSSProperties;
}) {
  const now = useServerNow(clockOffsetMs);
  const preview = state.preview;
  const ids = shotCamIds(preview, liveCamIds(state.cams));
  const cams = ids
    .map((id) => state.cams.find((c) => c.id === id))
    .filter((c): c is ObCam => c != null);
  const programShot = state.program.shot;
  const since = programShot ? formatSeconds(now - state.program.sinceMs) : null;
  const l3 = state.lowerThird;
  const cols = cams.length <= 1 ? 1 : cams.length <= 4 ? 2 : 4;
  const size: 'xl' | 'md' | 'sm' =
    cams.length <= 1 ? 'xl' : cams.length <= 2 ? 'md' : 'sm';

  return (
    <div
      aria-label='preview'
      style={{
        position: 'relative',
        background: OB.well,
        backgroundImage: scanLines(0.03),
        border: `2px solid ${OB.preview}`,
        borderRadius: RADIUS,
        overflow: 'hidden',
        aspectRatio: '16 / 9',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        ...style,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 8px 0',
          minWidth: 0,
        }}>
        <TagChip tone='preview'>PREVIEW</TagChip>
        {preview ? (
          <Mono size={10} weight={600} tracking={0.14} color={OB.preview}>
            {shotLabel(preview, state.cams)}
          </Mono>
        ) : null}
      </div>

      {preview == null ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: 12,
            textAlign: 'center',
          }}>
          <Mono size={12} weight={600} tracking={0.2} color={OB.dim2}>
            NOTHING ON PREVIEW
          </Mono>
          <Meta size={9.5} color={OB.dim2}>
            press 1..8 or tap a bus
          </Meta>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: 'minmax(0, 1fr)',
            gap: 8,
            padding: 8,
          }}>
          {cams.length === 0 ? (
            <Meta color={OB.amber} style={{ alignSelf: 'center' }}>
              NO LIVE CAMERA IN THIS SHOT
            </Meta>
          ) : (
            cams.map((cam) => (
              <SlateCam
                key={cam.id}
                cam={cam}
                signals={signals[cam.id]}
                size={size}
              />
            ))
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: '6px 8px 7px',
          borderTop: `1px solid ${OB.rule}`,
          background: 'rgba(10,12,16,.55)',
          minWidth: 0,
        }}>
        <Meta
          size={9}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          <span style={{ color: OB.program }}>PGM</span>{' '}
          {shotLabel(programShot, state.cams)}
          {since ? ` · since ${since}` : ''}
        </Meta>
        {l3 ? (
          <Meta
            size={9}
            color={OB.chalk}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            L3 · {l3.name}
            {l3.subtitle ? ` — ${l3.subtitle}` : ''}
          </Meta>
        ) : null}
      </div>
    </div>
  );
}

const SLATE_SIZE = {
  xl: { num: 64, name: 24, role: 10.5 },
  md: { num: 40, name: 17, role: 9.5 },
  sm: { num: 24, name: 13, role: 8.5 },
} as const;

function SlateCam({
  cam,
  signals,
  size,
}: {
  cam: ObCam;
  signals: ObSignalSummary | undefined;
  size: 'xl' | 'md' | 'sm';
}) {
  const s = SLATE_SIZE[size];
  const dark = !cam.connected || !cam.live;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: size === 'sm' ? 4 : 8,
        minWidth: 0,
        minHeight: 0,
        opacity: dark ? 0.6 : 1,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: size === 'sm' ? 6 : 12,
          minWidth: 0,
        }}>
        <Display size={s.num} weight={800} color={OB.preview} lineHeight={0.9}>
          {cam.number}
        </Display>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 0,
          }}>
          <Display
            size={s.name}
            weight={700}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {cam.name || `CAM ${cam.number}`}
          </Display>
          <Mono
            size={s.role}
            weight={500}
            tracking={0.12}
            color={OB.dim}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {roleLabel(cam.role)}
            {cam.talent ? ` · ${cam.talent}` : ''}
          </Mono>
        </div>
      </div>
      {dark ? (
        <Mono
          size={9}
          weight={600}
          tracking={0.14}
          color={cam.connected ? OB.amber : OB.dim2}>
          {cam.connected ? 'NO SIGNAL' : 'DISCONNECTED'}
        </Mono>
      ) : (
        <div style={{ maxWidth: size === 'xl' ? 320 : undefined }}>
          <CamSignals signals={signals} compact={size !== 'xl'} />
        </div>
      )}
    </div>
  );
}
