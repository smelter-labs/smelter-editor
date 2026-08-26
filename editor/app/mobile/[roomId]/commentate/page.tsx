'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  KbtJoinedEvent,
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
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import { bigShoulders, plexMono } from '@/app/kettlebell-tournament/fonts';
import {
  Bar,
  KBT,
  KbtButton,
  KbtConnectStep,
  KbtPhoneShell,
  KbtStatusStrip,
  Label,
  Tab,
  WarnPlate,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import { NameStep } from '@/components/kettlebell-tournament/phone/name-step';
import { CameraStep } from '@/components/kettlebell-tournament/phone/camera-step';
import { usePreviewSet } from '@/components/kettlebell-tournament/phone/use-preview';
import { useMicLevel } from '@/components/kettlebell-tournament/phone/use-mic-level';
import { usePublishWatchdog } from '@/components/kettlebell-tournament/phone/use-publish-watchdog';
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
const REPUBLISH_MAX_MS = 8000;

/** Per-room resume session — same contract as the lifter page's. */
type CommentatorSession = {
  playerKey?: string;
  name?: string;
  facing?: 'user' | 'environment';
  wantsCam?: boolean;
};

const sessionStorageKey = (roomId: string) => `kbt-commentator-${roomId}`;

function readCommentatorSession(roomId: string): CommentatorSession {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as CommentatorSession)
      : {};
  } catch {
    return {};
  }
}

function remoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const o = window.location.origin;
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(o) ? null : o;
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
  const sessionRef = useRef<CommentatorSession>({});
  const resumeRef = useRef<'no' | 'pending' | 'done'>('no');
  const republishDelayRef = useRef(1000);
  const republishTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  nameRef.current = name;
  facingRef.current = facing;

  const saveSession = useCallback(
    (patch: Partial<CommentatorSession>) => {
      sessionRef.current = { ...sessionRef.current, ...patch };
      try {
        window.localStorage.setItem(
          sessionStorageKey(String(roomId)),
          JSON.stringify(sessionRef.current),
        );
      } catch {
        // Storage blocked — resume just won't survive the next refresh.
      }
    },
    [roomId],
  );

  // Keeps the stream published server-side (ack every 5s, wake lock).
  // Gated on `live` so a dead publish stops acking and the server can see it.
  useWhipHeartbeat(String(roomId), camInputId, camOn && live);

  // ── Camera + mic ──────────────────────────────────────────────────────────

  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);
  const micLevel = useMicLevel(camStreamRef, camOn);
  // Flags a transport that never carries media (e.g. 5G + no TURN).
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
          // The whole point of this role: commentary audio into the mix.
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        camStreamRef.current = stream;
        // iOS revokes tracks on backgrounding — self-heal like a dead publish.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (camStreamRef.current === stream && wantsCamRef.current) {
            scheduleRepublishRef.current?.();
          }
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
        type: 'kbt_commentator_cam_request',
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
    if (ws?.readyState === WebSocket.OPEN) {
      sendCamRequest(ws);
    }
  }, [sendCamRequest]);

  const requestCam = useCallback(() => {
    requestCamSilent();
    saveSession({ wantsCam: true, facing: facingRef.current });
  }, [requestCamSilent, saveSession]);

  const scheduleRepublishRef = useRef<(() => void) | null>(null);

  /** Self-heal a dead publish while the control socket is fine (1s→8s). */
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

  // ── WebSocket ─────────────────────────────────────────────────────────────

  /** Refresh resume, driven by the server's kbt_joined snapshot. */
  const routeResume = useCallback(
    (_event: KbtJoinedEvent) => {
      const sess = sessionRef.current;
      if (sess.wantsCam) {
        wantsCamRef.current = true;
        void enableCamera(sess.facing).then(() => {
          const t = camStreamRef.current?.getVideoTracks()[0];
          if (t && t.readyState === 'live') requestCamSilent();
        });
      }
      // The camera→onair effect advances on its own once the publish is up.
      setStep('camera');
    },
    [enableCamera, requestCamSilent],
  );

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'kbt_state':
          setKbtState(event);
          break;
        case 'kbt_joined': {
          if (event.role !== 'commentator') break;
          wantsJoinRef.current = true;
          saveSession({ playerKey: event.playerKey, name: event.name });
          if (resumeRef.current === 'pending') {
            resumeRef.current = 'done';
            routeResume(event);
          }
          break;
        }
        case 'kbt_error': {
          setNotice(event.message);
          if (noticeTimerRef.current != null) {
            window.clearTimeout(noticeTimerRef.current);
          }
          noticeTimerRef.current = window.setTimeout(
            () => setNotice(null),
            4000,
          );
          break;
        }
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
    [routeResume, saveSession],
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
      // A reconnect minted a fresh clientId: re-join (the playerKey adopts
      // the slot even mid-'connected') and re-arm the cam with a fresh input.
      if (wantsJoinRef.current || resumeRef.current === 'pending') {
        const playerKey = sessionRef.current.playerKey;
        ws.send(
          JSON.stringify({
            type: 'kbt_commentator_join',
            name: nameRef.current.trim() || 'Commentator',
            ...(playerKey ? { playerKey } : {}),
          }),
        );
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
      if (data && typeof data === 'object' && 'type' in data) {
        handleEventRef.current(data as RoomEvent);
      }
    };
  }, [roomId]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    const session = readCommentatorSession(String(roomId));
    sessionRef.current = session;
    if (session.playerKey) resumeRef.current = 'pending';
    setName(session.name ?? window.localStorage.getItem(NAME_KEY) ?? '');
    void getRoomInfo(String(roomId)).then((info) => {
      setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
    });
    // Re-arm after a StrictMode unmount/remount — the cleanup below set the
    // flag, and without the reset auto-reconnect would stay off for good.
    closedByUsRef.current = false;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      camPcRef.current?.close();
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (republishTimerRef.current != null) {
        window.clearTimeout(republishTimerRef.current);
        republishTimerRef.current = null;
      }
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep('name');
    }
  }, [step, connected, roomStatus]);

  // Legacy name-only resume, kept for phones with no per-room session yet:
  // if the stored name already holds the commentator slot, re-join and skip
  // to the camera rig. The playerKey path (routeResume) does the rest.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (
      resumedRef.current ||
      resumeRef.current !== 'no' ||
      step !== 'name' ||
      !kbtState
    )
      return;
    resumedRef.current = true;
    const stored = nameRef.current.trim();
    if (!stored || kbtState.commentator?.name !== stored) return;
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kbt_commentator_join', name: stored }));
    }
    setStep('camera');
  }, [step, kbtState]);

  // Camera step's CONTINUE lands on the on-air screen.
  useEffect(() => {
    if (step === 'camera' && live) setStep('onair');
  }, [step, live]);

  const join = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) return;
    window.localStorage.setItem(NAME_KEY, trimmed);
    saveSession({ name: trimmed });
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const playerKey = sessionRef.current.playerKey;
      ws.send(
        JSON.stringify({
          type: 'kbt_commentator_join',
          name: trimmed,
          ...(playerKey ? { playerKey } : {}),
        }),
      );
    }
    setStep('camera');
  }, [saveSession]);

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

  const statusStrip =
    step === 'connect' ? null : !connected ? (
      <KbtStatusStrip text='RECONNECTING…' />
    ) : notice ? (
      <KbtStatusStrip text={notice} />
    ) : camOn && !live && wantsCamRef.current ? (
      <KbtStatusStrip text='RESTORING VIDEO…' />
    ) : null;

  return (
    <div className={fontClass}>
      {statusStrip}
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
          <NameStep
            name={name}
            onName={setName}
            onContinue={join}
            variant='commentator'
          />
        ) : step === 'camera' ? (
          <CameraStep
            camOn={camOn}
            camErr={camErr}
            facing={facing}
            cameraView='front' // commentators always face their phone
            publishing={publishing}
            live={live}
            attachVideo={attachPreview}
            onEnable={() => void enableCamera()}
            onFlip={flipCamera}
            onGoLive={requestCam}
            onContinue={() => setStep('onair')}
            variant='commentator-phone'
            micLevel={camOn ? micLevel : null}
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
                alignSelf: 'stretch',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 14,
              }}>
              <Label size={9} tracking={2}>
                MIC
              </Label>
              {muted ? (
                <Label size={9} tracking={2} color={KBT.bad}>
                  MUTED
                </Label>
              ) : (
                <Bar
                  value={micLevel}
                  max={1}
                  color={micLevel > 0.03 ? KBT.good : KBT.amber}
                  style={{ flex: 1 }}
                />
              )}
            </div>
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
            {camErr ? <WarnPlate>{camErr}</WarnPlate> : null}
            <KbtButton
              variant={muted ? 'danger' : 'outline'}
              label={muted ? 'MIC MUTED — UNMUTE' : 'MUTE MIC'}
              active={muted}
              onClick={toggleMute}
            />
          </div>
        )}
      </KbtPhoneShell>
    </div>
  );
}
