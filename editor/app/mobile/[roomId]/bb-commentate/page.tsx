'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { BbStateEvent, RoomEvent } from '@smelter-editor/types';
import { getRoomInfo } from '@/app/actions/actions';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import { bbDisplay, bbMono } from '@/app/basketball-game/fonts';
import {
  BB,
  BbButton,
  BbPlate,
  Copy,
  HazardStrip,
  Meta,
  MicMeter,
  Mono,
  ScoreRow,
  StatusPill,
  WarnPlate,
  Wordmark,
} from '@/components/basketball-game/bb-kit';
import { BbPhoneShell } from '@/components/basketball-game/phone/bb-phone-shell';
import { BbConnectStep } from '@/components/basketball-game/phone/bb-connect-step';
import { BbNameStep } from '@/components/basketball-game/phone/bb-name-step';
import { BbCamMicStep } from '@/components/basketball-game/phone/bb-cam-mic-step';
import { LowerThirdPreview } from '@/components/basketball-game/phone/bb-lower-third-preview';
import { usePreviewSet } from '@/components/kettlebell-tournament/phone/use-preview';
import { useMicLevel } from '@/components/kettlebell-tournament/phone/use-mic-level';
import { usePublishWatchdog } from '@/components/kettlebell-tournament/phone/use-publish-watchdog';
import {
  readModeratorSession,
  writeModeratorSession,
} from '@/components/basketball-game/panel/use-bb-panel-socket';
import '@/components/basketball-game/bb-kit.css';

// Phone commentator for the basketball game: boot → name → cam+mic → on air.
// Voice goes into the mix (delayed with the cameras so "SCORE!" lands with
// the ball); the cam shows as a lower-third PiP. For the referee controls
// use the panel (/basketball-game/panel/<room>) — this page is booth-only.
type Step = 'connect' | 'name' | 'camera' | 'onair';

const STEP_META: Record<Step, { index: number; label: string }> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'COMMENTATOR NAME' },
  camera: { index: 2, label: 'CAM + MIC RIG' },
  onair: { index: 3, label: 'ON AIR' },
};

const NAME_KEY = 'bb-moderator-name';
const RECONNECT_MAX_MS = 8000;
const REPUBLISH_MAX_MS = 8000;

export default function BasketballCommentatorPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [wsDbg, setWsDbg] = useState('');
  const [bbState, setBbState] = useState<BbStateEvent | null>(null);

  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const nameRef = useRef('');
  const facingRef = useRef<'user' | 'environment'>('user');
  const keyRef = useRef<string | null>(null);
  const resumeRef = useRef<'no' | 'pending' | 'done'>('no');
  const camStreamRef = useRef<MediaStream | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const republishDelayRef = useRef(1000);
  const republishTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  nameRef.current = name;
  facingRef.current = facing;

  useWhipHeartbeat(String(roomId), camInputId, camOn && live);
  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);
  const micLevel = useMicLevel(camStreamRef, camOn);
  usePublishWatchdog(live, camPcRef, setCamErr);

  const enableCamera = useCallback(
    async (nextFacing?: 'user' | 'environment') => {
      const facingMode = nextFacing ?? facingRef.current;
      try {
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        camStreamRef.current = stream;
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (camStreamRef.current === stream && wantsCamRef.current)
            scheduleRepublishRef.current?.();
        });
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setMuted(false);
        if (nextFacing) setFacing(nextFacing);
      } catch {
        setCamErr(
          'CAMERA/MIC BLOCKED — allow camera and microphone access for this site (HTTPS required) and try again.',
        );
        setCamOn(false);
      }
    },
    [syncPreviews],
  );

  const flipCamera = useCallback(() => {
    void enableCamera(facingRef.current === 'user' ? 'environment' : 'user');
  }, [enableCamera]);

  const toggleMute = useCallback(() => {
    const track = camStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const sendCamRequest = useCallback((ws: WebSocket) => {
    const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    ws.send(
      JSON.stringify({
        type: 'bb_commentator_cam_request',
        ...(settings?.width && settings?.height
          ? { nativeWidth: settings.width, nativeHeight: settings.height }
          : {}),
      }),
    );
  }, []);
  const sendCamRequestRef = useRef(sendCamRequest);
  sendCamRequestRef.current = sendCamRequest;

  const requestCamSilent = useCallback(() => {
    wantsCamRef.current = true;
    setPublishing(true);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) sendCamRequest(ws);
  }, [sendCamRequest]);

  const scheduleRepublishRef = useRef<(() => void) | null>(null);
  const scheduleRepublish = useCallback(() => {
    if (!wantsCamRef.current || closedByUsRef.current) return;
    if (republishTimerRef.current != null) return;
    setLive(false);
    const delay = republishDelayRef.current;
    republishDelayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    republishTimerRef.current = window.setTimeout(() => {
      republishTimerRef.current = null;
      if (!wantsCamRef.current || camPcRef.current != null) return;
      const track = camStreamRef.current?.getVideoTracks()[0];
      const streamDead = !track || track.readyState === 'ended';
      const fire = () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) requestCamSilent();
        else scheduleRepublishRef.current?.();
      };
      if (streamDead) {
        void enableCamera(facingRef.current).then(() => {
          const t = camStreamRef.current?.getVideoTracks()[0];
          if (t && t.readyState === 'live') fire();
          else scheduleRepublishRef.current?.();
        });
      } else {
        fire();
      }
    }, delay);
  }, [enableCamera, requestCamSilent]);
  scheduleRepublishRef.current = scheduleRepublish;

  const sendJoin = useCallback((ws: WebSocket) => {
    ws.send(
      JSON.stringify({
        type: 'bb_commentator_join',
        name: nameRef.current.trim() || 'Commentator',
        ...(keyRef.current ? { commentatorKey: keyRef.current } : {}),
      }),
    );
  }, []);

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'bb_state':
          setBbState(event);
          break;
        case 'bb_commentator_joined': {
          wantsJoinRef.current = true;
          keyRef.current = event.commentatorKey;
          writeModeratorSession(String(roomId), {
            commentatorKey: event.commentatorKey,
            name: event.name,
          });
          if (resumeRef.current === 'pending') {
            resumeRef.current = 'done';
            wantsCamRef.current = true;
            void enableCamera(facingRef.current).then(() => {
              const t = camStreamRef.current?.getVideoTracks()[0];
              if (t && t.readyState === 'live') requestCamSilent();
            });
            setStep('camera');
          }
          break;
        }
        case 'bb_error': {
          setNotice(event.message);
          if (noticeTimerRef.current != null)
            window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = window.setTimeout(
            () => setNotice(null),
            4000,
          );
          break;
        }
        case 'bb_cam_offer': {
          if (event.role !== 'commentator') return;
          if (!wantsCamRef.current || !camStreamRef.current) return;
          camPcRef.current?.close();
          camPcRef.current = null;
          setCamInputId(event.inputId);
          void startPublish(
            event.inputId,
            event.bearerToken,
            resolveMediaUrl(event.whipUrl),
            camPcRef,
            camStreamRef,
            () => {
              camPcRef.current = null;
              setLive(false);
              scheduleRepublishRef.current?.();
            },
            facingRef.current,
            false,
            camStreamRef.current,
            'h264',
          )
            .then(() => {
              setLive(true);
              setPublishing(false);
              setCamErr(null);
              republishDelayRef.current = 1000;
            })
            .catch(() => {
              camPcRef.current = null;
              setLive(false);
              setPublishing(false);
              setCamErr('PUBLISH FAILED — check the connection and try again.');
              scheduleRepublishRef.current?.();
            });
          break;
        }
        default:
          break;
      }
    },
    [enableCamera, requestCamSilent, roomId],
  );
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const connectWs = useCallback(() => {
    const base = toWsUrl(
      getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        remoteOrigin() ??
        getEffectiveClientServerUrl(),
    );
    const url = `${base}/room/${encodeURIComponent(String(roomId))}/ws`;
    setWsDbg(`connecting: ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setWsDbg('');
      reconnectDelayRef.current = 1000;
      ws.send(JSON.stringify({ type: 'bb_spectate' }));
      if (wantsJoinRef.current || resumeRef.current === 'pending') {
        sendJoin(ws);
        if (wantsCamRef.current && camStreamRef.current) {
          if (republishTimerRef.current != null) {
            window.clearTimeout(republishTimerRef.current);
            republishTimerRef.current = null;
          }
          sendCamRequestRef.current(ws);
        }
      }
    };
    ws.onerror = () => setWsDbg(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      setWsDbg(`WS closed (${ev.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        if (!closedByUsRef.current && wsRef.current === ws) connectWs();
      }, delay);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (data && typeof data === 'object' && 'type' in data)
        handleEventRef.current(data as RoomEvent);
    };
  }, [roomId, sendJoin]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    const session = readModeratorSession(String(roomId));
    keyRef.current = session.commentatorKey ?? null;
    if (session.commentatorKey) resumeRef.current = 'pending';
    setName(session.name ?? window.localStorage.getItem(NAME_KEY) ?? '');
    void getRoomInfo(String(roomId)).then((info) => {
      setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
    });
    closedByUsRef.current = false;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      camPcRef.current?.close();
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (republishTimerRef.current != null)
        window.clearTimeout(republishTimerRef.current);
      if (noticeTimerRef.current != null)
        window.clearTimeout(noticeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') setStep('name');
  }, [step, connected, roomStatus]);

  useEffect(() => {
    if (step === 'camera' && live) setStep('onair');
  }, [step, live]);

  const join = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) sendJoin(ws);
    setStep('camera');
  }, [sendJoin]);

  const requestCam = useCallback(() => {
    requestCamSilent();
  }, [requestCamSilent]);

  const retryConnect = useCallback(() => {
    setWsDbg('');
    closedByUsRef.current = false;
    wsRef.current?.close();
    if (roomStatus !== 'ok') {
      setRoomStatus('loading');
      void getRoomInfo(String(roomId)).then((info) => {
        setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
      });
    }
    connectWs();
  }, [roomId, roomStatus, connectWs]);

  const fontClass = `${bbDisplay.variable} ${bbMono.variable}`;
  const meta = STEP_META[step];
  const teams = bbState?.teams;

  const statusStrip =
    step === 'connect' ? null : !connected ? (
      <HazardStrip text='RECONNECTING…' />
    ) : notice ? (
      <HazardStrip text={notice} />
    ) : camOn && !live && wantsCamRef.current ? (
      <HazardStrip text='RESTORING VIDEO…' />
    ) : null;

  if (step === 'onair') {
    return (
      <div className={fontClass}>
        {statusStrip}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: BB.page,
            overflow: 'hidden',
            color: BB.chalk,
          }}>
          <video
            autoPlay
            playsInline
            muted
            ref={attachPreview}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: facing === 'user' ? 'scaleX(-1)' : undefined,
              filter: muted ? 'saturate(.5) brightness(.8)' : undefined,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 'calc(env(safe-area-inset-left, 0px) + 16px)',
              top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 8,
            }}>
            {live ? (
              <StatusPill tone='onair' size={11} height={30}>
                ON AIR
              </StatusPill>
            ) : (
              <StatusPill tone='idle' size={11} height={30}>
                OFFLINE
              </StatusPill>
            )}
            <span style={{ background: BB.plate, padding: '4px 8px' }}>
              <Mono
                size={10}
                tracking={0.2}
                color={BB.chalk}
                style={{ opacity: 0.85 }}>
                MIRRORED · 3 S BEHIND THE COURT
              </Mono>
            </span>
          </div>
          <span
            style={{
              position: 'absolute',
              right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
              top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
              background: BB.plate,
              padding: '4px 10px',
            }}>
            <Wordmark size={26} />
          </span>
          <div
            style={{
              position: 'absolute',
              left: 'calc(env(safe-area-inset-left, 0px) + 16px)',
              right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
            {teams ? (
              <div
                style={{
                  height: 56,
                  background: BB.plate,
                  padding: '0 14px',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                <ScoreRow
                  teams={teams}
                  nameSize={20}
                  scoreSize={30}
                  stripe={{ w: 8, h: 28 }}
                  separator='—'
                  style={{ flex: 1 }}
                />
              </div>
            ) : null}
            <BbPlate
              cutPx={0}
              fill={BB.plate}
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Meta size={10} tracking={0.22}>
                  MIC
                </Meta>
                <Meta
                  size={10}
                  tracking={0.22}
                  weight={600}
                  color={muted ? BB.bad : BB.good}>
                  {muted ? 'MUTED' : 'LIVE'}
                </Meta>
              </div>
              <MicMeter
                level={micLevel}
                muted={muted}
                segments={12}
                height={14}
              />
            </BbPlate>
            {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}
            <BbButton
              block
              size='lg'
              variant={muted ? 'dangerSolid' : 'chalk'}
              active={muted}
              label={muted ? 'MIC MUTED — UNMUTE' : 'MUTE MIC'}
              onClick={toggleMute}
              style={{ height: 60, fontSize: 26 }}
            />
            <Copy
              size={11}
              color='rgba(232,228,218,.7)'
              lineHeight={1.6}
              style={{ textAlign: 'center', letterSpacing: '.04em' }}>
              {muted
                ? 'Your camera is still going out. Only the mic is off.'
                : 'Your voice travels with the cameras, about 3 s behind the court. Call it as you see it, not as the screen shows it.'}
            </Copy>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={fontClass}>
      {statusStrip}
      <BbPhoneShell title='COMMENTARY' stepIndex={meta.index} stepCount={3}>
        {step === 'connect' ? (
          <BbConnectStep
            roomId={String(roomId)}
            roomStatus={roomStatus}
            wsConnected={connected}
            wsError={wsDbg}
            onRetry={retryConnect}
          />
        ) : step === 'name' ? (
          <BbNameStep
            heading={['COMMENTATOR', 'NAME']}
            hint='Goes on the lower third when you are on air.'
            name={name}
            onName={setName}
            onContinue={join}
            continueLabel='CONTINUE'
            placeholder='YOUR NAME'
            preview={<LowerThirdPreview name={name} />}
          />
        ) : (
          <BbCamMicStep
            optional={false}
            hint='Go on air as the courtside voice. Your picture and voice ride with the cameras, about 3 s behind.'
            camOn={camOn}
            camErr={camErr}
            facing={facing}
            publishing={publishing}
            live={live}
            attachVideo={attachPreview}
            onEnable={() => void enableCamera()}
            onFlip={flipCamera}
            onGoLive={requestCam}
            onContinue={() => setStep('onair')}
            micLevel={camOn ? micLevel : null}
          />
        )}
      </BbPhoneShell>
    </div>
  );
}
