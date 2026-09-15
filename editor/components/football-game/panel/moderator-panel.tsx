'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRoomInfo } from '@/app/actions/actions';
import {
  applyServerUrlFromQueryParam,
  resolveMediaUrl,
} from '@/lib/server-url';
import {
  FB,
  FbButton,
  HazardStrip,
  Meta,
  Mono,
  NameField,
  ProgressBar,
  Wordmark,
} from '../fb-kit';
import { useFbPanelSocket, readModeratorSession } from './use-fb-panel-socket';
import { PanelScreen } from './panel-screen';
import '../fb-kit.css';

// Touchline moderator wizard: connecting → name → the panel. Phone/tablet
// first: one scrolling column; a laptop gets it wide. No camera steps — the
// production runs on dataset file cameras.
type Step = 'connect' | 'name' | 'panel';

const NAME_KEY = 'fb-moderator-name';

function Shell({
  children,
  compact,
}: {
  children: React.ReactNode;
  compact: boolean;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: FB.page,
        color: FB.chalk,
        padding: compact ? '12px 12px 24px' : '24px 20px 40px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 12 : 20,
        maxWidth: 1180,
        margin: '0 auto',
      }}>
      {!compact ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Wordmark size={32} />
          <Meta size={10} tracking={0.22}>
            MODERATOR
          </Meta>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function ModeratorPanel({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const socket = useFbPanelSocket(roomId);

  const loadRoom = useCallback(() => {
    setRoomStatus('loading');
    void getRoomInfo(roomId).then((info) => {
      if (info && info !== 'not-found') {
        setRoomStatus('ok');
        setWhepUrl(info.whepUrl ? resolveMediaUrl(info.whepUrl) : null);
      } else {
        setRoomStatus('not-found');
      }
    });
  }, [roomId]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    const session = readModeratorSession(roomId);
    setName(session.name ?? window.localStorage.getItem(NAME_KEY) ?? '');
    loadRoom();
    const onResize = () => setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && socket.connected && roomStatus === 'ok')
      setStep('name');
  }, [step, socket.connected, roomStatus]);

  // Refresh resume: a stored session (or matching name) re-joins straight to the panel.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || step !== 'name' || !socket.state) return;
    resumedRef.current = true;
    const session = readModeratorSession(roomId);
    const stored = (session.name ?? name).trim();
    if (!stored) return;
    if (session.commentatorKey || socket.state.commentator?.name === stored) {
      socket.join(stored);
      setStep('panel');
    }
  }, [step, socket, name, roomId]);

  const join = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    socket.join(trimmed);
    setStep('panel');
  }, [name, socket]);

  const retryConnect = useCallback(() => {
    if (roomStatus !== 'ok') loadRoom();
    socket.retry();
  }, [roomStatus, loadRoom, socket]);

  const statusStrip =
    step === 'connect' ? null : !socket.connected ? (
      <HazardStrip text='RECONNECTING…' />
    ) : null;

  return (
    <>
      {statusStrip}
      <Shell compact={step === 'panel'}>
        {step === 'connect' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              paddingTop: 40,
            }}>
            <ProgressBar width={260} height={6} indeterminate />
            <Mono size={14} weight={600} tracking={0.24}>
              {roomStatus === 'not-found'
                ? 'ROOM NOT FOUND'
                : 'CONNECTING TO THE MATCH…'}
            </Mono>
            <Mono size={11} tracking={0.16} color={FB.dim} uppercase={false}>
              room {roomId} {socket.wsError ? `· ${socket.wsError}` : ''}
            </Mono>
            {roomStatus === 'not-found' || socket.wsError ? (
              <FbButton
                variant='outline'
                label='RETRY'
                onClick={retryConnect}
                style={{ height: 44, fontSize: 18, width: 160 }}
              />
            ) : null}
          </div>
        ) : step === 'name' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxWidth: 520,
            }}>
            <Mono size={11} tracking={0.22} color={FB.dim}>
              MODERATOR NAME
            </Mono>
            <Mono size={11} tracking={0.06} color={FB.dim} uppercase={false}>
              Shown on the lobby and in the ledger next to your calls.
            </Mono>
            <NameField
              value={name}
              onChange={setName}
              placeholder='YOUR NAME'
              maxLength={20}
              height={56}
              fontSize={28}
              autoFocus
              onEnter={join}
            />
            <FbButton
              active
              label='CONTINUE'
              disabled={!name.trim()}
              onClick={join}
              style={{ height: 52, fontSize: 22 }}
            />
          </div>
        ) : (
          <PanelScreen
            socket={socket}
            name={name.trim() || 'Moderator'}
            whepUrl={whepUrl}
            roomId={roomId}
            narrow={narrow}
          />
        )}
      </Shell>
    </>
  );
}
