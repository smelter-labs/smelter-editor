'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  KbtMatchEvent,
  KbtStateEvent,
  RoomEvent,
} from '@smelter-editor/types';
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
import { doto, pressStart, robotoMono } from '@/app/duck-hunter/fonts';
import { PhoneShell } from '@/components/duck-hunter/phone/phone-shell';
import { ConnectStep } from '@/components/duck-hunter/phone/connect-step';
import { NameStep } from '@/components/kettlebell-tournament/phone/name-step';
import { CameraStep } from '@/components/kettlebell-tournament/phone/camera-step';
import { ReadyStep } from '@/components/kettlebell-tournament/phone/ready-step';
import { LiveHud } from '@/components/kettlebell-tournament/phone/live-hud';
import '@/components/duck-hunter/retro.css';

// The lifter wizard: boot → name → camera rig → standing by → the heat.
type Step = 'connect' | 'name' | 'camera' | 'ready' | 'live';

const STEP_META: Record<
  Exclude<Step, 'live'>,
  { index: number; label: string }
> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'LIFTER NAME' },
  camera: { index: 2, label: 'CAMERA RIG' },
  ready: { index: 3, label: 'STANDING BY' },
};

const NAME_KEY = 'kbt-lifter-name';
const RECONNECT_MAX_MS = 8000;

function remoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const o = window.location.origin;
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(o) ? null : o;
}

// Media endpoints (WHIP) come from the server, which may only know its
// loopback address — same grafting rule as the Duck Hunter controller page.
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

export default function LiftControllerPage() {
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
  const [match, setMatch] = useState<KbtMatchEvent | null>(null);
  const [myClientId, setMyClientId] = useState<string | null>(null);
  const [poseTracked, setPoseTracked] = useState(false);
  const [fullBody, setFullBody] = useState(true);

  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);

  const [points, setPoints] = useState(0);
  const [reps, setReps] = useState(0);
  const [streak, setStreak] = useState(0);
  const [exercise, setExercise] = useState('idle');
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const nameRef = useRef('');
  const facingRef = useRef<'user' | 'environment'>('user');
  const myClientIdRef = useRef<string | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const previewElsRef = useRef(new Set<HTMLVideoElement>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stepRef = useRef<Step>('connect');
  stepRef.current = step;
  nameRef.current = name;
  facingRef.current = facing;
  myClientIdRef.current = myClientId;

  // Keeps the camera stream published server-side (ack every 5s, wake lock).
  useWhipHeartbeat(String(roomId), camInputId, camOn);

  // ── Feedback (beeps + vibration) ──────────────────────────────────────────

  const beep = useCallback((kind: 'good' | 'bad' | 'end') => {
    try {
      const ctx = (audioCtxRef.current ??= new AudioContext());
      if (ctx.state === 'suspended') void ctx.resume();
      const times = kind === 'end' ? [0, 0.18, 0.36] : [0];
      for (const t of times) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value =
          kind === 'good' ? 880 : kind === 'bad' ? 220 : 660;
        gain.gain.setValueAtTime(0.08, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + t + (kind === 'bad' ? 0.16 : 0.1),
        );
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.2);
      }
    } catch {
      // No audio — vibration still fires.
    }
  }, []);

  // ── Camera ────────────────────────────────────────────────────────────────

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    previewElsRef.current.add(el);
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
        // Square ideals: orientation-agnostic, so a portrait phone gets a
        // full-FOV 720x1280 mode instead of a cropped landscape 1280x720
        // (which is what made the preview look zoomed-in/small).
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        camStreamRef.current = stream;
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        if (nextFacing) setFacing(nextFacing);
      } catch {
        setCamErr(
          'CAMERA BLOCKED — allow camera access for this site (HTTPS required) and try again.',
        );
        setCamOn(false);
      }
    },
    [syncPreviews],
  );

  const flipCamera = useCallback(() => {
    void enableCamera(facingRef.current === 'user' ? 'environment' : 'user');
  }, [enableCamera]);

  // Includes the ACTUAL track dimensions so the server registers the input
  // with its true aspect (portrait cams were cover-cropped without them).
  const sendCamRequest = useCallback((ws: WebSocket) => {
    const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    ws.send(
      JSON.stringify({
        type: 'kbt_cam_request',
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
    // Unlock audio on this user gesture (iOS) for later rep beeps.
    beep('good');
  }, [beep, sendCamRequest]);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      const mine = (clientId: string) =>
        myClientIdRef.current == null || clientId === myClientIdRef.current;
      switch (event.type) {
        case 'kbt_state':
          setKbtState(event);
          break;
        case 'kbt_match': {
          setMatch(event);
          // Authoritative per-second resync of my sheet (reps arrive live too).
          const id = myClientIdRef.current;
          const sheet = id ? event.scores[id] : undefined;
          if (sheet) {
            setPoints(sheet.points);
            setReps(sheet.reps.swing + sheet.reps.clean + sheet.reps.snatch);
          }
          break;
        }
        case 'kbt_cam_offer': {
          setMyClientId((prev) => prev ?? event.clientId);
          myClientIdRef.current ??= event.clientId;
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
        case 'kbt_pose':
          setMyClientId((prev) => prev ?? event.clientId);
          myClientIdRef.current ??= event.clientId;
          if (mine(event.clientId)) {
            setPoseTracked(event.tracked);
            setFullBody(event.fullBody !== false);
          }
          break;
        case 'kbt_rep': {
          if (!mine(event.clientId)) return;
          setPoints(event.totalPoints);
          setReps((r) => r + 1);
          setStreak(event.streak);
          setExercise(event.exercise);
          const bad = event.verdict === 'incorrect';
          setFlash(bad ? 'bad' : 'good');
          beep(bad ? 'bad' : 'good');
          if (navigator.vibrate) navigator.vibrate(bad ? [30, 40, 30] : 50);
          window.setTimeout(() => setFlash(null), 350);
          break;
        }
        default:
          break;
      }
    },
    [beep],
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
      ws.send(JSON.stringify({ type: 'kbt_spectate' }));
      // A reconnect minted a fresh clientId server-side: re-join (the roster
      // adopts us back by name) and re-arm the camera with a fresh input.
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'kbt_join',
            name: nameRef.current.trim() || 'Lifter',
          }),
        );
        setMyClientId(null);
        myClientIdRef.current = null;
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

  // Boot auto-advance once the room + uplink check out.
  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep('name');
    }
  }, [step, connected, roomStatus]);

  // ── Heat membership + step choreography ──────────────────────────────────

  const me =
    (myClientId && kbtState?.players.find((p) => p.clientId === myClientId)) ||
    kbtState?.players.find((p) => p.name === name.trim()) ||
    null;
  const currentHeat =
    match?.heatIndex != null && kbtState
      ? kbtState.heats[match.heatIndex]
      : null;
  const inCurrentHeat =
    !!me && !!currentHeat && currentHeat.playerIds.includes(me.clientId);
  const inMyIntro = inCurrentHeat && match?.phase === 'intro';

  useEffect(() => {
    if (!inCurrentHeat || !match) return;
    if (
      (match.phase === 'countdown' || match.phase === 'playing') &&
      stepRef.current === 'ready'
    ) {
      setStreak(0);
      setExercise('idle');
      setStep('live');
    }
    if (match.phase === 'ended' && stepRef.current === 'live') {
      beep('end');
      if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]);
      const t = window.setTimeout(() => {
        if (stepRef.current === 'live') setStep('ready');
      }, 2500);
      return () => window.clearTimeout(t);
    }
  }, [inCurrentHeat, match, beep]);

  // Fresh sheet when my heat gets staged.
  useEffect(() => {
    if (inMyIntro) {
      setPoints(0);
      setReps(0);
      setStreak(0);
      setExercise('idle');
    }
  }, [inMyIntro]);

  // Live clock between 1 Hz server ticks.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!match) {
        setRemainingMs(null);
        return;
      }
      if (match.phase === 'countdown' && match.startsAtMs != null) {
        setRemainingMs(Math.max(0, match.startsAtMs - Date.now()));
      } else if (match.phase === 'playing' && match.endsAtMs != null) {
        setRemainingMs(Math.max(0, match.endsAtMs - Date.now()));
      } else if (match.phase === 'ended') {
        setRemainingMs(0);
      } else {
        setRemainingMs(null);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [match]);

  const join = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kbt_join', name: trimmed }));
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

  const fontClass = `${pressStart.variable} ${doto.variable} ${robotoMono.variable}`;

  if (step === 'live') {
    return (
      <div className={fontClass}>
        <LiveHud
          match={match}
          points={points}
          reps={reps}
          streak={streak}
          exercise={exercise}
          color={me?.color ?? '#FFEB3B'}
          remainingMs={remainingMs}
          flash={flash}
          attachVideo={attachPreview}
          facing={facing}
        />
      </div>
    );
  }

  const meta = STEP_META[step];
  return (
    <div className={fontClass}>
      <PhoneShell
        title='KETTLEBELL TOURNAMENT'
        stepIndex={meta.index}
        stepCount={Object.keys(STEP_META).length}
        stepLabel={meta.label}>
        {step === 'connect' ? (
          <ConnectStep
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
            onContinue={() => setStep('ready')}
          />
        ) : (
          <ReadyStep
            state={kbtState}
            myClientId={myClientId}
            myName={name}
            poseTracked={poseTracked}
            fullBody={fullBody}
            inMyIntro={!!inMyIntro}
            camOn={camOn}
            facing={facing}
            attachVideo={attachPreview}
          />
        )}
      </PhoneShell>
    </div>
  );
}
