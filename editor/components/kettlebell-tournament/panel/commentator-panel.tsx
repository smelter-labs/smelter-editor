'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRoomInfo } from '@/app/actions/actions';
import {
  applyServerUrlFromQueryParam,
  resolveMediaUrl,
} from '@/lib/server-url';
import {
  Frame,
  KBT,
  KbtConnectStep,
  Label,
  Stage,
  StatusDot,
  Tab,
} from '../kbt-kit';
import { NameStep } from '../phone/name-step';
import { CameraStep } from '../phone/camera-step';
import { useCommentatorRig } from './use-commentator-rig';
import { usePanelSocket } from './use-panel-socket';
import { useCamRecovery } from './use-cam-recovery';
import { PanelScreen } from './panel-screen';
import { DevicePickers } from './device-pickers';
import '../kbt-kit.css';

// Desktop moderator wizard: boot → name → camera+mic rig → the panel. Same
// commentator slot and localStorage name as the phone commentate page, so a
// phone → desktop switch adopts the slot by name.
type Step = 'connect' | 'name' | 'camera' | 'panel';

const STEP_META: Record<Step, { label: string }> = {
  connect: { label: 'CONNECTING' },
  name: { label: 'COMMENTATOR NAME' },
  camera: { label: 'CAM + MIC RIG' },
  panel: { label: 'LIVE' },
};

const NAME_KEY = 'kbt-commentator-name';

/** Centered single-column region for the pre-panel wizard steps. */
function WizardColumn({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <div
        style={{
          width: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
        {children}
      </div>
    </div>
  );
}

export function CommentatorPanel({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [whepUrl, setWhepUrl] = useState<string | null>(null);

  const rig = useCommentatorRig(roomId);
  const socket = usePanelSocket(roomId, {
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
        // The server action reports the address the Next server knows —
        // graft it so an off-host panel still reaches the WHEP endpoint.
        setWhepUrl(info.whepUrl ? resolveMediaUrl(info.whepUrl) : null);
      } else {
        setRoomStatus('not-found');
      }
    });
  }, [roomId]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    setName(window.localStorage.getItem(NAME_KEY) ?? '');
    loadRoom();
    return rig.dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && socket.connected && roomStatus === 'ok') {
      setStep('name');
    }
  }, [step, socket.connected, roomStatus]);

  // Refresh resume: if the stored name already holds the commentator slot,
  // re-join and skip to the rig step (cam + mic must be re-granted anyway).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || step !== 'name' || !socket.state) return;
    resumedRef.current = true;
    const stored = name.trim();
    if (!stored || socket.state.commentator?.name !== stored) return;
    socket.join(stored);
    setStep('camera');
  }, [step, socket, name]);

  // Camera step's GO LIVE lands on the panel once the publish is up.
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

  const onAir = rig.live && (socket.state?.commentator?.camConnected ?? false);

  return (
    <Stage>
      <Frame
        title='COMMENTARY CONTROL'
        tab={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Label size={10} tracking={1.5}>
              ROOM {roomId}
            </Label>
            <StatusDot
              state={
                step !== 'panel'
                  ? 'idle'
                  : onAir
                    ? 'good'
                    : socket.connected
                      ? 'warn'
                      : 'bad'
              }
              pulse={step === 'panel' && !onAir}
            />
            <Tab
              size={11}
              color={onAir ? KBT.good : KBT.fillStrong}
              textColor={onAir ? KBT.dark : KBT.dim}>
              {STEP_META[step].label}
            </Tab>
          </div>
        }
        footer={
          step === 'panel' ? (
            // Plain legend — [X] bracket hints are reserved for real
            // keyboard shortcuts.
            <Label size={10} tracking={1.5} style={{ display: 'block' }}>
              <span style={{ color: KBT.accent }}>AUTO</span> follows the show ·{' '}
              <span style={{ color: KBT.accent }}>VIEW</span> is what viewers
              see · <span style={{ color: KBT.accent }}>SHOW</span> runs the
              tournament
            </Label>
          ) : undefined
        }>
        {step === 'connect' ? (
          <WizardColumn>
            <KbtConnectStep
              roomStatus={roomStatus}
              wsConnected={socket.connected}
              wsError={socket.wsError}
              onRetry={retryConnect}
            />
          </WizardColumn>
        ) : step === 'name' ? (
          <WizardColumn>
            <NameStep
              name={name}
              onName={setName}
              onContinue={join}
              variant='commentator'
            />
          </WizardColumn>
        ) : step === 'camera' ? (
          <WizardColumn>
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
              variant='commentator-desktop'
              micLevel={rig.camOn ? rig.micLevel : null}
            />
            <DevicePickers rig={rig} />
          </WizardColumn>
        ) : (
          <PanelScreen
            socket={socket}
            rig={rig}
            recovery={recovery}
            name={name.trim() || 'Commentator'}
            whepUrl={whepUrl}
            roomId={roomId}
          />
        )}
      </Frame>
    </Stage>
  );
}
