'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

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

// A selectable gyro signal for an aim axis. The user picks which one drives
// horizontal vs vertical on the calibration screen (with invert + per-axis
// sensitivity), since auto-mapping can't know how they physically hold the phone.
//  - yaw:   rotation about world-up (swing/pan left-right), gravity-referenced
//  - pitch: rotation about the screen's right axis (nod up-down)
//  - rateX/Y/Z: raw gyro rate about device X (beta) / Y (gamma) / Z (alpha)
type AxisSource = 'yaw' | 'pitch' | 'rateX' | 'rateY' | 'rateZ';
type AxisCfg = { source: AxisSource; invert: boolean; sens: number };

const AXIS_OPTIONS: { id: AxisSource; label: string }[] = [
  { id: 'yaw', label: 'Horizontal rotation — yaw (world)' },
  { id: 'pitch', label: 'Tilt — pitch (screen)' },
  { id: 'rateX', label: 'X axis — beta' },
  { id: 'rateY', label: 'Y axis — gamma' },
  { id: 'rateZ', label: 'Screen rotation — alpha' },
];
const DEFAULT_HORIZ: AxisCfg = { source: 'yaw', invert: false, sens: 1 };
const DEFAULT_VERT: AxisCfg = { source: 'pitch', invert: false, sens: 1 };
const AXIS_CFG_KEY = 'shootAxisCfg';

type ScoreRow = {
  clientId: string;
  name: string;
  color: string;
  score: number;
};
type Rect = { left: number; top: number; width: number; height: number };

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [stage, setStage] = useState<'calibrate' | 'play'>('calibrate');
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [score, setScore] = useState(0);
  const [scores, setScores] = useState<ScoreRow[]>([]);
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
  const [orient, setOrient] = useState<{
    b: number | null;
    g: number | null;
    n: number;
  }>({ b: null, g: null, n: 0 });
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Front-camera stream for the in-game avatar (shown next to the player's
  // name on the broadcast). Snapshots are sent over the WS while playing.
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
  // Motion permission is requested once, from the first calibration gesture.
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
  // Live crosshair position for the calibration preview.
  const [previewAim, setPreviewAim] = useState({ x: 0.5, y: 0.5 });

  nameRef.current = name;
  // Runtime ammo from the server (magazine size + rounds left are set by the
  // operator in the Duck Hunter panel) + local reload countdown.
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
      // On the calibration screen the player hasn't joined yet; the publish is
      // kicked off when they tap Play (joinAndPlay). While already playing, ask
      // the server to spin up our camera input now.
      if (stage === 'play') send({ type: 'shoot_cam_start' });
    } catch {
      setCamErr('Camera access denied — check your browser permissions.');
    }
  }, [camStream, send, stage, stopCamPublish]);

  // One <video> element exists per stage (calibrate preview / play bubble);
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
    if (stage !== 'play') return;
    const t = window.setInterval(() => {
      const ends = reloadEndsRef.current;
      setReloadLeftMs(ends == null ? 0 : Math.max(0, ends - performance.now()));
    }, 100);
    return () => window.clearInterval(t);
  }, [stage]);

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

  // Gyro sensor listener. Active during calibration (readout only) and during
  // play when gyro mode is on (aims + moves the crosshair).
  const aiming = stage === 'play' && gyroMode;
  useEffect(() => {
    if (stage === 'play' && !gyroMode) return;
    gyroLiveRef.current = false;
    smoothRef.current = { x: 0.5, y: 0.5 };
    setPreviewAim({ x: 0.5, y: 0.5 });
    lastMotionTsRef.current = null; // no dt until the first motion sample
    gravityRef.current = null;
    setGyroWarn(null);
    // During calibration we integrate into the preview crosshair (not the game)
    // so the user can test which axis mapping feels right.
    const previewing = stage === 'calibrate';
    let count = 0;
    // Orientation is used only for the on-screen β/γ readout — not for aiming
    // (its angles gimbal-lock when the phone is held upright).
    const onOrient = (e: DeviceOrientationEvent) => {
      count += 1;
      setOrient({ b: e.beta, g: e.gamma, n: count });
      if (e.beta != null || e.gamma != null) gyroLiveRef.current = true;
    };
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

      if (!aiming && !previewing) return;
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
      const step = (rate: number) =>
        clamp(
          (Math.abs(rate) < GYRO_RATE_DEADZONE_DEG_S ? 0 : rate) * dt,
          -GYRO_MAX_STEP_DEG,
          GYRO_MAX_STEP_DEG,
        );
      const s = smoothRef.current;
      s.x = clamp01(s.x + step(hRate) * GYRO_GAIN * hc.sens);
      s.y = clamp01(s.y + step(vRate) * GYRO_GAIN * vc.sens);
      if (aiming) {
        sendAim(s.x, s.y);
        setLocalAim(normToLocal(s.x, s.y));
      } else {
        setPreviewAim({ x: s.x, y: s.y });
      }
    };
    // Some Android devices only emit the "absolute" orientation variant.
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
              : 'No gyroscope data (0 events) — check motion permissions/settings.',
        );
      }
    }, 1500);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('deviceorientationabsolute', onOrient);
      window.removeEventListener('devicemotion', onMotion);
      window.clearTimeout(warnTimer);
    };
  }, [stage, gyroMode, aiming, sendAim, normToLocal, perm]);

  // Volume-up button = shoot (best-effort; Android only). Browsers don't expose
  // hardware volume keys, but while an <audio> element is actively playing,
  // Android routes the hardware volume buttons to THAT element's `.volume` and
  // fires `volumechange`. We keep a looping silent clip playing and treat a
  // volume *increase* as a shot, then snap the volume back to mid so there's
  // always headroom in both directions. (iOS media volume is read-only, so this
  // can't work there; some Android browsers also deliver a keydown, handled too.)
  useEffect(() => {
    if (stage !== 'play') return;
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
  }, [stage, fire]);

  const connectWs = useCallback(() => {
    const ro = remoteOrigin();
    const base = toWsUrl(ro ?? getEffectiveClientServerUrl());
    const url = `${base}/room/${encodeURIComponent(String(roomId))}/ws`;
    setWsDbg(`connecting: ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setWsDbg('');
      // Join only once the player has committed (tapped Play); handles the case
      // where the socket opens after that tap. On a reconnect the server minted
      // a fresh client, so re-arm the camera input too if it's on.
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
      setWsDbg(
        `WS closed (${ev.code}) — is the tunnel pointing at Caddy :8080? ${url}`,
      );
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
        setScores((data as { players: ScoreRow[] }).players ?? []);
      } else if (m.type === 'shooter_ammo') {
        const a = data as {
          ammo: number;
          maxAmmo: number;
          reloadRemainingMs: number;
        };
        setAmmo(a.ammo);
        // Magazine size is set by the operator in the Duck Hunter panel; adopt
        // it so the pip row matches the server's rules.
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
        // Behind a tunnel, force the WHIP endpoint to this page's own origin so
        // Caddy forwards /whip to the media server (same-origin: no CORS/mixed),
        // mirroring the WHEP handling below.
        const ro = remoteOrigin();
        let whipUrl = o.whipUrl;
        if (ro) {
          try {
            const u = new URL(o.whipUrl);
            whipUrl = ro + u.pathname + u.search;
          } catch {
            /* keep original */
          }
        }
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

  // Request iOS motion permission once, from the first calibration gesture.
  const requestPermOnce = useCallback(() => {
    if (permRequestedRef.current) return;
    permRequestedRef.current = true;
    void requestMotionPermission().then(setPerm);
  }, []);

  // Commit the chosen name and enter the game. Ammo rules come from the server
  // (set by the operator in the Duck Hunter panel).
  const joinAndPlay = useCallback(
    (gyro: boolean) => {
      wantsJoinRef.current = true;
      send({
        type: 'shoot_join',
        name: name.trim() || 'Player',
      });
      // If the player enabled their camera on the calibration screen, spin up
      // its live input now that they've joined.
      if (camStreamRef.current) send({ type: 'shoot_cam_start' });
      setGyroMode(gyro);
      setStage('play');
    },
    [send, name],
  );

  // Connect + fetch room info on mount — no separate name screen; the name is
  // entered on the calibration screen and sent when the player taps Play.
  useEffect(() => {
    let cancelled = false;
    void getRoomInfo(String(roomId)).then((info) => {
      if (!cancelled && info && info !== 'not-found') setRoom(info);
    });
    connectWs();
    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, connectWs]);

  // Establish the WHEP output stream once we have the room's whepUrl.
  useEffect(() => {
    if (stage !== 'play' || !room?.whepUrl) return;
    let cancelled = false;
    // Behind a tunnel, force the WHEP endpoint to the page's own origin so the
    // proxy forwards /whep to the media server (same-origin: no CORS/mixed).
    const ro = remoteOrigin();
    let whepUrl = room.whepUrl;
    if (ro) {
      try {
        const u = new URL(room.whepUrl);
        whepUrl = ro + u.pathname + u.search;
      } catch {
        /* keep original */
      }
    }
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
  }, [stage, room?.whepUrl]);

  // Attach the stream whenever it (or the video element) changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream, stage]);

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

  if (stage === 'calibrate') {
    const sensorLive = orient.n > 0 && (orient.b != null || orient.g != null);
    return (
      <div
        onPointerDown={requestPermOnce}
        className='h-dvh w-full bg-[#0a0a0a] text-white flex flex-col landscape:flex-row items-center landscape:items-stretch justify-center gap-3 landscape:gap-5 p-4 overflow-hidden text-center'>
        {/* Left: live crosshair preview driven by the current axis mapping. */}
        <div className='flex flex-col items-center justify-center gap-2 shrink-0'>
          <h2 className='text-xl font-bold'>Calibration</h2>
          <div className='relative w-60 h-40 rounded-lg border border-neutral-700 bg-neutral-900 overflow-hidden'>
            <CalibPreview aim={previewAim} />
          </div>
          <button
            onClick={recenter}
            className='rounded bg-neutral-800 text-white text-xs px-3 py-1.5'>
            ⌖ Recenter
          </button>
          <div className='text-[10px] font-mono text-cyan-300'>
            perm:{perm} · events:{orient.n} · β:
            {orient.b == null ? '—' : orient.b.toFixed(0)} · γ:
            {orient.g == null ? '—' : orient.g.toFixed(0)}
          </div>
        </div>

        {/* Right: settings — scrolls on its own so it stays reachable in
            landscape, where vertical space is tight. */}
        <div className='flex-1 min-h-0 w-full max-w-xs overflow-y-auto flex flex-col gap-3 text-left'>
          <label className='text-[11px] text-neutral-400'>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Your name'
              className='mt-1 w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white'
            />
          </label>
          <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 flex items-center gap-3'>
            <button
              onClick={() => void toggleCamera()}
              className={`rounded px-3 py-2 text-xs shrink-0 ${
                camStream
                  ? 'bg-[#00f3ff] text-black'
                  : 'bg-neutral-800 text-white'
              }`}>
              {camStream ? '📷 Camera on' : '📷 Camera off'}
            </button>
            {camStream ? (
              <video
                ref={attachCamVideo}
                autoPlay
                playsInline
                muted
                className='w-12 h-12 rounded-full object-cover border border-[#00f3ff] -scale-x-100 shrink-0'
              />
            ) : null}
            <p className='text-[10px] text-neutral-500'>
              Show your face next to your name on the stream.
            </p>
          </div>
          {camErr && (
            <div className='rounded bg-amber-500/90 text-black text-xs px-3 py-2'>
              {camErr}
            </div>
          )}
          <p className='text-[11px] text-neutral-400'>
            Pick an axis for horizontal and vertical aiming, flip the direction
            and set the sensitivity. Move the phone and watch the crosshair
            until it reacts the way it should.
          </p>
          <AxisControls
            title='Horizontal ←→'
            cfg={horizCfg}
            onChange={setHorizCfg}
          />
          <AxisControls
            title='Vertical ↑↓'
            cfg={vertCfg}
            onChange={setVertCfg}
          />

          {gyroWarn && (
            <div className='rounded bg-amber-500/90 text-black text-xs px-3 py-2'>
              {gyroWarn}
            </div>
          )}
          <button
            onClick={() => {
              requestPermOnce();
              recenter();
              joinAndPlay(true);
            }}
            className={`w-full rounded-lg py-3 text-lg font-bold transition-transform active:scale-95 ${
              sensorLive ? 'bg-[#00f3ff]' : 'bg-[#00f3ff]/60'
            } text-black`}>
            🎯 Play
          </button>
          <button
            onClick={() => joinAndPlay(false)}
            className='w-full rounded-lg bg-neutral-800 text-white py-2.5'>
            👆 Play with finger
          </button>
          <p className='text-[10px] text-neutral-500 text-center'>
            Tap a duck to shoot. Android: the volume-up button (+) works too.
            Set the input with ducks to full screen for accuracy.
          </p>
        </div>
      </div>
    );
  }

  // Our assigned color (from the scoreboard, matched on our clientId); falls
  // back to the default cyan until the server has told us who we are.
  const myColor =
    scores.find((s) => s.clientId === myClientId)?.color ?? '#00f3ff';

  return (
    <div className='fixed inset-0 bg-black text-white flex flex-col select-none'>
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

        {/* Top HUD. */}
        <div className='absolute top-0 left-0 right-0 flex items-center justify-between p-3 text-sm pointer-events-none'>
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? '● online' : '○ offline'}
          </span>
          <span className='flex items-center gap-1.5 font-mono'>
            <span
              className='inline-block w-3 h-3 rounded-full border border-white/40'
              style={{ backgroundColor: myColor }}
              aria-label='Your color'
            />
            <span style={{ color: myColor }}>Score: {score}</span>
          </span>
        </div>
        {!connected && wsDbg && (
          <div className='absolute top-16 left-2 right-2 rounded bg-black/70 text-amber-300 text-[10px] px-2 py-1 text-center break-all pointer-events-none'>
            {wsDbg}
          </div>
        )}
        {scores.length > 0 && (
          <div className='absolute top-9 left-0 right-0 px-3 flex flex-wrap gap-2 text-xs pointer-events-none'>
            {scores.map((s) => (
              <span
                key={s.clientId}
                style={{ color: s.color }}
                className='font-mono'>
                {s.name}: {s.score}
              </span>
            ))}
          </div>
        )}
        {gyroMode && (
          <div className='absolute bottom-2 left-2 rounded bg-black/70 text-cyan-300 text-[10px] font-mono px-2 py-1 pointer-events-none'>
            perm:{perm} · events:{orient.n} · β:
            {orient.b == null ? '—' : orient.b.toFixed(0)} · γ:
            {orient.g == null ? '—' : orient.g.toFixed(0)}
          </div>
        )}
        {gyroMode && gyroWarn && (
          <div className='absolute bottom-9 left-2 right-2 rounded bg-amber-500/90 text-black text-xs px-3 py-2 text-center pointer-events-none'>
            {gyroWarn}
          </div>
        )}

        {/* Self view: the camera snapshot being shared next to your name. */}
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
      </div>

      {/* Ammo: filled pips = rounds left, plus the reload countdown. */}
      <div className='px-3 pt-2 flex items-center justify-center gap-1.5 bg-[#0a0a0a]'>
        {Array.from({ length: maxAmmo }).map((_, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full ${
              i < ammo ? 'bg-[#ffde59]' : 'bg-neutral-700'
            }`}
          />
        ))}
        <span className='ml-2 text-[11px] font-mono text-neutral-400 w-24 text-left'>
          {ammo < maxAmmo && reloadLeftMs > 0
            ? `+1 in ${(reloadLeftMs / 1000).toFixed(1)}s`
            : ammo >= maxAmmo
              ? 'full'
              : ''}
        </span>
      </div>

      {/* Controls. */}
      <div className='p-3 flex items-center gap-3 bg-[#0a0a0a]'>
        <button
          onClick={async () => {
            if (gyroMode) {
              setGyroMode(false);
              return;
            }
            // Request iOS motion permission from this user gesture.
            setPerm(await requestMotionPermission());
            setGyroWarn(null);
            setOrient({ b: null, g: null, n: 0 });
            setGyroMode(true);
          }}
          className={`rounded px-3 py-2 text-xs ${
            gyroMode ? 'bg-[#00f3ff] text-black' : 'bg-neutral-800 text-white'
          }`}>
          {gyroMode ? '🎯 Gyro' : '👆 Finger'}
        </button>
        {gyroMode && (
          <>
            <button
              onClick={recenter}
              className='rounded bg-neutral-800 text-white px-3 py-2 text-xs'>
              ⌖
            </button>
            <button
              onClick={() => setStage('calibrate')}
              className='rounded bg-neutral-800 text-white px-3 py-2 text-xs'>
              ⚙️ Axes
            </button>
          </>
        )}
        <button
          onPointerDown={fire}
          className={`flex-1 rounded-xl font-extrabold py-4 text-xl active:scale-95 transition-transform ${
            ammo > 0
              ? 'bg-[#ff3b3b] text-white'
              : 'bg-neutral-800 text-neutral-500'
          }`}>
          {ammo > 0 ? 'FIRE 🔫' : 'EMPTY 🔄'}
        </button>
      </div>
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
// triggered from a user gesture. Aiming now needs DeviceMotion (rotationRate)
// and the readout needs DeviceOrientation; on iOS these share a single "Motion &
// Orientation" permission, so requesting either unlocks both events. Prefer the
// motion request. Android/desktop need no prompt.
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

// Calibration preview: a crosshair at the current accumulated aim position, so
// the user can see how the chosen axis mapping reacts before playing.
function CalibPreview({ aim }: { aim: { x: number; y: number } }) {
  return (
    <div
      className='absolute w-7 h-7'
      style={{
        left: `${aim.x * 100}%`,
        top: `${aim.y * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}>
      <div className='absolute inset-0 rounded-full border-2 border-[#00f3ff]' />
      <div className='absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#00f3ff]' />
      <div className='absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2 bg-[#00f3ff]' />
    </div>
  );
}

// Per-axis controls: which gyro source drives this axis, invert, and sensitivity.
function AxisControls({
  title,
  cfg,
  onChange,
}: {
  title: string;
  cfg: AxisCfg;
  onChange: (c: AxisCfg) => void;
}) {
  return (
    <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 text-left space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{title}</span>
        <button
          onClick={() => onChange({ ...cfg, invert: !cfg.invert })}
          className={`rounded px-2 py-1 text-[11px] ${
            cfg.invert
              ? 'bg-[#00f3ff] text-black'
              : 'bg-neutral-800 text-neutral-300'
          }`}>
          {cfg.invert ? '⇄ inverted' : '⇄ invert'}
        </button>
      </div>
      <select
        value={cfg.source}
        onChange={(e) =>
          onChange({ ...cfg, source: e.target.value as AxisSource })
        }
        className='w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-2 text-sm'>
        {AXIS_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <div className='flex items-center gap-2'>
        <span className='text-[11px] text-neutral-400 w-16'>sensitivity</span>
        <input
          type='range'
          min={0.3}
          max={4}
          step={0.1}
          value={cfg.sens}
          onChange={(e) => onChange({ ...cfg, sens: Number(e.target.value) })}
          className='flex-1'
        />
        <span className='text-[11px] font-mono text-neutral-300 w-8 text-right'>
          {cfg.sens.toFixed(1)}
        </span>
      </div>
    </div>
  );
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
