'use client';

import React from 'react';
import { PixelPanel, R5, monoFont, pixelFont } from '../retro-kit';
import { ActionButton, WarnPanel } from './phone-shell';

type RowState = 'pending' | 'ok' | 'fail';

function BootRow({ label, state }: { label: string; state: RowState }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: pixelFont,
        fontSize: 11,
        letterSpacing: 1,
        color:
          state === 'ok' ? R5.green : state === 'fail' ? R5.red : R5.ink,
      }}>
      <span
        className={state === 'pending' ? 'r5-blink' : undefined}
        style={{
          width: 18,
          textAlign: 'center',
          color:
            state === 'ok' ? R5.green : state === 'fail' ? R5.red : R5.orange,
        }}>
        {state === 'ok' ? '✓' : state === 'fail' ? '✕' : '▸'}
      </span>
      {label}
      {state === 'pending' ? (
        <span className='r5-blink' style={{ color: R5.inkMuted }}>
          …
        </span>
      ) : null}
    </div>
  );
}

/**
 * Step 1 — the arcade boot sequence after scanning the QR: room lookup and
 * WebSocket uplink, with retro failure states. Auto-advances from the page
 * once both rows check.
 */
export function ConnectStep({
  roomStatus,
  wsConnected,
  wsError,
  onRetry,
}: {
  roomStatus: 'loading' | 'ok' | 'not-found';
  wsConnected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
  onRetry: () => void;
}) {
  const roomRow: RowState =
    roomStatus === 'ok' ? 'ok' : roomStatus === 'not-found' ? 'fail' : 'pending';
  const wsRow: RowState = wsConnected
    ? 'ok'
    : wsError && !wsError.startsWith('connecting')
      ? 'fail'
      : 'pending';

  return (
    <div
      style={{
        // Auto margins center when there's room, collapse to 0 on overflow —
        // unlike justifyContent:center, which clips the top in a scroll parent.
        margin: 'auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
      <PixelPanel
        cut={10}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '20px 18px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 2,
            color: R5.inkMuted,
          }}>
          BOOT SEQUENCE
        </span>
        <BootRow label='LINKING ROOM' state={roomRow} />
        <BootRow label='RADIO UPLINK' state={wsRow} />
      </PixelPanel>

      {roomStatus === 'not-found' ? (
        <WarnPanel>ROOM NOT FOUND — scan the QR on the screen again.</WarnPanel>
      ) : null}

      {wsRow === 'fail' ? (
        <>
          <WarnPanel>
            <span style={{ wordBreak: 'break-all' }}>{wsError}</span>
          </WarnPanel>
          <ActionButton
            accent='orange'
            label='RETRY UPLINK'
            active
            onClick={onRetry}
          />
        </>
      ) : null}

      <p
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        keep this phone on the same network as the screen
      </p>
    </div>
  );
}
