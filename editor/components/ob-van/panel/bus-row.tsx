'use client';

import React from 'react';
import type {
  ObCam,
  ObOperatorCommand,
  ObSignalSummary,
  ObState,
  ObTally,
} from '@smelter-editor/types';
import { tallyMap } from '@/lib/ob-van/tally';
import { Display, Meta, Mono, OB, RADIUS, obDisplay } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';
import { sortCams } from './shot-builder';

/** One bus key: number + name + a speech lamp. Program red, preview green. */
export function BusButton({
  cam,
  tally,
  speaking,
  pending,
  onClick,
  height = 58,
}: {
  cam: ObCam;
  tally: ObTally;
  speaking: boolean;
  pending: boolean;
  onClick: () => void;
  height?: number;
}) {
  const dark = !cam.connected || !cam.live;
  const bg =
    tally === 'program'
      ? OB.program
      : tally === 'preview'
        ? OB.previewDim
        : OB.plate2;
  const border =
    tally === 'program'
      ? `2px solid ${OB.program}`
      : tally === 'preview'
        ? `2px solid ${OB.preview}`
        : `1px solid ${OB.rule2}`;
  const fg =
    tally === 'program' ? '#fff' : tally === 'preview' ? OB.preview : OB.chalk;
  return (
    <button
      type='button'
      className='ob-btn'
      data-variant={tally === 'program' ? 'solid' : 'key'}
      onClick={onClick}
      aria-busy={pending || undefined}
      aria-label={`Preview CAM ${cam.number}`}
      title={`CAM ${cam.number} · ${cam.name}${dark ? (cam.connected ? ' · no signal' : ' · disconnected') : ''}`}
      style={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: 0,
        maxWidth: 170,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        boxSizing: 'border-box',
        background: bg,
        border,
        borderRadius: RADIUS,
        color: fg,
        opacity: dark ? 0.42 : 1,
        overflow: 'hidden',
        textAlign: 'left',
        boxShadow:
          tally === 'program' ? '0 0 16px rgba(255,45,45,.35)' : undefined,
      }}>
      <span
        style={{
          fontFamily: obDisplay,
          fontWeight: 800,
          fontSize: Math.round(height * 0.52),
          lineHeight: 1,
          flexShrink: 0,
        }}>
        {cam.number}
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minWidth: 0,
          flex: 1,
        }}>
        <Display
          size={14}
          weight={700}
          color={fg}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {cam.name || `CAM ${cam.number}`}
        </Display>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden
            title={speaking ? 'speaking' : undefined}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: speaking ? fg : 'transparent',
              border: `1px solid ${speaking ? fg : OB.dim2}`,
              boxShadow: speaking ? `0 0 6px ${fg}` : undefined,
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          />
          <Mono
            size={8}
            weight={600}
            tracking={0.12}
            color={tally === 'off' ? OB.dim : fg}>
            {dark
              ? cam.connected
                ? 'NO SIG'
                : 'OFFLINE'
              : speaking
                ? 'SPEECH'
                : 'LIVE'}
          </Mono>
        </span>
      </span>
      {pending ? <span className='ob-pending-bar' aria-hidden /> : null}
    </button>
  );
}

/** The preview bus: one key per camera, in number order. */
export function BusRow({
  state,
  signals,
  pending,
  desk,
}: {
  state: ObState;
  signals: Record<string, ObSignalSummary>;
  pending: ObPending;
  desk: boolean;
}) {
  const cams = sortCams(state.cams);
  const tallies = tallyMap(cams, state.program.shot, state.preview);
  if (cams.length === 0) {
    return (
      <div
        style={{
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px dashed ${OB.rule2}`,
          borderRadius: RADIUS,
        }}>
        <Meta>NO CAMERAS YET — PHONES JOIN FROM THE QR ON THE HOST</Meta>
      </div>
    );
  }
  return (
    <div
      role='group'
      aria-label='preview bus'
      style={{
        display: desk ? 'flex' : 'grid',
        gridTemplateColumns: desk ? undefined : 'repeat(4, minmax(0, 1fr))',
        gap: desk ? 8 : 6,
      }}>
      {cams.map((cam) => {
        const cmd: ObOperatorCommand = {
          op: 'preview',
          shot: { kind: 'solo', cam: cam.id },
        };
        return (
          <BusButton
            key={cam.id}
            cam={cam}
            tally={tallies[cam.id] ?? 'off'}
            speaking={
              signals[cam.id]?.speech === true && !signals[cam.id]?.stale
            }
            pending={pending.isPending(cmd)}
            onClick={() => pending.send(cmd)}
            height={desk ? 58 : 52}
          />
        );
      })}
    </div>
  );
}
