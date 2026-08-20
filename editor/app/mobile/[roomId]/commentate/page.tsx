'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { KbtStateEvent, RoomEvent } from '@smelter-editor/types';
import { getRoomInfo } from '@/app/actions/actions';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  isLoopbackHost,
  toWsUrl,
} from '@/lib/server-url';
import { bigShoulders, plexMono } from '@/app/kettlebell-tournament/fonts';
import {
  KBT,
  KbtButton,
  KbtConnectStep,
  KbtPhoneShell,
  Tab,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import { NameStep } from '@/components/kettlebell-tournament/phone/name-step';
import { CameraStep } from '@/components/kettlebell-tournament/phone/camera-step';
import '@/components/kettlebell-tournament/kbt-kit.css';

// The commentator wizard: boot → name → camera+mic rig → on air. Unlike the
// lifter page this publishes AUDIO too — the voice is mixed into the
// broadcast; the cam shows as a lower-third between heats.
type Step = 'connect' | 'name' | 'camera' | 'onair';

const STEP_META: Record<Step, { index: number; label: string }> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'COMMENTATOR NAME' },
  camera: { index: 2, label: 'CAM + MIC RIG' },
  onair: { index: 3, label: 'ON AIR' },
};

const NAME_KEY = 'kbt-commentator-name';
const RECONNECT_MAX_MS = 8000;

function remoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const o = window.location.origin;
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(o) ? null : o;
}

// Media endpoints (WHIP) come from the server, which may only know its
// loopback address — same grafting rule as the lifter page.
function resolveMediaUrl(url: string): string {
  const base =
    getStoredClientServerUrl() ?? getPublicDefaultServerUrl() ?? remoteOrigin();
  if (!base) return url;
  try {
    const u = new URL(url);
    if (!isLoopbackHost(u.hostname)) return url;
    return base + u.pathname + u.search;
  } catch {
    return url;
  }
}

export default function CommentatorPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [wsDbg, setWsDbg] = useState('');
  const [kbtState, setKbtState] = useState<KbtStateEvent | null>(null);

  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const nameRef = useRef('');
  const facingRef = useRef<'user' | 'environment'>('user');
  const camStreamRef = useRef<MediaStream | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const previewElsRef = useRef(new Set<HTMLVideoElement>());
  nameRef.current = name;
  facingRef.current = facing;

  // Keeps the stream published server-side (ack every 5s, wake lock).
  useWhipHeartbeat(String(roomId), camInputId, camOn);

  // ── Camera + mic ──────────────────────────────────────────────────────────

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    previewElsRef.current.add(el);
    el.muted = true; // never monitor your own mic
    if (camStreamRef.current) el.srcObject = camStreamRef.current;
  }, []);

  const syncPreviews = useCallback(() => {
    for (const el of previewElsRef.current) {
      if (el.isConnected) el.srcObject = camStreamRef.current;
      else previewElsRef.current.delete(el);
    }
  }, []);

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
          // The whole point of this role: commentary audio into the mix.
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        camStreamRef.current = stream;
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
        type: 'kbt_commentator_cam_request',
        ...(settings?.width && settings?.height
          ? { nativeWidth: settings.width, nativeHeight: settings.height }
          : {}),
      }),
    );
  }, []);

  const sendCamRequestRef = useRef(sendCamRequest);
  sendCamRequestRef.current = sendCamRequest;

  const requestCam = useCallback(() => {
    wantsCamRef.current = true;
    setPublishing(true);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      sendCamRequest(ws);
    }
  }, [sendCamRequest]);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const handleEvent = useCallback((event: RoomEvent) => {
    switch (event.type) {
      case 'kbt_state':
        setKbtState(event);
        break;
      case 'kbt_cam_offer': {
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
          },
          facingRef.current,
          false,
          camStreamRef.current,
          'h264',
        )
          .then(() => {
            setLive(true);
            setPublishing(false);
          })
          .catch(() => {
            camPcRef.current = null;
            setLive(false);
            setPublishing(false);
            setCamErr('PUBLISH FAILED — check the connection and try again.');
          });
        break;
      }
      default:
        break;
    }
  }, []);

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
      ws.send(JSON.stringify({ type: 'kbt_spectate' }));
      // A reconnect minted a fresh clientId: re-join (the commentator slot
      // adopts us back by name) and re-arm the cam with a fresh input.
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'kbt_commentator_join',
            name: nameRef.current.trim() || 'Commentator',
          }),
        );
        if (wantsCamRef.current && camStreamRef.current) {
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
      if (data && typeof data === 'object' && 'type' in data) {
        handleEventRef.current(data as RoomEvent);
      }
    };
  }, [roomId]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    setName(window.localStorage.getItem(NAME_KEY) ?? '');
    void getRoomInfo(String(roomId)).then((info) => {
      setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
    });
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      camPcRef.current?.close();
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep('name');
    }
  }, [step, connected, roomStatus]);

  // Camera step's CONTINUE lands on the on-air screen.
  useEffect(() => {
    if (step === 'camera' && live) setStep('onair');
  }, [step, live]);

  const join = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kbt_commentator_join', name: trimmed }));
    }
    setStep('camera');
  }, []);

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

  const fontClass = `${bigShoulders.variable} ${plexMono.variable}`;
  const meta = STEP_META[step];
  const phase = kbtState?.tournamentPhase ?? 'roster';

  return (
    <div className={fontClass}>
      <KbtPhoneShell
        title='COMMENTARY'
        stepIndex={meta.index}
        stepCount={Object.keys(STEP_META).length}
        stepLabel={meta.label}>
        {step === 'connect' ? (
          <KbtConnectStep
            roomStatus={roomStatus}
            wsConnected={connected}
            wsError={wsDbg}
            onRetry={retryConnect}
          />
        ) : step === 'name' ? (
          <NameStep name={name} onName={setName} onContinue={join} />
        ) : step === 'camera' ? (
          <CameraStep
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
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              padding: '24px 16px',
              textAlign: 'center',
            }}>
            <Tab color={live ? KBT.good : KBT.bad} textColor={KBT.dark}>
              {live ? 'ON AIR' : 'OFFLINE'}
            </Tab>
            <video
              autoPlay
              playsInline
              muted
              ref={attachPreview}
              style={{
                width: '70%',
                maxWidth: 260,
                border: `1px solid ${KBT.border}`,
                transform: facing === 'user' ? 'scaleX(-1)' : undefined,
              }}
            />
            <div
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 11,
                letterSpacing: 0.5,
                lineHeight: 1.6,
                color: KBT.dim,
              }}>
              Your voice is live in the broadcast mix.
              {phase === 'roster' || phase === 'podium'
                ? ' Your camera shows in the lower-third.'
                : ' Camera shows between heats; during heats you are audio-only.'}
            </div>
            <KbtButton
              variant={muted ? 'danger' : 'outline'}
              label={muted ? 'MIC MUTED — UNMUTE' : 'MUTE MIC'}
              onClick={toggleMute}
            />
          </div>
        )}
      </KbtPhoneShell>
    </div>
  );
}
