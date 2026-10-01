'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRoomInfo } from '@/app/actions/actions';
import {
  applyServerUrlFromQueryParam,
  resolveMediaUrl,
} from '@/lib/server-url';
import {
  Copy,
  HazardStrip,
  Meta,
  OB,
  ObButton,
  ObConnectStep,
  ObPlate,
  TextField,
  Wordmark,
} from '../ob-kit';
import { PanelScreen } from './panel-screen';
import { readOperatorSession, useObPanelSocket } from './use-ob-panel-socket';
import '../ob-kit.css';

// OB Van operator wizard: connecting → name → the desk. A tablet or laptop
// gets the desk layout (≥ 900 px); a phone gets one stacked column.
type Step = 'connect' | 'name' | 'panel';

const NAME_KEY = 'ob-operator-name';
const DESK_MIN_WIDTH = 900;

function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide: boolean;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: OB.page,
        color: OB.chalk,
        boxSizing: 'border-box',
        padding: wide ? '10px 16px 12px' : '24px 16px 40px',
      }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: wide ? 10 : 20,
          ...(wide ? { width: '100%' } : { maxWidth: 520, margin: '0 auto' }),
        }}>
        {!wide ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Wordmark size={30} lit={false} />
            <Meta size={10} tracking={0.22}>
              OPERATOR DESK
            </Meta>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function OperatorPanel({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [roomStatus, setRoomStatus] = useState<
    'loading' | 'ok' | 'not-found' | 'unreachable'
  >('loading');
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [desk, setDesk] = useState(true);

  const socket = useObPanelSocket(roomId);

  const loadRoom = useCallback(() => {
    setRoomStatus('loading');
    void getRoomInfo(roomId)
      .then((info) => {
        if (info && info !== 'not-found') {
          setRoomStatus('ok');
          setWhepUrl(info.whepUrl ? resolveMediaUrl(info.whepUrl) : null);
        } else {
          setRoomStatus('not-found');
        }
      })
      .catch(() => setRoomStatus('unreachable'));
  }, [roomId]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    const session = readOperatorSession(roomId);
    let storedName: string | null = null;
    try {
      storedName = window.localStorage.getItem(NAME_KEY);
    } catch {
      /* storage blocked */
    }
    setName(session.name ?? storedName ?? '');
    loadRoom();
    const onResize = () => setDesk(window.innerWidth >= DESK_MIN_WIDTH);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && socket.connected && roomStatus === 'ok')
      setStep('name');
  }, [step, socket.connected, roomStatus]);

  // Refresh resume: a stored operator key (or the desk already under our
  // name) re-joins straight to the desk.
  const resumedRef = useRef(false);
  const joinRef = useRef(socket.join);
  joinRef.current = socket.join;
  useEffect(() => {
    if (resumedRef.current || step !== 'name' || !socket.state) return;
    resumedRef.current = true;
    const session = readOperatorSession(roomId);
    const stored = (session.name ?? name).trim();
    if (!stored) return;
    if (session.operatorKey || socket.state.operator?.name === stored) {
      joinRef.current(stored);
      setStep('panel');
    }
  }, [step, socket.state, name, roomId]);

  const join = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(NAME_KEY, trimmed);
    } catch {
      /* storage blocked */
    }
    joinRef.current(trimmed);
    setStep('panel');
  }, [name]);

  const leaveRef = useRef(socket.leave);
  leaveRef.current = socket.leave;
  const leave = useCallback(() => {
    leaveRef.current();
    resumedRef.current = true;
    setStep('name');
  }, []);

  const retryRef = useRef(socket.retry);
  retryRef.current = socket.retry;
  const retryConnect = useCallback(() => {
    if (roomStatus !== 'ok') loadRoom();
    retryRef.current();
  }, [roomStatus, loadRoom]);

  const statusStrip =
    step !== 'connect' && !socket.connected ? (
      <HazardStrip text='RECONNECTING…' />
    ) : null;

  return (
    <>
      {statusStrip}
      <Shell wide={step === 'panel'}>
        {step === 'connect' ? (
          <ObConnectStep
            roomStatus={roomStatus}
            wsConnected={socket.connected}
            wsError={socket.wsError}
            onRetry={retryConnect}
            hint={`room ${roomId}`}
          />
        ) : step === 'name' ? (
          <ObPlate title='OPERATOR' padding='16px 14px' gap={12}>
            <Copy size={11.5}>
              Your name shows on the host screen and in the WHY log next to your
              cuts. One operator at a time — joining takes the desk.
            </Copy>
            <TextField
              value={name}
              onChange={setName}
              placeholder='YOUR NAME'
              label='operator name'
              maxLength={24}
              height={52}
              fontSize={26}
              display
              autoFocus
              onEnter={join}
            />
            <ObButton
              block
              variant='primary'
              size='lg'
              label='CONTINUE'
              active={name.trim().length > 0}
              disabled={!name.trim()}
              onClick={join}
            />
          </ObPlate>
        ) : (
          <PanelScreen
            socket={socket}
            name={name.replace(/\s+/g, ' ').trim() || 'Operator'}
            whepUrl={whepUrl}
            desk={desk}
            onLeave={leave}
          />
        )}
      </Shell>
    </>
  );
}
