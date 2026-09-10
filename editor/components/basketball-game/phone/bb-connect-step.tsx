'use client';

import React from 'react';
import { BB, BbButton, Mono, ProgressBar, WarnPlate } from '../bb-kit';

/**
 * Step 1 — connecting after the QR scan: a sweeping bar, CONNECTING, the
 * room id. Failures (room gone, uplink down) get a plate and a retry.
 */
export function BbConnectStep({
  roomId,
  roomStatus,
  wsConnected,
  wsError,
  onRetry,
}: {
  roomId: string;
  roomStatus: 'loading' | 'ok' | 'not-found';
  wsConnected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
  onRetry: () => void;
}) {
  const wsFailed =
    !wsConnected && !!wsError && !wsError.startsWith('connecting');
  const failed = roomStatus === 'not-found' || wsFailed;
  const label =
    roomStatus === 'not-found'
      ? 'ROOM NOT FOUND'
      : wsFailed
        ? 'UPLINK DOWN'
        : roomStatus === 'ok'
          ? 'LINKING'
          : 'CONNECTING';
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}>
      <ProgressBar
        width={220}
        indeterminate={!failed}
        value={failed ? 1 : 0}
        color={failed ? BB.bad : BB.electric}
      />
      <Mono
        size={14}
        weight={600}
        tracking={0.24}
        color={failed ? BB.bad : BB.chalk}>
        {label}
      </Mono>
      <Mono size={12} tracking={0.18} color={BB.chalk} style={{ opacity: 0.5 }}>
        ROOM {roomId}
      </Mono>
      {roomStatus === 'not-found' ? (
        <WarnPlate
          tone='bad'
          title='COURT CLOSED'
          style={{ alignSelf: 'stretch', marginTop: 20 }}>
          This room no longer exists. Scan the QR on the screen again.
        </WarnPlate>
      ) : null}
      {wsFailed ? (
        <>
          <WarnPlate
            tone='bad'
            title='NO UPLINK'
            style={{ alignSelf: 'stretch', marginTop: 20 }}>
            <span style={{ wordBreak: 'break-all' }}>{wsError}</span>
          </WarnPlate>
          <BbButton block active label='RETRY UPLINK' onClick={onRetry} />
        </>
      ) : null}
      <Mono
        size={10}
        tracking={0.16}
        color={BB.chalk}
        style={{ opacity: 0.4, textAlign: 'center', marginTop: 'auto' }}>
        keep this phone on the same network as the screen
      </Mono>
    </div>
  );
}
