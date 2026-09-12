'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRoomInfo } from '@/app/actions/actions';
import {
  applyServerUrlFromQueryParam,
  resolveMediaUrl,
} from '@/lib/server-url';
import { useCommentatorRig } from '@/components/kettlebell-tournament/panel/use-commentator-rig';
import { useCamRecovery } from '@/components/kettlebell-tournament/panel/use-cam-recovery';
import { BbDevicePickers, HazardStrip } from '../bb-kit';
import { BbPhoneShell } from '../phone/bb-phone-shell';
import { BbConnectStep } from '../phone/bb-connect-step';
import { BbNameStep } from '../phone/bb-name-step';
import { BbCamMicStep } from '../phone/bb-cam-mic-step';
import { useBbPanelSocket, readModeratorSession } from './use-bb-panel-socket';
import { PanelScreen } from './panel-screen';
import '../bb-kit.css';

// Courtside moderator wizard: connecting → name → (optional) cam+mic → the
// panel. Phone/tablet first: one scrolling column; a laptop gets it wide.
type Step = 'connect' | 'name' | 'camera' | 'panel';

const STEP_INDEX: Record<Step, number> = {
  connect: 0,
  name: 1,
  camera: 2,
  panel: -1,
};

const NAME_KEY = 'bb-moderator-name';

export function ModeratorPanel({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const rig = useCommentatorRig(roomId);
  const socket = useBbPanelSocket(roomId, {
    getCamDims: rig.getCamDims,
    hasStream: rig.hasStream,
    onCamOffer: rig.handleCamOffer,
  });
  const recovery = useCamRecovery(rig, socket);

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
    return () => {
      window.removeEventListener('resize', onResize);
      rig.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && socket.connected && roomStatus === 'ok')
      setStep('name');
  }, [step, socket.connected, roomStatus]);

  // Refresh resume: a stored session (or matching name) re-joins straight
  // to the panel — the camera is optional, so nothing else to re-arm.
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

  useEffect(() => {
    if (step === 'camera' && rig.live) setStep('panel');
  }, [step, rig.live]);

  const join = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    socket.join(trimmed);
    setStep('camera');
  }, [name, socket]);

  const goLive = useCallback(() => {
    recovery.markWanted();
    rig.markPublishing();
    socket.requestCam();
  }, [recovery, rig, socket]);

  const retryConnect = useCallback(() => {
    if (roomStatus !== 'ok') loadRoom();
    socket.retry();
  }, [roomStatus, loadRoom, socket]);

  const statusStrip =
    step === 'connect' ? null : !socket.connected ? (
      <HazardStrip text='RECONNECTING…' />
    ) : recovery.restoring && !rig.live ? (
      <HazardStrip text='RESTORING VIDEO…' />
    ) : null;

  return (
    <>
      {statusStrip}
      <BbPhoneShell
        title='MODERATOR'
        stepIndex={STEP_INDEX[step]}
        stepCount={4}
        compact={step === 'panel'}
        hideHeader={step === 'panel'}
        gap={step === 'panel' ? 12 : undefined}>
        {step === 'connect' ? (
          <BbConnectStep
            roomId={roomId}
            roomStatus={roomStatus}
            wsConnected={socket.connected}
            wsError={socket.wsError}
            onRetry={retryConnect}
          />
        ) : step === 'name' ? (
          <BbNameStep
            heading={['MODERATOR', 'NAME']}
            hint='Shown on the lobby and in the ledger next to your calls.'
            name={name}
            onName={setName}
            onContinue={join}
            continueLabel='CONTINUE'
            placeholder='YOUR NAME'
          />
        ) : step === 'camera' ? (
          <BbCamMicStep
            camOn={rig.camOn}
            camErr={rig.camErr}
            publishing={rig.publishing}
            live={rig.live}
            attachVideo={rig.attachPreview}
            onEnable={() => void rig.enableCamera()}
            onGoLive={goLive}
            onContinue={() => setStep('panel')}
            onSkip={() => setStep('panel')}
            micLevel={rig.camOn ? rig.micLevel : null}
            devicePickers={!narrow ? <BbDevicePickers rig={rig} /> : null}
          />
        ) : (
          <PanelScreen
            socket={socket}
            rig={rig}
            recovery={recovery}
            name={name.trim() || 'Moderator'}
            whepUrl={whepUrl}
            roomId={roomId}
            narrow={narrow}
          />
        )}
      </BbPhoneShell>
    </>
  );
}
