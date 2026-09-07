'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRoomInfo } from '@/app/actions/actions';
import {
  applyServerUrlFromQueryParam,
  resolveMediaUrl,
} from '@/lib/server-url';
import {
  KBT,
  KbtButton,
  KbtConnectStep,
  KbtPhoneShell,
  KbtStatusStrip,
  Label,
} from '@/components/kettlebell-tournament/kbt-kit';
import { NameStep } from '@/components/kettlebell-tournament/phone/name-step';
import { CameraStep } from '@/components/kettlebell-tournament/phone/camera-step';
import { useCommentatorRig } from '@/components/kettlebell-tournament/panel/use-commentator-rig';
import { useCamRecovery } from '@/components/kettlebell-tournament/panel/use-cam-recovery';
import { DevicePickers } from '@/components/kettlebell-tournament/panel/device-pickers';
import '@/components/kettlebell-tournament/kbt-kit.css';
import { useBbPanelSocket, readModeratorSession } from './use-bb-panel-socket';
import { PanelScreen } from './panel-screen';

// Courtside moderator wizard: boot → name → (optional) cam+mic → the panel.
// Phone/tablet first: one scrolling column; a laptop gets the same page wide.
type Step = 'connect' | 'name' | 'camera' | 'panel';

const STEP_META: Record<Step, { index: number; label: string }> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'MODERATOR NAME' },
  camera: { index: 2, label: 'CAM + MIC (OPTIONAL)' },
  panel: { index: -1, label: 'COURTSIDE' },
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

  const meta = STEP_META[step];
  const statusStrip =
    step === 'connect' ? null : !socket.connected ? (
      <KbtStatusStrip text='RECONNECTING…' />
    ) : recovery.restoring && !rig.live ? (
      <KbtStatusStrip text='RESTORING VIDEO…' />
    ) : null;

  return (
    <>
      {statusStrip}
      <KbtPhoneShell
        title='BLACKTOP'
        stepIndex={meta.index}
        stepCount={3}
        stepLabel={meta.label}
        compact={step === 'panel'}>
        {step === 'connect' ? (
          <KbtConnectStep
            roomStatus={roomStatus}
            wsConnected={socket.connected}
            wsError={socket.wsError}
            onRetry={retryConnect}
          />
        ) : step === 'name' ? (
          <NameStep
            name={name}
            onName={setName}
            onContinue={join}
            variant='commentator'
          />
        ) : step === 'camera' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <CameraStep
              camOn={rig.camOn}
              camErr={rig.camErr}
              facing='user'
              cameraView='front'
              publishing={rig.publishing}
              live={rig.live}
              attachVideo={rig.attachPreview}
              onEnable={() => void rig.enableCamera()}
              onGoLive={goLive}
              onContinue={() => setStep('panel')}
              variant={narrow ? 'commentator-phone' : 'commentator-desktop'}
              micLevel={rig.camOn ? rig.micLevel : null}
            />
            {!narrow ? <DevicePickers rig={rig} /> : null}
            <KbtButton
              block
              variant='outline'
              label='MODERATE WITHOUT A CAMERA'
              sub='ledger, clock and views only — no voice on air'
              onClick={() => setStep('panel')}
            />
            <Label size={9} tracking={1} color={KBT.dim}>
              a camera + mic puts you on air as the commentator; skip it to only
              referee the AI&apos;s calls
            </Label>
          </div>
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
      </KbtPhoneShell>
    </>
  );
}
