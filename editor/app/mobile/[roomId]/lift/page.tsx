'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  KbtJoinedEvent,
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
  remoteOrigin,
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import { bigShoulders, plexMono } from '@/app/kettlebell-tournament/fonts';
import {
  KBT,
  KbtConnectStep,
  KbtPhoneShell,
  KbtStatusStrip,
} from '@/components/kettlebell-tournament/kbt-kit';
import { NameStep } from '@/components/kettlebell-tournament/phone/name-step';
import { PhotoStep } from '@/components/kettlebell-tournament/phone/photo-step';
import { CameraStep } from '@/components/kettlebell-tournament/phone/camera-step';
import {
  createFileCamera,
  type FileCamera,
} from '@/components/kettlebell-tournament/phone/file-camera';
import { ReadyStep } from '@/components/kettlebell-tournament/phone/ready-step';
import { usePreviewSet } from '@/components/kettlebell-tournament/phone/use-preview';
import { usePublishWatchdog } from '@/components/kettlebell-tournament/phone/use-publish-watchdog';
import { LiveHud } from '@/components/kettlebell-tournament/phone/live-hud';
import {
  HeatReport,
  type KbtRepLogEntry,
} from '@/components/kettlebell-tournament/phone/heat-report';
import '@/components/kettlebell-tournament/kbt-kit.css';

// The lifter wizard: boot → name → photo (optional) → camera rig →
// standing by → the heat → the post-heat report (→ standing by again).
type Step =
  | 'connect'
  | 'name'
  | 'photo'
  | 'camera'
  | 'ready'
  | 'live'
  | 'summary';

const STEP_META: Record<
  Exclude<Step, 'live' | 'summary'>,
  { index: number; label: string }
> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'LIFTER NAME' },
  photo: { index: 2, label: 'YOUR PHOTO' },
  camera: { index: 3, label: 'CAMERA RIG' },
  ready: { index: 4, label: 'STANDING BY' },
};

const NAME_KEY = 'kbt-lifter-name';
const RECONNECT_MAX_MS = 8000;
const REPUBLISH_MAX_MS = 8000;
/** After this many failed republish rounds, stop pretending and ask for a tap. */
const REPUBLISH_STUCK_AFTER = 4;

/**
 * Per-room resume session: everything the wizard needs to put a refreshed
 * phone right back where it was — the server-issued playerKey re-adopts the
 * roster entry, the rest re-arms the camera and re-briefs without a single
 * tap. (The legacy global NAME_KEY stays as a cross-room name prefill.)
 */
type LifterSession = {
  playerKey?: string;
  name?: string;
  facing?: 'user' | 'environment';
  wantsCam?: boolean;
  briefed?: boolean;
  /** Was publishing a recording — the File itself can't survive a refresh,
   * so resume asks for the source again instead of grabbing the camera. */
  usedFile?: boolean;
};

const sessionStorageKey = (roomId: string) => `kbt-lifter-${roomId}`;

function readLifterSession(roomId: string): LifterSession {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as LifterSession)
      : {};
  } catch {
    return {};
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
  const [fileMode, setFileMode] = useState(false);
  const [filePlaying, setFilePlaying] = useState(false);
  const [filePositionMs, setFilePositionMs] = useState(0);
  const [fileDurationMs, setFileDurationMs] = useState(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);
  /** Reactive mirror of wantsCamRef — drives the "RESTORING VIDEO…" strip. */
  const [wantsCam, setWantsCam] = useState(false);

  const [points, setPoints] = useState(0);
  const [reps, setReps] = useState(0);
  const [streak, setStreak] = useState(0);
  const [repLog, setRepLog] = useState<KbtRepLogEntry[]>([]);
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  /** Auto-republish gave up — the strip asks for a tap instead of spinning. */
  const [publishStuck, setPublishStuck] = useState(false);
  /** Resumed a file-mode session: the recording is gone, ask for it again. */
  const [needsSource, setNeedsSource] = useState(false);
  /** Resume re-armed everything without a gesture, so beeps are still locked. */
  const [audioLocked, setAudioLocked] = useState(false);
  /** A kbt_error from the server, shown for a few seconds. */
  const [notice, setNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const wantsBriefedRef = useRef(false);
  const sessionRef = useRef<LifterSession>({});
  /** 'pending' = stored session found, resume routing runs on kbt_joined. */
  const resumeRef = useRef<'no' | 'pending' | 'done'>('no');
  const republishDelayRef = useRef(1000);
  const republishTimerRef = useRef<number | null>(null);
  const republishAttemptsRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const nameRef = useRef('');
  const facingRef = useRef<'user' | 'environment'>('user');
  const myClientIdRef = useRef<string | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const fileCamRef = useRef<FileCamera | null>(null);
  /** Hidden picker behind the status-strip "pick your recording" tap. */
  const stripFileRef = useRef<HTMLInputElement>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  /** Real cameras publish H.264 (hardware-encoded everywhere). File mode
   * publishes VP8: some phone hardware H.264 encoders silently refuse
   * captured (non-camera) tracks — frames never encode though ICE connects —
   * while the software VP8 encoder takes them on every platform. */
  const camCodecRef = useRef<'h264' | 'vp8'>('h264');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stepRef = useRef<Step>('connect');
  stepRef.current = step;
  nameRef.current = name;
  facingRef.current = facing;
  myClientIdRef.current = myClientId;

  const saveSession = useCallback(
    (patch: Partial<LifterSession>) => {
      sessionRef.current = { ...sessionRef.current, ...patch };
      try {
        window.localStorage.setItem(
          sessionStorageKey(String(roomId)),
          JSON.stringify(sessionRef.current),
        );
      } catch {
        // Storage full/blocked — resume just won't survive the next refresh.
      }
    },
    [roomId],
  );

  // Keeps the camera stream published server-side (ack every 5s, wake lock).
  // Gated on `live` so a dead publish stops acking and the server can see it.
  useWhipHeartbeat(String(roomId), camInputId, camOn && live);

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

  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);

  const enableCamera = useCallback(
    async (nextFacing?: 'user' | 'environment') => {
      const facingMode = nextFacing ?? facingRef.current;
      try {
        fileCamRef.current?.dispose();
        fileCamRef.current = null;
        setFileMode(false);
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
        camCodecRef.current = 'h264'; // real cameras always H.264-encode fine
        // iOS revokes camera tracks on backgrounding/interruptions — treat a
        // dead track like a dead publish and let the self-heal loop re-acquire.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (camStreamRef.current === stream && wantsCamRef.current) {
            scheduleRepublishRef.current?.();
          }
        });
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setNeedsSource(false);
        saveSession({ usedFile: false });
        if (nextFacing) setFacing(nextFacing);
      } catch {
        setCamErr(
          'CAMERA BLOCKED — allow camera access for this site (HTTPS required) and try again.',
        );
        setCamOn(false);
      }
    },
    [saveSession, syncPreviews],
  );

  const flipCamera = useCallback(() => {
    void enableCamera(facingRef.current === 'user' ? 'environment' : 'user');
  }, [enableCamera]);

  // A recorded clip instead of a live camera — same publish path from here on.
  const enableFileCamera = useCallback(
    async (file: File) => {
      try {
        fileCamRef.current?.dispose();
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const cam = await createFileCamera(file);
        fileCamRef.current = cam;
        camStreamRef.current = cam.stream;
        camCodecRef.current = 'vp8';
        cam.video.addEventListener('play', () => setFilePlaying(true));
        cam.video.addEventListener('pause', () => setFilePlaying(false));
        // Position/duration feed the live-HUD scrubber. `timeupdate` fires
        // ~4 Hz — plenty for a 6px progress bar.
        const syncDuration = () =>
          setFileDurationMs(
            Number.isFinite(cam.video.duration) ? cam.video.duration * 1000 : 0,
          );
        cam.video.addEventListener('timeupdate', () =>
          setFilePositionMs(cam.video.currentTime * 1000),
        );
        cam.video.addEventListener('durationchange', syncDuration);
        syncDuration();
        setFilePositionMs(cam.video.currentTime * 1000);
        setFilePlaying(!cam.video.paused);
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setFileMode(true);
        setNeedsSource(false);
        saveSession({ usedFile: true });
        // Recordings aren't selfies: skip the 'user'-facing mirror transform.
        setFacing('environment');
      } catch {
        setCamErr('COULD NOT PLAY THAT FILE — try an .mp4 (H.264).');
      }
    },
    [saveSession, syncPreviews],
  );

  // Includes the ACTUAL track dimensions so the server registers the input
  // with its true aspect (portrait cams were cover-cropped without them).
  const sendCamRequest = useCallback((ws: WebSocket) => {
    const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    // Captured (file/canvas) tracks can report 0×0 before frames flow — fall
    // back to the file's decoded dimensions.
    const width = settings?.width || fileCamRef.current?.width;
    const height = settings?.height || fileCamRef.current?.height;
    ws.send(
      JSON.stringify({
        type: 'kbt_cam_request',
        ...(width && height
          ? { nativeWidth: width, nativeHeight: height }
          : {}),
      }),
    );
  }, []);

  const sendCamRequestRef = useRef(sendCamRequest);
  sendCamRequestRef.current = sendCamRequest;

  /** Ask for a fresh publish slot without assuming a user gesture. */
  const requestCamSilent = useCallback(() => {
    wantsCamRef.current = true;
    setWantsCam(true);
    setPublishing(true);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      sendCamRequest(ws);
    }
  }, [sendCamRequest]);

  const requestCam = useCallback(() => {
    requestCamSilent();
    saveSession({ wantsCam: true, facing: facingRef.current });
    // Unlock audio on this user gesture (iOS) for later rep beeps.
    beep('good');
    setAudioLocked(false);
  }, [beep, requestCamSilent, saveSession]);

  const scheduleRepublishRef = useRef<(() => void) | null>(null);

  /**
   * Self-heal a dead publish while the control socket is fine: back off
   * 1s→8s, re-acquire the camera if its track died with the phone being
   * backgrounded, then re-request a slot (the server retires the old input
   * and mints a fresh one — the same path a reconnect uses).
   */
  const scheduleRepublish = useCallback(() => {
    if (!wantsCamRef.current || closedByUsRef.current) return;
    if (republishTimerRef.current != null) return;
    setLive(false);
    const delay = republishDelayRef.current;
    republishDelayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    republishAttemptsRef.current += 1;
    if (republishAttemptsRef.current > REPUBLISH_STUCK_AFTER) {
      setPublishStuck(true);
    }
    republishTimerRef.current = window.setTimeout(() => {
      republishTimerRef.current = null;
      if (!wantsCamRef.current || camPcRef.current != null) return;
      const track = camStreamRef.current?.getVideoTracks()[0];
      const streamDead = !track || track.readyState === 'ended';
      const fire = () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          requestCamSilent();
        } else {
          // WS is down too — its own reconnect replays the cam request, but
          // keep this loop alive in case that path lost the race.
          scheduleRepublishRef.current?.();
        }
      };
      if (streamDead && !fileCamRef.current) {
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

  // Tell the server we reached the briefing — begin_heat is gated on it.
  const goToBriefing = useCallback(() => {
    wantsBriefedRef.current = true;
    saveSession({ briefed: true });
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kbt_briefed' }));
    }
    setStep('ready');
  }, [saveSession]);

  // Pause/resume the looping recording — the published stream freezes on the
  // paused frame, so a lifter can hold the clip until their heat begins.
  const toggleFilePlayback = useCallback(() => {
    const v = fileCamRef.current?.video;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const restartFile = useCallback(() => {
    const v = fileCamRef.current?.video;
    if (!v) return;
    v.currentTime = 0;
    void v.play();
  }, []);

  const seekFile = useCallback((ms: number) => {
    const v = fileCamRef.current?.video;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    // Stop a hair short of the end: `loop` would snap an end-seek back to 0.
    const t = Math.min(Math.max(0, ms / 1000), Math.max(0, v.duration - 0.05));
    v.currentTime = t;
    // While paused no timeupdate fires — reflect the scrub immediately.
    setFilePositionMs(t * 1000);
  }, []);

  // ── Source swap (camera ↔ recording), including mid-publish ──────────────

  /** Republish the freshly-swapped source; before the first GO LIVE the
   * wizard's explicit button stays the one publish trigger. */
  const swapPublish = useCallback(() => {
    if (!wantsCamRef.current) return;
    republishAttemptsRef.current = 0;
    republishDelayRef.current = 1000;
    setPublishStuck(false);
    requestCam();
  }, [requestCam]);

  const swapToFile = useCallback(
    async (file: File) => {
      await enableFileCamera(file);
      // Track state, not fileCamRef — a failed re-pick leaves the ref on the
      // disposed cam, but its tracks report 'ended'.
      const t = camStreamRef.current?.getVideoTracks()[0];
      if (t?.readyState === 'live') swapPublish();
    },
    [enableFileCamera, swapPublish],
  );

  const swapToCamera = useCallback(async () => {
    await enableCamera();
    const t = camStreamRef.current?.getVideoTracks()[0];
    if (t?.readyState === 'live') swapPublish();
  }, [enableCamera, swapPublish]);

  // Publish watchdog: send fps in file mode + the NO MEDIA PATH diagnostic.
  const sendFps = usePublishWatchdog(live, camPcRef, setCamErr);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  /**
   * Refresh resume, driven by the server's kbt_joined snapshot: re-assert the
   * briefing, re-arm the camera (getUserMedia needs no gesture once the
   * permission is granted) and land on the step the tournament is actually
   * at — including straight back onto the live HUD mid-heat.
   */
  const routeResume = useCallback(
    (event: KbtJoinedEvent) => {
      const sess = sessionRef.current;
      const ws = wsRef.current;
      if (sess.briefed) {
        wantsBriefedRef.current = true;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'kbt_briefed' }));
        }
      }
      if (sess.wantsCam) {
        wantsCamRef.current = true;
        setWantsCam(true);
        // No gesture happened, so the AudioContext is still locked — surface
        // a "tap for sound" chip instead of silently losing rep beeps.
        setAudioLocked(true);
        if (sess.usedFile) {
          // The picked File can't survive a refresh — don't silently move the
          // lifter onto the live camera; ask for the source again. With
          // wantsCam armed, the first pick republishes on its own.
          setNeedsSource(true);
        } else {
          void enableCamera(sess.facing).then(() => {
            const t = camStreamRef.current?.getVideoTracks()[0];
            if (t && t.readyState === 'live') requestCamSilent();
          });
        }
      }
      const heatLive =
        event.inCurrentHeat &&
        (event.heatPhase === 'countdown' || event.heatPhase === 'playing');
      if (heatLive) {
        setStreak(0);
        setStep('live');
      } else if (sess.briefed) {
        setStep('ready');
      } else if (sess.wantsCam || event.camInputActive || event.photoUrl) {
        setStep('camera');
      } else {
        setStep('photo');
      }
    },
    [enableCamera, requestCamSilent],
  );

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      // Strict: until kbt_joined names us, no event is "mine" — a phone that
      // hasn't identified must not flash/beep on other lifters' reps.
      const mine = (clientId: string) => clientId === myClientIdRef.current;
      switch (event.type) {
        case 'kbt_state':
          setKbtState(event);
          break;
        case 'kbt_joined': {
          if (event.role === 'commentator') break;
          setMyClientId(event.clientId);
          myClientIdRef.current = event.clientId;
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
              // The publish died on its own (network glitch, backgrounding)
              // while the control socket may be fine — self-heal.
              camPcRef.current = null;
              setLive(false);
              scheduleRepublishRef.current?.();
            },
            facingRef.current,
            false,
            camStreamRef.current,
            camCodecRef.current,
          )
            .then(() => {
              setLive(true);
              setPublishing(false);
              setCamErr(null);
              republishDelayRef.current = 1000;
              republishAttemptsRef.current = 0;
              setPublishStuck(false);
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
          setRepLog((log) => [
            ...log,
            {
              repIndex: event.repIndex,
              exercise: event.exercise,
              verdict: event.verdict,
              issues: event.issues,
              points: event.points,
            },
          ]);
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
    [beep, routeResume, saveSession],
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
      // A reconnect minted a fresh clientId server-side: re-join — the stored
      // playerKey re-adopts our entry (scores, heat slot) even when the old
      // socket hasn't closed yet; a stored session also auto-joins after a
      // hard refresh (kbt_joined then routes the wizard).
      if (wantsJoinRef.current || resumeRef.current === 'pending') {
        const playerKey = sessionRef.current.playerKey;
        ws.send(
          JSON.stringify({
            type: 'kbt_join',
            name: nameRef.current.trim() || 'Lifter',
            ...(playerKey ? { playerKey } : {}),
          }),
        );
        setMyClientId(null);
        myClientIdRef.current = null;
        if (wantsCamRef.current && camStreamRef.current) {
          if (republishTimerRef.current != null) {
            window.clearTimeout(republishTimerRef.current);
            republishTimerRef.current = null;
          }
          sendCamRequestRef.current(ws);
        }
        // The server cleared `briefed` on the disconnect — restore it so the
        // heat gate doesn't stay blocked on a phone that merely blipped.
        if (wantsBriefedRef.current) {
          ws.send(JSON.stringify({ type: 'kbt_briefed' }));
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
    const session = readLifterSession(String(roomId));
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
      fileCamRef.current?.dispose();
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

  // Boot auto-advance once the room + uplink check out.
  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep('name');
    }
  }, [step, connected, roomStatus]);

  // Legacy name-only resume, kept as a fallback for phones with a stored
  // name but no per-room session (first visit since the playerKey shipped):
  // if the stored name is already on the roster, re-join and skip the steps
  // the server can vouch for. The playerKey path (routeResume) handles
  // everything else, camera and briefing included.
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
    const mine = stored
      ? kbtState.players.find((p) => p.name === stored)
      : undefined;
    if (!mine) return; // fresh visitor (or reset room): normal wizard
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'kbt_join', name: stored }));
    }
    setStep(mine.photoUrl ? 'camera' : 'photo');
  }, [step, kbtState]);

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
      (stepRef.current === 'ready' || stepRef.current === 'summary')
    ) {
      setStreak(0);
      setStep('live');
    }
    if (match.phase === 'ended' && stepRef.current === 'live') {
      beep('end');
      if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]);
      // Hold "TIME!" for a beat, then hand the athlete their rep report.
      const t = window.setTimeout(() => {
        if (stepRef.current === 'live') setStep('summary');
      }, 2500);
      return () => window.clearTimeout(t);
    }
  }, [inCurrentHeat, match, beep]);

  // Auto-drive a file recording with the heat: roll it when the 3-2-1 hits
  // zero, freeze it a while after TIME! so the loop doesn't keep replaying
  // on stream. Live cameras are untouched — fileMode only.
  useEffect(() => {
    if (!fileMode || !inCurrentHeat) return;
    const phase = match?.phase;
    const v = fileCamRef.current?.video;
    if (!v) return;
    if (phase === 'playing' && v.paused) {
      void v.play();
    }
    if (phase === 'ended') {
      const t = window.setTimeout(() => {
        const vid = fileCamRef.current?.video;
        if (vid && !vid.paused) vid.pause();
      }, 10_000);
      return () => window.clearTimeout(t);
    }
  }, [fileMode, inCurrentHeat, match?.phase]);

  // Fresh sheet when my heat gets staged — and if the athlete is still
  // reading the last report, pull them back to the pose-check screen.
  useEffect(() => {
    if (inMyIntro) {
      setPoints(0);
      setReps(0);
      setStreak(0);
      setRepLog([]);
      if (stepRef.current === 'summary') setStep('ready');
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
    saveSession({ name: trimmed });
    wantsJoinRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const playerKey = sessionRef.current.playerKey;
      ws.send(
        JSON.stringify({
          type: 'kbt_join',
          name: trimmed,
          ...(playerKey ? { playerKey } : {}),
        }),
      );
    }
    setStep('photo');
  }, [saveSession]);

  // Upload goes straight to the fastify base (same resolution as the WS URL —
  // the Next server isn't necessarily reachable from the phone). A 404 can
  // just mean our kbt_join is still in flight, so retry once after a beat.
  const uploadPhoto = useCallback(
    async (blob: Blob) => {
      const base =
        getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        remoteOrigin() ??
        getEffectiveClientServerUrl();
      const url = `${base}/room/${encodeURIComponent(String(roomId))}/kettlebell-tournament/photo`;
      const send = async () => {
        const fd = new FormData();
        fd.append('name', nameRef.current.trim() || 'Lifter');
        // With duplicate names the key pins the photo to the right athlete.
        const playerKey = sessionRef.current.playerKey;
        if (playerKey) fd.append('playerKey', playerKey);
        fd.append('photo', blob, 'photo.jpg');
        return fetch(url, { method: 'POST', body: fd });
      };
      let res = await send();
      if (res.status === 404) {
        await new Promise((r) => window.setTimeout(r, 500));
        res = await send();
      }
      if (!res.ok) {
        throw new Error('UPLOAD FAILED — check the connection and try again.');
      }
      setStep('camera');
    },
    [roomId],
  );

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

  // One honest strip for whatever is being repaired right now, everywhere
  // past the boot screen (the boot screen has its own status rows).
  const retryPublishNow = () => {
    republishAttemptsRef.current = 0;
    republishDelayRef.current = 1000;
    setPublishStuck(false);
    requestCam();
  };
  const unlockAudio = () => {
    beep('good');
    setAudioLocked(false);
  };
  const statusStrip =
    step === 'connect' ? null : !connected ? (
      <KbtStatusStrip text='RECONNECTING…' />
    ) : notice ? (
      <KbtStatusStrip text={notice} />
    ) : needsSource ? (
      // A refresh dropped the recording — one tap re-picks and republishes.
      // Also pre-empts the "RESTORING VIDEO…" spinner, which would lie here.
      <>
        <input
          ref={stripFileRef}
          type='file'
          accept='video/*'
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // re-picking the same file must re-fire
            if (file) void swapToFile(file);
          }}
        />
        <KbtStatusStrip
          text='VIDEO OFF — TAP TO PICK YOUR RECORDING'
          tone='bad'
          onTap={() => stripFileRef.current?.click()}
        />
      </>
    ) : publishStuck ? (
      <KbtStatusStrip
        text='VIDEO DOWN — TAP TO RETRY'
        tone='bad'
        onTap={retryPublishNow}
      />
    ) : wantsCam && !live ? (
      <KbtStatusStrip text='RESTORING VIDEO…' />
    ) : audioLocked ? (
      <KbtStatusStrip text='TAP FOR SOUND' tone='good' onTap={unlockAudio} />
    ) : null;

  if (step === 'live') {
    return (
      <div className={fontClass}>
        {statusStrip}
        <LiveHud
          match={match}
          points={points}
          reps={reps}
          streak={streak}
          lastRep={repLog[repLog.length - 1] ?? null}
          color={me?.color ?? KBT.amber}
          remainingMs={remainingMs}
          flash={flash}
          attachVideo={attachPreview}
          facing={facing}
          fileMode={fileMode}
          filePlaying={filePlaying}
          filePositionMs={filePositionMs}
          fileDurationMs={fileDurationMs}
          onToggleFile={toggleFilePlayback}
          onRestartFile={restartFile}
          onSeekFile={seekFile}
        />
      </div>
    );
  }

  if (step === 'summary') {
    return (
      <div className={fontClass}>
        {statusStrip}
        <KbtPhoneShell
          title='KETTLEBELL'
          stepIndex={-1}
          stepCount={0}
          stepLabel='HEAT REPORT'>
          <HeatReport
            repLog={repLog}
            points={points}
            onContinue={() => setStep('ready')}
          />
        </KbtPhoneShell>
      </div>
    );
  }

  const meta = STEP_META[step];
  return (
    <div className={fontClass}>
      {statusStrip}
      <KbtPhoneShell
        title='KETTLEBELL'
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
        ) : step === 'photo' ? (
          <PhotoStep
            existingPhoto={!!me?.photoUrl}
            onUpload={uploadPhoto}
            onSkip={() => setStep('camera')}
          />
        ) : step === 'camera' ? (
          <CameraStep
            camOn={camOn}
            camErr={camErr}
            fileMode={fileMode}
            filePlaying={filePlaying}
            onToggleFile={toggleFilePlayback}
            onRestartFile={restartFile}
            sendFps={sendFps}
            facing={facing}
            cameraView={
              kbtState?.config?.cameraView === 'side' ? 'side' : 'front'
            }
            publishing={publishing}
            live={live}
            attachVideo={attachPreview}
            onEnable={() => void enableCamera()}
            onUseFile={(f) => void swapToFile(f)}
            onUseCamera={() => void swapToCamera()}
            onFlip={flipCamera}
            onGoLive={requestCam}
            onContinue={goToBriefing}
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
            live={live}
            publishing={publishing}
            onRetryPublish={retryPublishNow}
            fileMode={fileMode}
            filePlaying={filePlaying}
            sendFps={sendFps}
            onToggleFile={toggleFilePlayback}
            onRestartFile={restartFile}
            needsSource={needsSource}
            onUseFile={(f) => void swapToFile(f)}
            onUseCamera={() => void swapToCamera()}
            facing={facing}
            attachVideo={attachPreview}
          />
        )}
      </KbtPhoneShell>
    </div>
  );
}
