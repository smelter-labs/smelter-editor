'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { ShooterMatchEvent } from '@smelter-editor/types';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  isLoopbackHost,
  toWsUrl,
} from '@/lib/server-url';
import { doto, pressStart, robotoMono } from '@/app/duck-hunter/fonts';
import { PhoneShell, WarnPanel } from '@/components/duck-hunter/phone/phone-shell';
import { ConnectStep } from '@/components/duck-hunter/phone/connect-step';
import { NameStep } from '@/components/duck-hunter/phone/name-step';
import { WeaponStep } from '@/components/duck-hunter/phone/weapon-step';
import {
  CalibrateStep,
  type PracticeTarget,
} from '@/components/duck-hunter/phone/calibrate-step';
import { ReadyStep } from '@/components/duck-hunter/phone/ready-step';
import {
  AmmoRow,
  ControlsRow,
  MatchOverlay,
  PlayTopBar,
} from '@/components/duck-hunter/phone/play-hud';
import {
  AXIS_CFG_KEY,
  DEFAULT_HORIZ,
  DEFAULT_VERT,
  type AxisCfg,
  type AxisSource,
} from '@/components/duck-hunter/phone/axis';
import '@/components/duck-hunter/retro.css';

const AIM_THROTTLE_MS = 25;
// Relative ("gyro-mouse") aiming: the crosshair moves by how much the phone
// rotated, integrated from the gyroscope's angular velocity (rotationRate).
// Using the rate rather than the orientation angles avoids gimbal lock — the
// beta/gamma *angles* freeze when the phone is held upright/sideways (beta ≈
// 90°), but the *rates* stay well-defined. GYRO_GAIN is the screen fraction
// moved per degree of rotation (scaled by the sensitivity slider); the rate
// deadzone ignores hand tremor; the max step clamps per-frame spikes.
const GYRO_GAIN = 0.011;
const GYRO_RATE_DEADZONE_DEG_S = 1.5;
const GYRO_MAX_STEP_DEG = 25;
// Tap detection: short press with little movement counts as a shot.
const TAP_MS = 400;
const TAP_MOVE_PX = 16;

// The guided wizard: boot sequence → call sign → weapon → (gyro) calibration
// → briefing → the hunt. Steps before 'play' render inside PhoneShell.
type Step = 'connect' | 'name' | 'weapon' | 'calibrate' | 'ready' | 'play';

const STEP_META: Record<
  Exclude<Step, 'play'>,
  { index: number; label: string }
> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'CALL SIGN' },
  weapon: { index: 2, label: 'WEAPON SELECT' },
  calibrate: { index: 3, label: 'CALIBRATION' },
  ready: { index: 4, label: 'BRIEFING' },
};

// Practice ducks in the calibration test range (normalized coords, 4:3 box).
const PRACTICE_SPOTS = [
  { x: 0.22, y: 0.3 },
  { x: 0.72, y: 0.24 },
  { x: 0.5, y: 0.62 },
] as const;
const PRACTICE_HIT_RADIUS = 0.11;

function freshPractice(): PracticeTarget[] {
  return PRACTICE_SPOTS.map((s, i) => ({ id: i, x: s.x, y: s.y, hit: false }));
}

type ScoreRow = {
  clientId: string;
  name: string;
  color: string;
  score: number;
};

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [score, setScore] = useState(0);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  // Live room status broadcast by the server (pre-join too): whether a
  // duck-enabled input is up, and the arcade match state.
  const [targetActive, setTargetActive] = useState(false);
  const [match, setMatch] = useState<ShooterMatchEvent | null>(null);
  // This player's own id (learned from server events addressed to us), used to
  // pick our assigned color out of the scoreboard so the phone can show it.
  const [myClientId, setMyClientId] = useState<string | null>(null);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const [localAim, setLocalAim] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [gyroMode, setGyroMode] = useState(false);
  const [gyroWarn, setGyroWarn] = useState<string | null>(null);
  const gyroLiveRef = useRef(false);
  const [wsDbg, setWsDbg] = useState<string>('');
  const [perm, setPerm] = useState<
    'unknown' | 'granted' | 'denied' | 'unsupported' | 'default'
  >('unknown');
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Front-camera stream for the in-game avatar (shown next to the player's
  // name on the broadcast).
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  // Live camera publish (WHIP): the peer connection and the raw camera stream.
  // The stream ref lets the WS message handler read the current camera without
  // a stale closure when the server's `shooter_cam_offer` arrives.
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const whepCloseRef = useRef<(() => void) | null>(null);
  const lastAimSentRef = useRef(0);
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Latest name for the (deferred) join message; set to true once the player
  // has chosen to play, so a late WS open still sends shoot_join.
  const nameRef = useRef('');
  const wantsJoinRef = useRef(false);
  // Motion permission is requested once, from the weapon-select gesture.
  const permRequestedRef = useRef(false);
  // Timestamp (ms) of the last devicemotion sample, to integrate rotationRate.
  const lastMotionTsRef = useRef<number | null>(null);
  // Low-passed gravity vector (device frame) to know which way is "up", so the
  // horizontal aim can follow true yaw (swing left-right) instead of screen roll.
  const gravityRef = useRef<{ x: number; y: number; z: number } | null>(null);
  // Accumulated crosshair position [0,1] (relative aiming integrates into this).
  const smoothRef = useRef({ x: 0.5, y: 0.5 });
  // Per-axis gyro mapping (source + invert + sensitivity), tuned on the
  // calibration screen and persisted. Mirrored to refs for the motion listener.
  const [horizCfg, setHorizCfg] = useState<AxisCfg>(DEFAULT_HORIZ);
  const [vertCfg, setVertCfg] = useState<AxisCfg>(DEFAULT_VERT);
  const horizCfgRef = useRef(horizCfg);
  const vertCfgRef = useRef(vertCfg);
  horizCfgRef.current = horizCfg;
  vertCfgRef.current = vertCfg;
  // Live crosshair position for the calibration test range.
  const [previewAim, setPreviewAim] = useState({ x: 0.5, y: 0.5 });
  const previewAimRef = useRef(previewAim);
  previewAimRef.current = previewAim;
  // Practice ducks in the test range (local only, no server traffic).
  const [practice, setPractice] = useState<PracticeTarget[]>(freshPractice);
  // Opened calibration from the play HUD (⚙) — CONTINUE returns to the hunt.
  const [calibFromPlay, setCalibFromPlay] = useState(false);

  nameRef.current = name;
  // Runtime ammo from the server (magazine size + rounds left are set by the
  // operator) + local reload countdown.
  const [maxAmmo, setMaxAmmo] = useState(3);
  const [ammo, setAmmo] = useState(3);
  const reloadEndsRef = useRef<number | null>(null);
  const [reloadLeftMs, setReloadLeftMs] = useState(0);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
  }, [searchParams]);

  // Load saved axis config once, and persist on change. `firstAxisSaveRef` skips
  // the initial save so the mounted defaults can't overwrite stored settings
  // before the load effect applies them.
  const firstAxisSaveRef = useRef(true);
  useEffect(() => {
    try {
      // Seed the name from the intro's display name, then let a saved shoot
      // name override it.
      const dn = localStorage.getItem('smelter-display-name');
      if (dn) setName(dn);
      const raw = localStorage.getItem(AXIS_CFG_KEY);
      if (raw) {
        const p = JSON.parse(raw) as {
          horiz?: AxisCfg;
          vert?: AxisCfg;
          name?: string;
        };
        if (p.horiz) setHorizCfg({ ...DEFAULT_HORIZ, ...p.horiz });
        if (p.vert) setVertCfg({ ...DEFAULT_VERT, ...p.vert });
        if (typeof p.name === 'string' && p.name) setName(p.name);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);
  useEffect(() => {
    if (firstAxisSaveRef.current) {
      firstAxisSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(
        AXIS_CFG_KEY,
        JSON.stringify({
          horiz: horizCfg,
          vert: vertCfg,
          name,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [horizCfg, vertCfg, name]);

  const recenter = useCallback(() => {
    smoothRef.current = { x: 0.5, y: 0.5 };
    setPreviewAim({ x: 0.5, y: 0.5 });
  }, []);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // Tear down the live-camera WHIP publisher (leaves the local camera preview
  // running; only the outgoing broadcast stream is stopped).
  const stopCamPublish = useCallback(() => {
    camPcRef.current?.close();
    camPcRef.current = null;
  }, []);

  // Camera: toggle the front camera on/off. While playing, turning it on asks
  // the server for a WHIP input (it replies with `shooter_cam_offer`, which we
  // publish into); turning it off tears the publisher down on both ends.
  const toggleCamera = useCallback(async () => {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      setCamStream(null);
      camStreamRef.current = null;
      stopCamPublish();
      send({ type: 'shoot_cam_stop' });
      return;
    }
    setCamErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setCamStream(s);
      camStreamRef.current = s;
      // Before joining, the publish is kicked off by joinAndPlay; while already
      // playing, ask the server to spin up our camera input now.
      if (step === 'play') send({ type: 'shoot_cam_start' });
    } catch {
      setCamErr('Camera access denied — check your browser permissions.');
    }
  }, [camStream, send, step, stopCamPublish]);

  // One <video> element exists per screen (name step preview / play bubble);
  // this ref callback attaches the live camera stream to whichever is mounted.
  const attachCamVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      camVideoRef.current = el;
      if (el && el.srcObject !== camStream) {
        el.srcObject = camStream;
        void el.play().catch(() => {});
      }
    },
    [camStream],
  );

  // Stop the camera + publisher when leaving the page.
  useEffect(() => {
    return () => {
      camStream?.getTracks().forEach((t) => t.stop());
    };
  }, [camStream]);

  // Tick the local reload countdown while playing.
  useEffect(() => {
    if (step !== 'play') return;
    const t = window.setInterval(() => {
      const ends = reloadEndsRef.current;
      setReloadLeftMs(ends == null ? 0 : Math.max(0, ends - performance.now()));
    }, 100);
    return () => window.clearInterval(t);
  }, [step]);

  const sendAim = useCallback(
    (x: number, y: number, immediate = false) => {
      const now = Date.now();
      if (!immediate && now - lastAimSentRef.current < AIM_THROTTLE_MS) return;
      lastAimSentRef.current = now;
      send({ type: 'shoot_aim', x, y });
    },
    [send],
  );

  const fire = useCallback(() => {
    if (ammo <= 0) {
      // Empty mag: click, don't send.
      setFlash('miss');
      if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
      window.setTimeout(() => setFlash(null), 150);
      return;
    }
    setAmmo((a) => Math.max(0, a - 1)); // optimistic; server reconciles
    send({ type: 'shoot_fire' });
  }, [send, ammo]);

  // Test-range FIRE during calibration: hit-test the preview crosshair against
  // the practice ducks (local only — nothing is sent to the server).
  const testFire = useCallback(() => {
    const aim = previewAimRef.current;
    let hitOne = false;
    setPractice((prev) =>
      prev.map((t) => {
        if (t.hit || hitOne) return t;
        // The range box is 4:3 — weigh dy so the hit circle stays round.
        const dx = aim.x - t.x;
        const dy = (aim.y - t.y) * 0.75;
        if (Math.hypot(dx, dy) <= PRACTICE_HIT_RADIUS) {
          hitOne = true;
          return { ...t, hit: true };
        }
        return t;
      }),
    );
    if (navigator.vibrate) navigator.vibrate(hitOne ? 60 : [15, 40, 15]);
  }, []);

  // Map a client point on the output <video> (object-contain) to output-space
  // [0,1], correcting for the letterbox bars around the video content.
  const toOutputNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = videoRef.current;
      const res = room?.resolution;
      if (!el || !res || !('width' in res)) return null;
      const rect = el.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const videoAspect = res.width / res.height;
      const containerAspect = cw / ch;
      let renderW: number;
      let renderH: number;
      let offX: number;
      let offY: number;
      if (containerAspect > videoAspect) {
        renderH = ch;
        renderW = ch * videoAspect;
        offX = (cw - renderW) / 2;
        offY = 0;
      } else {
        renderW = cw;
        renderH = cw / videoAspect;
        offX = 0;
        offY = (ch - renderH) / 2;
      }
      const vx = clamp(clientX - rect.left - offX, 0, renderW);
      const vy = clamp(clientY - rect.top - offY, 0, renderH);
      return { x: vx / renderW, y: vy / renderH };
    },
    [room],
  );

  const localFromClient = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { left: clientX - rect.left, top: clientY - rect.top };
  }, []);

  // Forward map output-space [0,1] -> stage px (for the instant local crosshair
  // in gyro mode), accounting for the object-contain letterbox.
  const normToLocal = useCallback(
    (nx: number, ny: number): { left: number; top: number } | null => {
      const el = videoRef.current;
      const stage = stageRef.current;
      const res = room?.resolution;
      if (!el || !stage || !res || !('width' in res)) return null;
      const rect = el.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const videoAspect = res.width / res.height;
      const containerAspect = cw / ch;
      let renderW: number;
      let renderH: number;
      let offX: number;
      let offY: number;
      if (containerAspect > videoAspect) {
        renderH = ch;
        renderW = ch * videoAspect;
        offX = (cw - renderW) / 2;
        offY = 0;
      } else {
        renderW = cw;
        renderH = cw / videoAspect;
        offX = 0;
        offY = (ch - renderH) / 2;
      }
      return {
        left: rect.left - stageRect.left + offX + nx * renderW,
        top: rect.top - stageRect.top + offY + ny * renderH,
      };
    },
    [room],
  );

  // Touch/mouse aiming directly on the video.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode) return;
      pressRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      const aim = toOutputNorm(e.clientX, e.clientY);
      if (aim) sendAim(aim.x, aim.y, true);
      setLocalAim(localFromClient(e.clientX, e.clientY));
    },
    [gyroMode, toOutputNorm, sendAim, localFromClient],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode || !pressRef.current) return;
      const aim = toOutputNorm(e.clientX, e.clientY);
      if (aim) sendAim(aim.x, aim.y);
      setLocalAim(localFromClient(e.clientX, e.clientY));
    },
    [gyroMode, toOutputNorm, sendAim, localFromClient],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode) return;
      const start = pressRef.current;
      pressRef.current = null;
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      const held = Date.now() - start.t;
      // A quick tap = shoot where you tapped (aim already sent on down/move).
      if (moved < TAP_MOVE_PX && held < TAP_MS) {
        const aim = toOutputNorm(e.clientX, e.clientY);
        if (aim) sendAim(aim.x, aim.y, true);
        fire();
      }
    },
    [gyroMode, toOutputNorm, sendAim, fire],
  );

  // Gyro sensor listener. Active during calibration (drives the test-range
  // crosshair) and during play when gyro mode is on (aims the real one).
  const aiming = step === 'play' && gyroMode;
  useEffect(() => {
    const previewing = step === 'calibrate';
    if (!previewing && !aiming) return;
    gyroLiveRef.current = false;
    smoothRef.current = { x: 0.5, y: 0.5 };
    setPreviewAim({ x: 0.5, y: 0.5 });
    lastMotionTsRef.current = null; // no dt until the first motion sample
    gravityRef.current = null;
    setGyroWarn(null);
    // Relative ("gyro-mouse") aiming from the gyroscope's angular velocity —
    // gimbal-lock-free. Each screen axis is driven by a user-chosen source
    // (yaw/pitch/rateX/Y/Z) with its own invert + sensitivity.
    const onMotion = (e: DeviceMotionEvent) => {
      const rr = e.rotationRate;
      if (!rr || (rr.beta == null && rr.gamma == null && rr.alpha == null))
        return;
      gyroLiveRef.current = true;

      // Track gravity → up direction (device frame). Low-passed to reject the
      // linear-acceleration component of accelerationIncludingGravity.
      const ag = e.accelerationIncludingGravity;
      if (ag && (ag.x != null || ag.y != null || ag.z != null)) {
        const gx = ag.x ?? 0;
        const gy = ag.y ?? 0;
        const gz = ag.z ?? 0;
        const p = gravityRef.current;
        gravityRef.current = p
          ? {
              x: p.x + (gx - p.x) * 0.2,
              y: p.y + (gy - p.y) * 0.2,
              z: p.z + (gz - p.z) * 0.2,
            }
          : { x: gx, y: gy, z: gz };
      }

      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const last = lastMotionTsRef.current;
      lastMotionTsRef.current = now;
      if (last == null) return; // need an interval before integrating
      let dt = (now - last) / 1000;
      if (!(dt > 0) || dt > 0.1) dt = 0.016; // guard against gaps / glitches

      // Angular velocity about device axes (deg/s): X=beta, Y=gamma, Z=alpha.
      const wx = rr.beta ?? 0;
      const wy = rr.gamma ?? 0;
      const wz = rr.alpha ?? 0;
      const { up, right } = screenAxes(screenAngle());
      const g = gravityRef.current;
      const hc = horizCfgRef.current;
      const vc = vertCfgRef.current;
      const hRate =
        sourceRate(hc.source, wx, wy, wz, up, right, g) * (hc.invert ? -1 : 1);
      const vRate =
        sourceRate(vc.source, wx, wy, wz, up, right, g) * (vc.invert ? -1 : 1);

      // Deadzone slow rotation (hand tremor), integrate rate → degrees this frame,
      // clamp to swallow spikes.
      const step2 = (rate: number) =>
        clamp(
          (Math.abs(rate) < GYRO_RATE_DEADZONE_DEG_S ? 0 : rate) * dt,
          -GYRO_MAX_STEP_DEG,
          GYRO_MAX_STEP_DEG,
        );
      const s = smoothRef.current;
      s.x = clamp01(s.x + step2(hRate) * GYRO_GAIN * hc.sens);
      s.y = clamp01(s.y + step2(vRate) * GYRO_GAIN * vc.sens);
      if (aiming) {
        sendAim(s.x, s.y);
        setLocalAim(normToLocal(s.x, s.y));
      } else {
        setPreviewAim({ x: s.x, y: s.y });
      }
    };
    // Liveness probe for the warn timer (some devices only emit orientation).
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta != null || e.gamma != null) gyroLiveRef.current = true;
    };
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('devicemotion', onMotion);
    // If nothing arrives shortly, the sensor is blocked or not permitted.
    const warnTimer = window.setTimeout(() => {
      if (!gyroLiveRef.current) {
        setGyroWarn(
          !window.isSecureContext
            ? 'The gyroscope requires HTTPS.'
            : perm === 'denied'
              ? 'Motion sensor access denied — enable it in your browser settings.'
              : 'No gyroscope data — check motion permissions/settings.',
        );
      }
    }, 1500);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('deviceorientationabsolute', onOrient);
      window.removeEventListener('devicemotion', onMotion);
      window.clearTimeout(warnTimer);
    };
  }, [step, aiming, sendAim, normToLocal, perm]);

  // Volume-up button = shoot (best-effort; Android only). Browsers don't expose
  // hardware volume keys, but while an <audio> element is actively playing,
  // Android routes the hardware volume buttons to THAT element's `.volume` and
  // fires `volumechange`. We keep a looping silent clip playing and treat a
  // volume *increase* as a shot, then snap the volume back to mid so there's
  // always headroom in both directions. (iOS media volume is read-only, so this
  // can't work there; some Android browsers also deliver a keydown, handled too.)
  useEffect(() => {
    if (step !== 'play') return;
    const url = makeSilentWavUrl();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.5;
    let prev = 0.5;
    const onVol = () => {
      const v = audio.volume;
      if (v > prev + 0.001) fire(); // volume up → shoot
      prev = 0.5;
      if (audio.volume !== 0.5) audio.volume = 0.5; // re-arm both directions
    };
    audio.addEventListener('volumechange', onVol);
    void audio.play().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'AudioVolumeUp') {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      audio.pause();
      audio.removeEventListener('volumechange', onVol);
      window.removeEventListener('keydown', onKey);
      URL.revokeObjectURL(url);
    };
  }, [step, fire]);

  const connectWs = useCallback(() => {
    // Explicit `?server=` wins; then the public build-time default (a phone on
    // the static deploy must not try same-origin — Vercel can't proxy WS);
    // same-origin only remains for the tunnel case, where the page's own
    // origin proxies /room to a local backend.
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
      // Observe the room right away (state + match snapshot, no player is
      // created) so the briefing screen knows the marsh status pre-join.
      ws.send(JSON.stringify({ type: 'shoot_spectate' }));
      // Join only once the player has committed (JOIN THE HUNT); handles the
      // case where the socket opens after that tap. On a reconnect the server
      // minted a fresh client, so re-arm the camera input too if it's on.
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'shoot_join',
            name: nameRef.current.trim() || 'Player',
          }),
        );
        if (camStreamRef.current) {
          ws.send(JSON.stringify({ type: 'shoot_cam_start' }));
        }
      }
    };
    ws.onerror = () => setWsDbg(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      setWsDbg(`WS closed (${ev.code}) — ${url}`);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const m = data as { type?: string; clientId?: string };
      // shooter_hit / shooter_ammo are addressed to us and carry our clientId;
      // capture it once so we can resolve our own color from the scoreboard.
      if (m.clientId) setMyClientId((prev) => prev ?? m.clientId!);
      if (m.type === 'shooter_hit') {
        setScore((data as { score: number }).score);
        setFlash('hit');
        if (navigator.vibrate) navigator.vibrate(60);
        window.setTimeout(() => setFlash(null), 220);
      } else if (m.type === 'shooter_miss') {
        setFlash('miss');
        window.setTimeout(() => setFlash(null), 130);
      } else if (m.type === 'shooter_state') {
        const st = data as { players: ScoreRow[]; targetActive?: boolean };
        setScores(st.players ?? []);
        setTargetActive(!!st.targetActive);
      } else if (m.type === 'shooter_match') {
        setMatch(data as ShooterMatchEvent);
      } else if (m.type === 'shooter_ammo') {
        const a = data as {
          ammo: number;
          maxAmmo: number;
          reloadRemainingMs: number;
        };
        setAmmo(a.ammo);
        // Magazine size is set by the operator; adopt it so the shell row
        // matches the server's rules.
        if (typeof a.maxAmmo === 'number') setMaxAmmo(a.maxAmmo);
        reloadEndsRef.current =
          a.reloadRemainingMs > 0
            ? performance.now() + a.reloadRemainingMs
            : null;
      } else if (m.type === 'shooter_empty') {
        setAmmo(0);
        setFlash('miss');
        if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
        window.setTimeout(() => setFlash(null), 150);
      } else if (m.type === 'shooter_cam_offer') {
        // The server registered our camera WHIP input; publish the front camera
        // into it. Read the stream from a ref so this stable handler always sees
        // the current camera. Ignore if the camera was turned off meanwhile.
        const o = data as {
          inputId: string;
          whipUrl: string;
          bearerToken: string;
        };
        const stream = camStreamRef.current;
        if (!stream) return;
        // Fresh session: drop any previous publisher PC first.
        camPcRef.current?.close();
        camPcRef.current = null;
        const whipUrl = resolveMediaUrl(o.whipUrl);
        void startPublish(
          o.inputId,
          o.bearerToken,
          whipUrl,
          camPcRef,
          camStreamRef,
          () => {
            camPcRef.current = null;
          },
          'user',
          false,
          stream,
          'h264',
        ).catch(() => {
          camPcRef.current = null;
        });
      }
    };
  }, [roomId]);

  const fetchRoom = useCallback(() => {
    void getRoomInfo(String(roomId)).then((info) => {
      if (info && info !== 'not-found') {
        setRoom(info);
        setRoomStatus('ok');
      } else {
        setRoomStatus('not-found');
      }
    });
  }, [roomId]);

  // Retry the boot sequence (room lookup + WS uplink) from the connect step.
  const retryConnect = useCallback(() => {
    setWsDbg('');
    wsRef.current?.close();
    if (roomStatus !== 'ok') {
      setRoomStatus('loading');
      fetchRoom();
    }
    connectWs();
  }, [roomStatus, fetchRoom, connectWs]);

  // Weapon select: GYRO CANNON. This tap is the user gesture iOS needs for the
  // motion permission prompt. Denied/unsupported keeps the player on the
  // weapon screen with a plain-words warning.
  const pickGyro = useCallback(async () => {
    permRequestedRef.current = true;
    const res = await requestMotionPermission();
    setPerm(res);
    if (res === 'denied' || res === 'unsupported') {
      setGyroWarn(
        res === 'unsupported'
          ? 'This device has no motion sensors.'
          : !window.isSecureContext
            ? 'The gyroscope requires HTTPS.'
            : 'Motion sensor access denied — enable it in your browser settings.',
      );
      return;
    }
    setGyroWarn(null);
    setGyroMode(true);
    setPractice(freshPractice());
    recenter();
    setStep('calibrate');
  }, [recenter]);

  const pickFinger = useCallback(() => {
    setGyroMode(false);
    setGyroWarn(null);
    setStep('ready');
  }, []);

  // Commit the chosen name and enter the game. Ammo rules come from the server.
  const joinAndPlay = useCallback(() => {
    wantsJoinRef.current = true;
    send({
      type: 'shoot_join',
      name: name.trim() || 'Player',
    });
    // If the player enabled their camera earlier, spin up its live input now
    // that they've joined.
    if (camStreamRef.current) send({ type: 'shoot_cam_start' });
    setStep('play');
  }, [send, name]);

  // Connect + fetch room info on mount; the boot step visualizes both.
  useEffect(() => {
    fetchRoom();
    connectWs();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [fetchRoom, connectWs]);

  // Boot step auto-advances once the room resolved and the radio is up.
  useEffect(() => {
    if (step !== 'connect' || roomStatus !== 'ok' || !connected) return;
    const t = window.setTimeout(
      () => setStep((s) => (s === 'connect' ? 'name' : s)),
      600,
    );
    return () => window.clearTimeout(t);
  }, [step, roomStatus, connected]);

  // Establish the WHEP output stream once we have the room's whepUrl.
  useEffect(() => {
    if (step !== 'play' || !room?.whepUrl) return;
    let cancelled = false;
    const whepUrl = resolveMediaUrl(room.whepUrl);
    void connectWhep(whepUrl)
      .then((conn) => {
        if (cancelled) {
          conn.close();
          return;
        }
        whepCloseRef.current = conn.close;
        setStream(conn.stream);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      whepCloseRef.current?.();
      whepCloseRef.current = null;
      setStream(null);
    };
  }, [step, room?.whepUrl]);

  // Attach the stream whenever it (or the video element) changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream, step]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      send({ type: 'shoot_leave' });
      camPcRef.current?.close();
      camPcRef.current = null;
      wsRef.current?.close();
      whepCloseRef.current?.();
    };
  }, [send]);

  const fontClass = `${pressStart.variable} ${doto.variable} ${robotoMono.variable}`;

  // ---- Wizard screens -----------------------------------------------------

  if (step !== 'play') {
    const meta = STEP_META[step];
    return (
      <div className={fontClass}>
        <PhoneShell
          stepIndex={meta.index}
          stepCount={5}
          stepLabel={meta.label}>
          {step === 'connect' ? (
            <ConnectStep
              roomStatus={roomStatus}
              wsConnected={connected}
              wsError={wsDbg}
              onRetry={retryConnect}
            />
          ) : null}
          {step === 'name' ? (
            <NameStep
              name={name}
              onName={setName}
              camOn={!!camStream}
              camErr={camErr}
              onToggleCamera={() => void toggleCamera()}
              attachCamVideo={attachCamVideo}
              onContinue={() => setStep('weapon')}
            />
          ) : null}
          {step === 'weapon' ? (
            <WeaponStep
              onGyro={() => void pickGyro()}
              onFinger={pickFinger}
              warn={gyroWarn}
            />
          ) : null}
          {step === 'calibrate' ? (
            <CalibrateStep
              previewAim={previewAim}
              targets={practice}
              onTestFire={testFire}
              onRecenter={recenter}
              horizCfg={horizCfg}
              vertCfg={vertCfg}
              onHoriz={setHorizCfg}
              onVert={setVertCfg}
              warn={gyroWarn}
              returnToPlay={calibFromPlay}
              onContinue={() => {
                recenter();
                if (calibFromPlay) {
                  setCalibFromPlay(false);
                  setStep('play');
                } else {
                  setStep('ready');
                }
              }}
            />
          ) : null}
          {step === 'ready' ? (
            <ReadyStep
              name={name}
              gyroMode={gyroMode}
              camOn={!!camStream}
              targetActive={targetActive}
              playersCount={scores.length}
              match={match}
              onJoin={joinAndPlay}
              onBack={() => setStep('weapon')}
            />
          ) : null}
        </PhoneShell>
      </div>
    );
  }

  // ---- The hunt -----------------------------------------------------------

  // Our assigned color (from the scoreboard, matched on our clientId); falls
  // back to the default cyan until the server has told us who we are.
  const myColor =
    scores.find((s) => s.clientId === myClientId)?.color ?? '#00f3ff';

  return (
    <div
      className={`${fontClass} fixed inset-0 bg-black text-white flex flex-col select-none`}>
      {/* Live output + finger aiming surface. */}
      <div
        ref={stageRef}
        className='relative flex-1 touch-none overflow-hidden'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pressRef.current = null)}>
        <video
          ref={videoRef}
          className='w-full h-full object-contain bg-black pointer-events-none'
          autoPlay
          playsInline
          muted
        />

        {/* Instant local crosshair (server crosshair on the video lags via WHEP). */}
        {localAim && (
          <div
            className='absolute pointer-events-none'
            style={{
              left: localAim.left - 18,
              top: localAim.top - 18,
              width: 36,
              height: 36,
            }}>
            <div
              className='absolute inset-0 rounded-full border-2'
              style={{ borderColor: myColor }}
            />
            <div
              className='absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2'
              style={{ backgroundColor: myColor }}
            />
            <div
              className='absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2'
              style={{ backgroundColor: myColor }}
            />
          </div>
        )}

        {/* Flash feedback overlay. */}
        {flash && (
          <div
            className={`absolute inset-0 pointer-events-none ${
              flash === 'hit' ? 'bg-green-500/30' : 'bg-red-600/25'
            }`}
          />
        )}

        <PlayTopBar
          connected={connected}
          match={match}
          score={score}
          myColor={myColor}
          scores={scores}
        />

        {!connected && wsDbg && (
          <div className='absolute top-16 left-2 right-2 z-10'>
            <WarnPanel>
              <span style={{ wordBreak: 'break-all' }}>{wsDbg}</span>
            </WarnPanel>
          </div>
        )}
        {gyroMode && gyroWarn && (
          <div className='absolute bottom-2 left-2 right-2 z-10 pointer-events-none'>
            <WarnPanel>{gyroWarn}</WarnPanel>
          </div>
        )}

        {/* Self view: the camera being shared next to your name. */}
        {camStream && (
          <video
            ref={attachCamVideo}
            autoPlay
            playsInline
            muted
            className='absolute bottom-2 right-2 w-16 h-16 rounded-full object-cover border-2 -scale-x-100 pointer-events-none'
            style={{ borderColor: myColor }}
          />
        )}

        {/* Countdown / game-over overlays from the arcade match. */}
        <MatchOverlay match={match} myClientId={myClientId} />
      </div>

      <AmmoRow ammo={ammo} maxAmmo={maxAmmo} reloadLeftMs={reloadLeftMs} />
      <ControlsRow
        gyroMode={gyroMode}
        onToggleMode={() => {
          if (gyroMode) {
            setGyroMode(false);
            return;
          }
          // Request iOS motion permission from this user gesture.
          void requestMotionPermission().then((res) => {
            setPerm(res);
            setGyroWarn(null);
            setGyroMode(true);
          });
        }}
        onRecenter={recenter}
        onAxes={() => {
          setCalibFromPlay(true);
          setPractice(freshPractice());
          setStep('calibrate');
        }}
        camOn={!!camStream}
        onToggleCamera={() => void toggleCamera()}
        ammo={ammo}
        onFire={fire}
      />
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Build a short looping silent WAV (8-bit mono) as a blob URL. Playing it keeps
// an <audio> element in the "playing" state so Android routes hardware volume
// buttons to its `.volume` — see the volume-up-as-shoot effect above.
function makeSilentWavUrl(): string {
  const sampleRate = 8000;
  const n = sampleRate * 2; // 2 s of silence, looped
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const wr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  wr(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  dv.setUint16(32, 1, true); // block align
  dv.setUint16(34, 8, true); // bits per sample
  wr(36, 'data');
  dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128); // 8-bit silence = 128
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// iOS 13+ gates the motion sensors behind a permission prompt that must be
// triggered from a user gesture. Aiming needs DeviceMotion (rotationRate); on
// iOS DeviceMotion and DeviceOrientation share a single "Motion & Orientation"
// permission, so requesting either unlocks both events. Prefer the motion
// request. Android/desktop need no prompt.
type PermRequester = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

async function requestMotionPermission(): Promise<
  'granted' | 'denied' | 'unsupported' | 'default'
> {
  if (typeof window === 'undefined') return 'unsupported';
  const candidates: Array<PermRequester | undefined> = [
    (window as unknown as { DeviceMotionEvent?: PermRequester })
      .DeviceMotionEvent,
    window.DeviceOrientationEvent as unknown as PermRequester | undefined,
  ];
  for (const c of candidates) {
    if (c && typeof c.requestPermission === 'function') {
      try {
        const res = await c.requestPermission();
        return res === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    }
  }
  return typeof window.DeviceOrientationEvent === 'undefined'
    ? 'unsupported'
    : 'default';
}

// Current screen rotation in degrees (0/90/180/270). beta/gamma are always
// reported in the device's natural (portrait) frame, so when the phone is held
// sideways we rotate the tilt into screen space to keep aiming screen-relative.
// screen.orientation.angle is the standardized source; window.orientation
// (older iOS) reports the opposite sign for landscape, so we invert it.
function screenAngle(): number {
  if (typeof window === 'undefined') return 0;
  const so = window.screen?.orientation;
  if (so && typeof so.angle === 'number') return ((so.angle % 360) + 360) % 360;
  const wo = (window as unknown as { orientation?: number }).orientation;
  if (typeof wo === 'number') return (360 - (((wo % 360) + 360) % 360)) % 360;
  return 0;
}

// Device-frame unit vectors (screen plane, z = 0) for the screen's "up" and
// "right" directions at a given screen rotation. X = device short-edge (right in
// portrait), Y = device long-edge (up in portrait). Lets us pick which gyro axes
// map to on-screen vertical/horizontal in any orientation.
function screenAxes(angle: number): {
  up: [number, number];
  right: [number, number];
} {
  switch (angle) {
    case 90:
      return { up: [1, 0], right: [0, -1] };
    case 180:
      return { up: [0, -1], right: [-1, 0] };
    case 270:
      return { up: [-1, 0], right: [0, 1] };
    default: // 0 — portrait
      return { up: [0, 1], right: [1, 0] };
  }
}

// Angular velocity (deg/s) for a chosen aim source, from one motion sample.
// wx/wy/wz = rotation rate about device X/Y/Z (beta/gamma/alpha); up/right are
// the screen's axes in the device frame; grav is the (low-passed) gravity vector.
function sourceRate(
  source: AxisSource,
  wx: number,
  wy: number,
  wz: number,
  up: [number, number],
  right: [number, number],
  grav: { x: number; y: number; z: number } | null,
): number {
  switch (source) {
    case 'rateX':
      return wx;
    case 'rateY':
      return wy;
    case 'rateZ':
      return wz;
    case 'pitch':
      return wx * right[0] + wy * right[1];
    case 'yaw':
    default: {
      // Yaw about true world-up (ω·û), û = -gravity/|g|. Falls back to rotation
      // about the screen's up axis when gravity isn't available.
      if (grav) {
        const m = Math.hypot(grav.x, grav.y, grav.z);
        if (m > 1) return -(wx * grav.x + wy * grav.y + wz * grav.z) / m;
      }
      return wx * up[0] + wy * up[1];
    }
  }
}

// When the page is served from a remote origin (a tunnel/proxy), route the WS
// and WHEP to that SAME origin so there is no cross-origin CORS or mixed
// content — the proxy forwards /room and /whep to the backend services.
// On localhost we keep the configured server URL (editor and server differ).
function remoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const o = window.location.origin;
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(o) ? null : o;
}

// Media endpoints (WHIP/WHEP) come from the server, which may only know its
// loopback address. When such a URL would be unreachable from the phone, graft
// its path onto the explicit `?server=` base (which may include a proxy path
// prefix) or, failing that, onto this page's own origin. URLs that are already
// public (e.g. an instance behind nginx) pass through untouched.
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
