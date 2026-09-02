'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  ShooterJoinedEvent,
  ShooterMatchEvent,
} from '@smelter-editor/types';
import {
  MAX_SHOOTER_PLAYERS,
  WS_CLOSE_ROOM_NOT_FOUND,
} from '@smelter-editor/types';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import { connectWhep, type WhepConnection } from '@/lib/webrtc/whep-connect';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import {
  forgetShooterSession,
  readShooterSession,
  writeShooterSession,
} from '@/components/duck-hunter/phone/shooter-session';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import { doto, pressStart, robotoMono } from '@/app/duck-hunter/fonts';
import {
  ChipButton,
  PhoneShell,
  WarnPanel,
} from '@/components/duck-hunter/phone/phone-shell';
import { ConnectStep } from '@/components/duck-hunter/phone/connect-step';
import { NameStep } from '@/components/duck-hunter/phone/name-step';
import { CharacterStep } from '@/components/duck-hunter/phone/character-step';
import { characterById } from '@/components/duck-hunter/characters';
import { WeaponStep } from '@/components/duck-hunter/phone/weapon-step';
import { CalibrateStep } from '@/components/duck-hunter/phone/calibrate-step';
import { ReadyStep } from '@/components/duck-hunter/phone/ready-step';
import {
  AmmoRow,
  ControlsRow,
  MatchOverlay,
  PlayTopBar,
} from '@/components/duck-hunter/phone/play-hud';
import {
  FeedLinkingCard,
  GunPanel,
} from '@/components/duck-hunter/phone/gun-panel';
import {
  freshStreak,
  registerStreakHit,
} from '@/components/duck-hunter/phone/gun-stats';
import {
  clampMoveSens,
  defaultAxisSettings,
  loadAxisSettings,
  saveAxisSettings,
  type AxisCfg,
  type AxisSettings,
  type AxisSource,
  type OrientationKey,
} from '@/components/duck-hunter/phone/axis';
import {
  freshPractice,
  markPracticeHit,
  pickPracticeHit,
  type PracticeTarget,
} from '@/components/duck-hunter/phone/practice';
import {
  MOVE_ROT_GATE_DERIVED_DEG_S,
  MOVE_ROT_GATE_DEG_S,
  freshMoveState,
  resetMoveState,
  stepTranslation,
} from '@/components/duck-hunter/phone/translation';
import { useIsLandscape } from '@/components/duck-hunter/phone/use-viewport';
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

// A refused trigger pull (empty magazine, countdown, game over): red flash +
// error buzz + a short banner. The banner is the only one of the three that
// works on iOS Safari (no navigator.vibrate there at all), so it has to carry
// the message on its own. The haptic floor keeps a mashed FIRE button from
// turning into one continuous buzz.
const FIRE_ALERT_MS = 1400;
const REJECT_HAPTIC_MIN_MS = 350;
const ERROR_BUZZ = [30, 60, 30, 60, 30];
// A trigger pull on an empty magazine doubles as a "what do I really hold?"
// question to the server (see `fire`). Rate-limited so mashing the button
// doesn't turn into a shot storm the moment the server disagrees with us.
const AMMO_RESYNC_MIN_MS = 500;

// connectWhep resolves on a promise that never rejects and has no timeout of
// its own: if the SDP exchange succeeds but no video track ever arrives, the
// phone would sit on LINKING FEED… forever. (AUDIO_TRACK_WAIT_MS adds 2 s to a
// healthy link, so a real connect lands in the 1–3 s range.)
const WHEP_WATCHDOG_MS = 8000;

// Reconnect/republish backoff: 1 s → ×2 → cap. After REPUBLISH_STUCK_AFTER
// failed republish attempts the camera error surfaces a manual retry hint
// instead of an infinite silent spinner.
const RECONNECT_MAX_MS = 8000;
const REPUBLISH_MAX_MS = 8000;
const REPUBLISH_STUCK_AFTER = 4;

// The guided wizard: boot sequence → call sign → hunter → weapon → (gyro)
// calibration → briefing → the hunt. Steps before 'play' render inside
// PhoneShell.
type Step =
  | 'connect'
  | 'name'
  | 'character'
  | 'weapon'
  | 'calibrate'
  | 'ready'
  | 'play';

const STEP_META: Record<
  Exclude<Step, 'play'>,
  { index: number; label: string }
> = {
  connect: { index: 0, label: 'CONNECTING' },
  name: { index: 1, label: 'CALL SIGN' },
  character: { index: 2, label: 'HUNTER SELECT' },
  weapon: { index: 3, label: 'WEAPON SELECT' },
  calibrate: { index: 4, label: 'CALIBRATION' },
  ready: { index: 5, label: 'BRIEFING' },
};
const STEP_COUNT = 6;

type ScoreRow = {
  clientId: string;
  name: string;
  color: string;
  score: number;
  /** Dogs bagged — a separate tally, shown as icons beside the score. */
  dogScore?: number;
  /**
   * The hunter this player holds. Characters are exclusive, so this is what
   * lets the select screen gray out what is already gone — including before
   * this phone has joined, since `shoot_spectate` delivers the roster on open.
   */
  characterId?: string;
};

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [name, setName] = useState('');
  // Hunter character picked on this phone (rides shoot_join; changeable via
  // shoot_character once joined). Mirrored to a ref for the WS open replay.
  const [characterId, setCharacterId] = useState<string | null>(null);
  const characterIdRef = useRef<string | null>(null);
  characterIdRef.current = characterId;
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [score, setScore] = useState(0);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  // Hit streak behind the gun panel's combo readout. Mirrored to a ref because
  // folding a hit in is not idempotent — it must be computed outside the
  // setState updater (React may re-run one; see practice.ts).
  const [streak, setStreak] = useState(freshStreak);
  const streakRef = useRef(streak);
  streakRef.current = streak;
  // Live room status broadcast by the server (pre-join too): whether a
  // duck-enabled input is up, and the arcade match state.
  const [targetActive, setTargetActive] = useState(false);
  const [match, setMatch] = useState<ShooterMatchEvent | null>(null);
  const phase = match?.phase ?? 'idle';
  // Exact mirror of DuckHunterController.fire()'s own gate: a round only takes
  // shots while 'playing'. Deliberately NOT `match !== null` — the phone holds
  // a match event for 'idle'/'lobby' too, where the server's `this.match` is
  // null and open-range shooting is perfectly legal.
  const triggerBlocked = phase === 'countdown' || phase === 'ended';
  // This player's own id (learned from server events addressed to us), used to
  // pick our assigned color out of the scoreboard so the phone can show it.
  const [myClientId, setMyClientIdState] = useState<string | null>(null);
  // Mirrored to a ref because the WS handler has to branch on it WITHIN a
  // message (a 'character_taken' means different things on and off the
  // roster), and a render-time mirror would still hold the previous value.
  // Written through one setter so the two can't drift.
  const myClientIdRef = useRef<string | null>(null);
  const setMyClientId = useCallback(
    (next: string | null | ((prev: string | null) => string | null)) => {
      const value =
        typeof next === 'function' ? next(myClientIdRef.current) : next;
      myClientIdRef.current = value;
      setMyClientIdState(value);
    },
    [],
  );
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
  // The output feed is opt-in: every phone that pulls it opens its own
  // RTCPeerConnection and burns bandwidth and battery on a picture the players
  // are already watching on the big screen. Off means the WHEP connection is
  // never established at all (not merely hidden), and the stage shows the gun
  // panel instead. Deliberately NOT persisted — a remembered ON would quietly
  // resume pulling video on the next refresh.
  const [streamOn, setStreamOn] = useState(false);
  const [whepState, setWhepState] = useState<
    'off' | 'linking' | 'live' | 'failed'
  >('off');
  const streamOnRef = useRef(streamOn);
  streamOnRef.current = streamOn;
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
  // The server-assigned camera input id (drives the heartbeat) + whether the
  // publish peer connection is actually up (gates the heartbeat: acking with
  // the PC down would mask a dead camera server-side).
  const [camInputId, setCamInputId] = useState<string | null>(null);
  const [camLive, setCamLive] = useState(false);
  // The user wants the camera on — the republish self-heal only runs then.
  const wantsCamRef = useRef(false);
  const republishTimerRef = useRef<number | null>(null);
  const republishDelayRef = useRef(1000);
  const republishAttemptsRef = useRef(0);
  // Reconnect state for the room WS: backoff delay + "we closed it ourselves"
  // (unmount / explicit exit), which disables auto-reconnect.
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  // Per-room resume session (playerKey + name), replayed on every re-join.
  const sessionRef = useRef<ReturnType<typeof readShooterSession>>({});
  // Transient server-refusal notice (room full, camera failed).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  // Transient "that trigger pull produced no shot" banner over the stage. The
  // id is bumped per alert so React remounts the node and the r5-enter pop
  // replays even when the same refusal repeats.
  const [fireAlert, setFireAlert] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const fireAlertIdRef = useRef(0);
  const fireAlertTimerRef = useRef<number | null>(null);
  const lastRejectHapticRef = useRef(0);
  const lastAmmoResyncRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
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
  // Rotation only — the translation offset is added at send time and must never
  // be folded back in here, or it would turn into unbounded drift.
  const aimRef = useRef({ x: 0.5, y: 0.5 });
  // Leaky velocity/displacement behind the parallax offset (see translation.ts).
  const moveRef = useRef(freshMoveState());
  // Per-axis gyro mapping (source + invert + sensitivity), tuned on the
  // calibration screen and persisted — one bucket per screen orientation,
  // since the raw rateX/Y/Z sources are device-frame and change meaning when
  // the phone rotates. The active pair follows live orientation (rotating
  // with the advanced sheet open swaps its controls to the other bucket —
  // intended). Mirrored to refs for the motion listener.
  const landscape = useIsLandscape();
  const orientKey: OrientationKey = landscape ? 'landscape' : 'portrait';
  const orientKeyRef = useRef(orientKey);
  orientKeyRef.current = orientKey;
  const [axisPairs, setAxisPairs] = useState<AxisSettings>(defaultAxisSettings);
  const horizCfg = axisPairs[orientKey].horiz;
  const vertCfg = axisPairs[orientKey].vert;
  const moveSens = axisPairs[orientKey].moveSens;
  const horizCfgRef = useRef(horizCfg);
  const vertCfgRef = useRef(vertCfg);
  const moveSensRef = useRef(moveSens);
  horizCfgRef.current = horizCfg;
  vertCfgRef.current = vertCfg;
  moveSensRef.current = moveSens;
  // Stable setters that write into the bucket for the orientation at call
  // time (ref read, not closure — a rotate-then-tap can't hit a stale slot).
  const setHorizCfg = useCallback((c: AxisCfg) => {
    setAxisPairs((p) => {
      const k = orientKeyRef.current;
      return { ...p, [k]: { ...p[k], horiz: c } };
    });
  }, []);
  const setVertCfg = useCallback((c: AxisCfg) => {
    setAxisPairs((p) => {
      const k = orientKeyRef.current;
      return { ...p, [k]: { ...p[k], vert: c } };
    });
  }, []);
  const setMoveSens = useCallback((v: number) => {
    setAxisPairs((p) => {
      const k = orientKeyRef.current;
      return { ...p, [k]: { ...p[k], moveSens: clampMoveSens(v) } };
    });
  }, []);
  // Live crosshair position for the calibration test range.
  const [previewAim, setPreviewAim] = useState({ x: 0.5, y: 0.5 });
  const previewAimRef = useRef(previewAim);
  previewAimRef.current = previewAim;
  // Practice ducks in the test range (local only, no server traffic).
  const [practice, setPractice] = useState<PracticeTarget[]>(freshPractice);
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  // Opened calibration from the play HUD (⚙) — CONTINUE returns to the hunt.
  const [calibFromPlay, setCalibFromPlay] = useState(false);
  // The player pressed JOIN THE HUNT. Entering the game itself is gated on the
  // match phase (see canEnterPlay) — until the host starts, they stand by on
  // the briefing screen.
  const [joined, setJoined] = useState(false);

  nameRef.current = name;
  // Runtime ammo from the server (magazine size + rounds left are set by the
  // operator) + local reload countdown.
  const [maxAmmo, setMaxAmmo] = useState(3);
  const [ammo, setAmmo] = useState(3);
  const reloadEndsRef = useRef<number | null>(null);
  const [reloadLeftMs, setReloadLeftMs] = useState(0);
  // The server's reload interval, needed to turn the countdown into a progress
  // bar on the gun panel. It has always been on the wire (shooter_ammo), the
  // phone just threw it away.
  const [reloadMs, setReloadMs] = useState(3000);

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
      // name override it, then the per-room resume session (most specific).
      const dn = localStorage.getItem('smelter-display-name');
      if (dn) setName(dn);
      const stored = loadAxisSettings();
      setAxisPairs({ portrait: stored.portrait, landscape: stored.landscape });
      if (stored.name) setName(stored.name);
      const session = readShooterSession(String(roomId));
      if (session.name) setName(session.name);
      if (session.characterId) setCharacterId(session.characterId);
    } catch {
      /* ignore malformed storage */
    }
  }, [roomId]);
  useEffect(() => {
    if (firstAxisSaveRef.current) {
      firstAxisSaveRef.current = false;
      return;
    }
    saveAxisSettings({ ...axisPairs, name });
  }, [axisPairs, name]);

  const recenter = useCallback(() => {
    aimRef.current = { x: 0.5, y: 0.5 };
    // Drop any in-flight shove too, or the parallax offset would immediately
    // pull the freshly centred crosshair back off the middle.
    resetMoveState(moveRef.current);
    setPreviewAim({ x: 0.5, y: 0.5 });
  }, []);

  /**
   * Returns whether the message actually left the phone. Callers that spend
   * something locally (see `fire`'s optimistic round) MUST check it: a silent
   * drop here with the spend already applied desyncs us from the server for
   * good, because `ammo` has no other source than the server's reply.
   */
  const send = useCallback((msg: object): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  // Tear down the live-camera WHIP publisher (leaves the local camera preview
  // running; only the outgoing broadcast stream is stopped).
  const stopCamPublish = useCallback(() => {
    camPcRef.current?.close();
    camPcRef.current = null;
  }, []);

  // Camera request with the ACTUAL track dimensions so the server registers
  // the input with its true aspect (portrait cams get cover-cropped without).
  const sendCamStart = useCallback(() => {
    const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    send({
      type: 'shoot_cam_start',
      ...(settings?.width && settings?.height
        ? { nativeWidth: settings.width, nativeHeight: settings.height }
        : {}),
    });
  }, [send]);
  const sendCamStartRef = useRef(sendCamStart);
  sendCamStartRef.current = sendCamStart;

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
    setCamLive(false);
    const delay = republishDelayRef.current;
    republishDelayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    republishAttemptsRef.current += 1;
    if (republishAttemptsRef.current > REPUBLISH_STUCK_AFTER) {
      setCamErr('CAMERA DROPPED — tap 📷 off and on to retry.');
    }
    republishTimerRef.current = window.setTimeout(() => {
      republishTimerRef.current = null;
      if (!wantsCamRef.current || camPcRef.current != null) return;
      const track = camStreamRef.current?.getVideoTracks()[0];
      const streamDead = !track || track.readyState === 'ended';
      const fire = () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          sendCamStartRef.current();
        } else {
          // WS is down too — its own reconnect replays the cam request, but
          // keep this loop alive in case that path lost the race.
          scheduleRepublishRef.current?.();
        }
      };
      if (streamDead) {
        void acquireCameraRef.current?.().then((ok) => {
          if (ok) fire();
          else scheduleRepublishRef.current?.();
        });
      } else {
        fire();
      }
    }, delay);
  }, []);
  scheduleRepublishRef.current = scheduleRepublish;

  const acquireCameraRef = useRef<(() => Promise<boolean>) | null>(null);

  /** Get the front camera and arm the OS-level track-death listener. */
  const acquireCamera = useCallback(async (): Promise<boolean> => {
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
      // Camera loss at the OS level (screen lock, iOS backgrounding, unplug)
      // fires NO peer-connection event — only the track's 'ended'. The
      // identity guard keeps a deliberate stream swap from false-positiving.
      const track = s.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        if (camStreamRef.current === s) {
          stopCamPublish();
          setCamLive(false);
          scheduleRepublishRef.current?.();
        }
      });
      return true;
    } catch {
      setCamErr('Camera access denied — check your browser permissions.');
      return false;
    }
  }, [stopCamPublish]);
  acquireCameraRef.current = acquireCamera;

  // Camera: toggle the front camera on/off. While playing, turning it on asks
  // the server for a WHIP input (it replies with `shooter_cam_offer`, which we
  // publish into); turning it off tears the publisher down on both ends.
  const toggleCamera = useCallback(async () => {
    if (camStream) {
      wantsCamRef.current = false;
      if (republishTimerRef.current != null) {
        window.clearTimeout(republishTimerRef.current);
        republishTimerRef.current = null;
      }
      republishDelayRef.current = 1000;
      republishAttemptsRef.current = 0;
      camStream.getTracks().forEach((t) => t.stop());
      setCamStream(null);
      camStreamRef.current = null;
      stopCamPublish();
      setCamInputId(null);
      setCamLive(false);
      send({ type: 'shoot_cam_stop' });
      return;
    }
    setCamErr(null);
    const ok = await acquireCamera();
    if (!ok) return;
    wantsCamRef.current = true;
    republishDelayRef.current = 1000;
    republishAttemptsRef.current = 0;
    // Before joining, the publish is kicked off by joinAndPlay; while already
    // playing, ask the server to spin up our camera input now.
    if (step === 'play') sendCamStart();
  }, [camStream, send, sendCamStart, step, stopCamPublish, acquireCamera]);

  // Worker-driven heartbeat (+ wake lock): tells the server our publish is up.
  // Gated on `camLive` — see the comment in useWhipHeartbeat.
  useWhipHeartbeat(String(roomId), camInputId, !!camStream && camLive);

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

  /**
   * Transient banner for a refused request (room full, hunter taken, kicked).
   * Stable, so the long-lived WS handler and the wizard callbacks can share it.
   */
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 4000);
  }, []);

  /**
   * One place for every refused shot — empty magazine, countdown still
   * running, round already over — so they all feel the same: red flash, error
   * buzz, banner. Stable (no deps) so the long-lived WS handler can call it
   * without churning `fire`'s identity.
   */
  const rejectFire = useCallback((text: string) => {
    setFlash('miss');
    window.setTimeout(() => setFlash(null), 150);
    const id = ++fireAlertIdRef.current;
    setFireAlert({ id, text });
    if (fireAlertTimerRef.current != null) {
      window.clearTimeout(fireAlertTimerRef.current);
    }
    fireAlertTimerRef.current = window.setTimeout(() => {
      fireAlertTimerRef.current = null;
      setFireAlert(null);
    }, FIRE_ALERT_MS);
    const now = performance.now();
    if (now - lastRejectHapticRef.current >= REJECT_HAPTIC_MIN_MS) {
      lastRejectHapticRef.current = now;
      if (navigator.vibrate) navigator.vibrate(ERROR_BUZZ);
    }
  }, []);

  const fire = useCallback(() => {
    // The server drops countdown/game-over shots silently — no shooter_ammo
    // comes back — so an optimistic spend here would leave the shell row
    // drained and the button stuck on RELOADING until the next round refills.
    if (triggerBlocked) {
      rejectFire(
        phase === 'ended' ? 'ROUND OVER — HOLD FIRE' : 'GET READY — HOLD FIRE',
      );
      return;
    }
    if (ammo <= 0) {
      // Empty mag: click. Also ask the server, rarely, what it thinks we hold —
      // a phone that zeroed itself while the server's magazine stayed FULL is
      // otherwise stuck forever (a full mag has no reload cycle running, so no
      // regen tick will ever push a correcting `shooter_ammo`, and this branch
      // is what stops us asking). The server answers an empty-mag shot with
      // `shooter_empty` + the true magazine, so this costs nothing when we are
      // genuinely out and self-heals when we are not.
      rejectFire('OUT OF AMMO — RELOADING');
      const now = performance.now();
      if (now - lastAmmoResyncRef.current >= AMMO_RESYNC_MIN_MS) {
        lastAmmoResyncRef.current = now;
        send({ type: 'shoot_fire' });
      }
      return;
    }
    // Spend only once the round is actually on the wire: `send` drops the
    // message when the socket isn't OPEN, and an optimistic spend against a
    // dropped shot drains the magazine with nothing coming back to refill it.
    if (send({ type: 'shoot_fire' })) {
      setAmmo((a) => Math.max(0, a - 1)); // optimistic; server reconciles
    }
  }, [send, ammo, phase, triggerBlocked, rejectFire]);

  // `fire` gets a fresh identity on every ammo change (it closes over `ammo`).
  // Long-lived listeners must go through this ref instead of depending on it,
  // or their effect tears down and re-runs once per shot.
  const fireRef = useRef(fire);
  fireRef.current = fire;

  // Test-range shot during calibration: hit-test against the practice ducks
  // (local only — nothing is sent to the server). FIRE shoots at the preview
  // crosshair; a direct tap on the range passes its own coordinates instead.
  // The hit is decided here, outside the updater: `setPractice` may run its
  // updater more than once on the same input (StrictMode in dev, render
  // restarts otherwise), so it must stay pure — a "did I already bag one" flag
  // latched in this closure would make the second pass drop the hit entirely.
  const testFire = useCallback((at?: { x: number; y: number }) => {
    const aim = at ?? previewAimRef.current;
    const hitId = pickPracticeHit(practiceRef.current, aim);
    if (hitId !== null) setPractice((prev) => markPracticeHit(prev, hitId));
    if (navigator.vibrate)
      navigator.vibrate(hitId !== null ? 60 : [15, 40, 15]);
  }, []);

  // Map a client point on the stage (object-contain) to output-space [0,1],
  // correcting for the letterbox bars around the video content.
  //
  // Measured against the stage, not the <video>: the video is `w-full h-full`
  // inside it, so the rectangle is identical — but the element only exists
  // while the feed is on, and the gyro crosshair has to keep working without it.
  const toOutputNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = stageRef.current;
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
      const stage = stageRef.current;
      const res = room?.resolution;
      if (!stage || !res || !('width' in res)) return null;
      const rect = stage.getBoundingClientRect();
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
        left: offX + nx * renderW,
        top: offY + ny * renderH,
      };
    },
    [room],
  );

  // Touch/mouse aiming directly on the video. Requires the feed: a tap landing
  // on the gun panel would map the panel's own coordinates into output space
  // and fire at a duck the player never saw.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode || !streamOn) return;
      pressRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      const aim = toOutputNorm(e.clientX, e.clientY);
      if (aim) sendAim(aim.x, aim.y, true);
      setLocalAim(localFromClient(e.clientX, e.clientY));
    },
    [gyroMode, streamOn, toOutputNorm, sendAim, localFromClient],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode || !streamOn || !pressRef.current) return;
      const aim = toOutputNorm(e.clientX, e.clientY);
      if (aim) sendAim(aim.x, aim.y);
      setLocalAim(localFromClient(e.clientX, e.clientY));
    },
    [gyroMode, streamOn, toOutputNorm, sendAim, localFromClient],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (gyroMode || !streamOn) return;
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
    [gyroMode, streamOn, toOutputNorm, sendAim, fire],
  );

  // Gyro sensor listener. Active during calibration (drives the test-range
  // crosshair) and during play when gyro mode is on (aims the real one).
  const aiming = step === 'play' && gyroMode;
  useEffect(() => {
    const previewing = step === 'calibrate';
    if (!previewing && !aiming) return;
    gyroLiveRef.current = false;
    aimRef.current = { x: 0.5, y: 0.5 };
    resetMoveState(moveRef.current);
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
      const s = aimRef.current;
      s.x = clamp01(s.x + step2(hRate) * GYRO_GAIN * hc.sens);
      s.y = clamp01(s.y + step2(vRate) * GYRO_GAIN * vc.sens);

      // Translation ("parallax"): physically shoving the phone nudges the
      // crosshair, and the nudge relaxes back on its own. Prefer the device's
      // own gravity-free linear acceleration; deriving it by subtracting the
      // low-passed gravity is the fallback, and runs under a tighter rotation
      // gate because that estimate goes stale quickly once the phone turns.
      const lin = e.acceleration;
      let ax = 0;
      let ay = 0;
      let gateDegS = MOVE_ROT_GATE_DEG_S;
      if (lin && (lin.x != null || lin.y != null || lin.z != null)) {
        ax = lin.x ?? 0;
        ay = lin.y ?? 0;
      } else if (ag && g) {
        ax = (ag.x ?? 0) - g.x;
        ay = (ag.y ?? 0) - g.y;
        gateDegS = MOVE_ROT_GATE_DERIVED_DEG_S;
      }
      // Device Z (push/pull toward the screen) has no meaning for a 2D
      // crosshair, so only the screen plane is projected.
      const { offX, offY } = stepTranslation(
        moveRef.current,
        { right: ax * right[0] + ay * right[1], up: ax * up[0] + ay * up[1] },
        Math.hypot(wx, wy, wz),
        dt,
        moveSensRef.current,
        gateDegS,
      );

      const aimX = clamp01(s.x + offX);
      const aimY = clamp01(s.y + offY);
      if (aiming) {
        // The aim always goes out — the crosshair on the big screen is the
        // point. The *local* crosshair only exists over the video: in panel
        // mode a constant null bails out on Object.is, so gyro aiming costs
        // zero re-renders there (cheaper than feed mode, not dearer).
        sendAim(aimX, aimY);
        setLocalAim(streamOnRef.current ? normToLocal(aimX, aimY) : null);
      } else {
        setPreviewAim({ x: aimX, y: aimY });
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
  //
  // iOS is not merely "this won't work" — done naively it FIRES BY ITSELF. The
  // volume setter is a no-op there while the getter keeps reporting 1, so a
  // baseline pinned to 0.5 makes every `volumechange` look like a volume-up and
  // pull the trigger; re-asserting the volume from inside the handler feeds the
  // next event, and depending on `fire` (whose identity changes with `ammo`)
  // rebuilt the whole element once per shot, closing the loop. The magazine
  // then drains untouched and every regenerated round is eaten on arrival —
  // FIRE reads RELOADING forever. Hence: probe that the volume is really
  // writable before arming anything, track the true previous value, ignore our
  // own write-backs, and reach `fire` through a ref so this runs once per step.
  useEffect(() => {
    if (step !== 'play') return;
    const url = makeSilentWavUrl();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.5;
    // Read back: a platform that ignores the setter (iOS) never gets a
    // listener, so it cannot phantom-fire. The keydown path stays either way.
    const volumeWritable = Math.abs(audio.volume - 0.5) < 0.01;
    let prev = audio.volume;
    let selfWrite = false;
    const onVol = () => {
      if (selfWrite) {
        // Our own re-arm, not the player's thumb.
        selfWrite = false;
        prev = audio.volume;
        return;
      }
      const v = audio.volume;
      const up = v > prev + 0.001;
      prev = v;
      if (up) fireRef.current(); // volume up → shoot
      // Snap back to mid so there's headroom in both directions.
      if (v !== 0.5) {
        selfWrite = true;
        audio.volume = 0.5;
        // The setter may be synchronous, asynchronous, or ignored entirely;
        // only clear the guard once we know it took.
        if (audio.volume === 0.5) prev = 0.5;
        else selfWrite = false;
      }
    };
    if (volumeWritable) audio.addEventListener('volumechange', onVol);
    void audio.play().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'AudioVolumeUp') {
        e.preventDefault();
        fireRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      audio.pause();
      audio.removeEventListener('volumechange', onVol);
      window.removeEventListener('keydown', onKey);
      URL.revokeObjectURL(url);
    };
  }, [step]);

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
      reconnectDelayRef.current = 1000;
      // Observe the room right away (state + match snapshot, no player is
      // created) so the briefing screen knows the marsh status pre-join.
      ws.send(JSON.stringify({ type: 'shoot_spectate' }));
      // Join only once the player has committed (JOIN THE HUNT); handles the
      // case where the socket opens after that tap. On a reconnect the server
      // minted a fresh clientId — the stored playerKey re-adopts our entry
      // (score, color, camera) even when the old socket hasn't closed yet.
      if (wantsJoinRef.current) {
        const playerKey = sessionRef.current.playerKey;
        // Same dual-site rule as playerKey: any join field must ride BOTH
        // this reconnect replay and joinAndPlay.
        const characterId = characterIdRef.current;
        ws.send(
          JSON.stringify({
            type: 'shoot_join',
            name: nameRef.current.trim() || 'Player',
            ...(playerKey ? { playerKey } : {}),
            ...(characterId ? { characterId } : {}),
          }),
        );
        // The authoritative id arrives in shooter_joined; drop the stale one.
        setMyClientId(null);
        if (wantsCamRef.current && camStreamRef.current) {
          // The reconnect replay owns the cam re-request; a pending republish
          // timer would race it with a second (stale) request.
          if (republishTimerRef.current != null) {
            window.clearTimeout(republishTimerRef.current);
            republishTimerRef.current = null;
          }
          sendCamStartRef.current();
        }
      }
    };
    ws.onerror = () => setWsDbg(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      if (ev.code === WS_CLOSE_ROOM_NOT_FOUND) {
        // The room is gone (deleted/GC'd) — reconnecting is pointless.
        setRoomStatus('not-found');
        setWsDbg(`room not found — ${url}`);
        return;
      }
      setWsDbg(`WS closed (${ev.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        // The identity check keeps two sockets from racing after a manual
        // retry already replaced wsRef.
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
      const m = data as { type?: string; clientId?: string };
      if (m.type === 'shooter_joined') {
        // The authoritative identity ack: overwrite the cached clientId (it
        // changes on every reconnect — keeping the first one seen left the
        // phone resolving someone else's color after a reconnect) and persist
        // the resume token for the next one.
        const joined = data as ShooterJoinedEvent;
        setMyClientId(joined.clientId);
        setScore(joined.score);
        // An adopted entry may carry a pick from a previous session — adopt
        // it locally so the wizard and session agree with the server.
        if (joined.characterId) setCharacterId(joined.characterId);
        sessionRef.current = writeShooterSession(String(roomId), {
          playerKey: joined.playerKey,
          name: joined.name,
          ...(joined.characterId ? { characterId: joined.characterId } : {}),
        });
        return;
      }
      if (m.type === 'shooter_error') {
        const err = data as { code?: string; message?: string };
        if (err.code === 'camera_failed') {
          setCamErr(err.message ?? 'Camera slot failed — retry.');
          return;
        }
        if (err.code === 'kicked') {
          // The host dropped us. Forgetting the playerKey is the whole point:
          // `ws.onopen` replays shoot_join from it on every reconnect, so
          // leaving it in place would put us straight back on the roster
          // without anyone touching the phone. Coming back has to be a tap.
          wantsJoinRef.current = false;
          setJoined(false);
          setMyClientId(null);
          setScore(0);
          sessionRef.current = forgetShooterSession(String(roomId), [
            'playerKey',
          ]);
          setStep('ready');
        } else if (
          err.code === 'character_taken' ||
          err.code === 'character_required'
        ) {
          // Two very different situations behind one code, told apart by
          // whether the server has us on the roster:
          //
          // On it — a deliberate re-pick was refused, and we still hold the
          // hunter we had. Forgetting it here would leave the phone showing
          // NOT PICKED for a player the server has fully kitted out.
          //
          // Off it — the join itself was refused, so the stored pick is a dead
          // id that would be re-sent on the next attempt. Drop it and make
          // them choose again.
          if (myClientIdRef.current == null) {
            // Un-commit the join too: `joined` still true would show STANDING
            // BY for a player the server never put on the roster, and
            // `wantsJoinRef` would replay the same doomed join on reconnect.
            wantsJoinRef.current = false;
            setJoined(false);
            if (err.code === 'character_taken') {
              setCharacterId(null);
              characterIdRef.current = null;
              sessionRef.current = forgetShooterSession(String(roomId), [
                'characterId',
              ]);
            }
            setStep('character');
          }
        } else if (err.code === 'room_full') {
          // Refused at the door. Same un-commit as above, or the briefing
          // would sit on STANDING BY for a hunt we were never let into.
          wantsJoinRef.current = false;
          setJoined(false);
          setStep('ready');
        }
        showNotice(err.message ?? 'Request refused.');
        return;
      }
      // shooter_hit / shooter_ammo are addressed to us and carry our clientId;
      // adopt it as a fallback for servers predating shooter_joined.
      if (m.clientId) setMyClientId((prev) => prev ?? m.clientId!);
      if (m.type === 'shooter_hit') {
        // The dog tally is read off the scoreboard row instead (see myDogScore),
        // so it resets with the round without needing its own state here.
        const hit = data as { score: number; target?: 'duck' | 'dog' };
        setScore(hit.score);
        // Ducks chain a combo; dogs don't (the server's hitDog never touches
        // `streak` either). Computed outside the setter — see streakRef.
        if (hit.target !== 'dog') {
          const now = performance.now();
          setStreak(registerStreakHit(streakRef.current, now));
        }
        setFlash('hit');
        // A dog gets its own buzz — a double tap, so bagging one feels
        // different from a duck without needing a sound (there is no audio path).
        if (navigator.vibrate) {
          navigator.vibrate(hit.target === 'dog' ? [50, 60, 90] : 60);
        }
        window.setTimeout(() => setFlash(null), 220);
      } else if (m.type === 'shooter_miss') {
        setFlash('miss');
        window.setTimeout(() => setFlash(null), 130);
      } else if (m.type === 'shooter_state') {
        const st = data as { players: ScoreRow[]; targetActive?: boolean };
        setScores(st.players ?? []);
        setTargetActive(!!st.targetActive);
      } else if (m.type === 'shooter_match') {
        const ev = data as ShooterMatchEvent;
        setMatch(ev);
        // A fresh round starts everyone cold — the server resets its own
        // streaks the same way when it arms one.
        if (ev.phase === 'countdown' || ev.phase === 'lobby') {
          setStreak(freshStreak());
        }
      } else if (m.type === 'shooter_ammo') {
        const a = data as {
          ammo: number;
          maxAmmo: number;
          reloadMs?: number;
          reloadRemainingMs: number;
        };
        setAmmo(a.ammo);
        // Magazine size is set by the operator; adopt it so the shell row
        // matches the server's rules.
        if (typeof a.maxAmmo === 'number') setMaxAmmo(a.maxAmmo);
        // Same for the reload interval — the panel's progress bar needs the
        // whole interval, not just what's left of it.
        if (typeof a.reloadMs === 'number' && a.reloadMs > 0) {
          setReloadMs(a.reloadMs);
        }
        reloadEndsRef.current =
          a.reloadRemainingMs > 0
            ? performance.now() + a.reloadRemainingMs
            : null;
      } else if (m.type === 'shooter_empty') {
        // The authoritative empty (we thought we had a round, the server
        // disagreed) gets the same treatment as the local one.
        setAmmo(0);
        // ...unless this is merely the echo of an empty-magazine resync probe,
        // which `fire` already answered with a flash and a banner of its own.
        // Re-running it here would double-blink on every empty trigger pull.
        if (
          performance.now() - lastAmmoResyncRef.current >=
          AMMO_RESYNC_MIN_MS
        ) {
          rejectFire('OUT OF AMMO — RELOADING');
        }
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
        setCamInputId(o.inputId);
        const whipUrl = resolveMediaUrl(o.whipUrl);
        void startPublish(
          o.inputId,
          o.bearerToken,
          whipUrl,
          camPcRef,
          camStreamRef,
          () => {
            // Publish died (pc failed/closed, or 'disconnected' past the
            // grace) — self-heal instead of leaving a frozen avatar tile.
            camPcRef.current = null;
            setCamLive(false);
            scheduleRepublishRef.current?.();
          },
          'user',
          false,
          stream,
          'h264',
        )
          .then(() => {
            setCamLive(true);
            setCamErr(null);
            republishDelayRef.current = 1000;
            republishAttemptsRef.current = 0;
          })
          .catch(() => {
            // The WHIP POST itself failed — same recovery path.
            camPcRef.current = null;
            setCamLive(false);
            scheduleRepublishRef.current?.();
          });
      }
    };
  }, [roomId, rejectFire, showNotice, setMyClientId]);

  const fetchRoom = useCallback(() => {
    void getRoomInfo(String(roomId))
      .then((info) => {
        if (info && info !== 'not-found') {
          setRoom(info);
          setRoomStatus('ok');
        } else {
          setRoomStatus('not-found');
        }
      })
      .catch(() => {
        // Server unreachable (503, network): without this the boot screen
        // hangs on LINKING ROOM… forever with no RETRY button.
        setRoomStatus('not-found');
      });
  }, [roomId]);

  // Retry the boot sequence (room lookup + WS uplink) from the connect step.
  const retryConnect = useCallback(() => {
    setWsDbg('');
    closedByUsRef.current = false;
    reconnectDelayRef.current = 1000;
    const old = wsRef.current;
    wsRef.current = null; // detach first so old.onclose fails the identity check
    old?.close();
    if (roomStatus !== 'ok') {
      setRoomStatus('loading');
      fetchRoom();
    }
    connectWs();
  }, [roomStatus, fetchRoom, connectWs]);

  // Finger aiming needs a picture, and the picture is opt-in now — so the
  // option stays hidden while the gyro is healthy, and comes back the moment
  // the sensor lets the player down. The latch has to be STICKY: both the mode
  // chip and the motion effect clear `gyroWarn`, so a bare `gyroWarn != null`
  // would make the escape hatch disappear a second and a half after the player
  // reached for it. `|| !gyroMode` covers "already on the finger, I need a way
  // back". Reverting to the old behaviour = `const showFingerOption = true`.
  const [fingerUnlocked, setFingerUnlocked] = useState(false);
  useEffect(() => {
    if (gyroWarn || perm === 'denied' || perm === 'unsupported') {
      setFingerUnlocked(true);
    }
  }, [gyroWarn, perm]);
  const showFingerOption = fingerUnlocked || !gyroMode;

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
    // Having picked it once, keep the card reachable after a back-out.
    setFingerUnlocked(true);
    // Aiming by touch without the picture would have the player firing at the
    // gun panel's coordinates — so the feed comes on with the weapon.
    setStreamOn(true);
    setStep('ready');
  }, []);

  // Hunters held by somebody else. `scores` is the live roster from
  // `shooter_state`, which arrives on `shoot_spectate` — i.e. before this phone
  // has joined, which is exactly when the select screen needs it. Our own row
  // is excluded so re-opening the step never shows our pick as taken.
  const takenCharacterIds = useMemo(
    () =>
      scores
        .filter((p) => p.clientId !== myClientId && p.characterId)
        .map((p) => p.characterId as string),
    [scores, myClientId],
  );
  // A full roster of OTHER players leaves nothing to join. Counted this way so
  // our own row never makes the lobby look full to us.
  const lobbyFull =
    scores.filter((p) => p.clientId !== myClientId).length >=
    MAX_SHOOTER_PLAYERS;
  // Display name of our own pick, for the briefing's loadout row.
  const myCharacterName = characterById(characterId)?.name ?? null;

  // When the phone may actually enter the game: a round is live (jump in), or
  // pure free play (dashboard open range: no match ever armed, ducks flying).
  // 'lobby' (host prepping a round) and 'ended' (next round soon) hold on the
  // briefing screen.
  const canEnterPlay =
    phase === 'countdown' ||
    phase === 'playing' ||
    (phase === 'idle' && targetActive);

  // Commit the chosen name and register with the server right away (the host
  // lobby lists joined hunters and needs players to enable START). The visual
  // switch to the game is owned by the gate effect below.
  const joinAndPlay = useCallback(() => {
    const charId = characterIdRef.current;
    // A slot IS a hunter now, so both gates are checked before we commit. The
    // server refuses either case anyway; catching it here keeps the phone from
    // flipping into "joined" for the half-second until the refusal lands.
    if (!charId) {
      showNotice('Pick your hunter first.');
      setStep('character');
      return;
    }
    if (takenCharacterIds.includes(charId)) {
      setCharacterId(null);
      characterIdRef.current = null;
      sessionRef.current = forgetShooterSession(String(roomId), [
        'characterId',
      ]);
      showNotice('That hunter was taken — pick another.');
      setStep('character');
      return;
    }
    wantsJoinRef.current = true;
    setJoined(true);
    const playerKey = sessionRef.current.playerKey;
    send({
      type: 'shoot_join',
      name: name.trim() || 'Player',
      ...(playerKey ? { playerKey } : {}),
      characterId: charId,
    });
    // If the player enabled their camera earlier, spin up its live input now
    // that they've joined.
    if (camStreamRef.current) sendCamStart();
  }, [send, sendCamStart, name, roomId, takenCharacterIds, showNotice]);

  // Pick (or re-pick) the hunter character: persist it for the next refresh,
  // tell the server if we're already on the roster, and advance the wizard.
  const pickCharacter = useCallback(
    (id: string) => {
      // The card is already disabled when taken; this is the guard against the
      // roster changing between render and tap. The server is still the
      // authority — it answers a lost race with 'character_taken'.
      if (takenCharacterIds.includes(id)) {
        showNotice('That hunter was just taken — pick another.');
        return;
      }
      setCharacterId(id);
      characterIdRef.current = id;
      sessionRef.current = writeShooterSession(String(roomId), {
        characterId: id,
      });
      if (wantsJoinRef.current)
        send({ type: 'shoot_character', characterId: id });
      setStep('weapon');
    },
    [roomId, send, takenCharacterIds, showNotice],
  );

  // Mirror of the arcade's phase-follow: once the player has committed, enter
  // the hunt the moment the gate opens. Restricted to the briefing screen so
  // backing out to re-calibrate is never yanked into play.
  useEffect(() => {
    if (step === 'ready' && joined && canEnterPlay) {
      if (navigator.vibrate) navigator.vibrate(60);
      setStep('play');
    }
  }, [step, joined, canEnterPlay]);

  // Connect + fetch room info on mount; the boot step visualizes both.
  useEffect(() => {
    sessionRef.current = readShooterSession(String(roomId));
    fetchRoom();
    // Re-arm after a StrictMode unmount/remount — the cleanup below set the
    // flag, and without the reset auto-reconnect would stay off for good.
    closedByUsRef.current = false;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (republishTimerRef.current != null) {
        window.clearTimeout(republishTimerRef.current);
        republishTimerRef.current = null;
      }
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      if (fireAlertTimerRef.current != null) {
        window.clearTimeout(fireAlertTimerRef.current);
        fireAlertTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Boot step auto-advances once the room resolved and the radio is up.
  useEffect(() => {
    if (step !== 'connect' || roomStatus !== 'ok' || !connected) return;
    const t = window.setTimeout(
      () => setStep((s) => (s === 'connect' ? 'name' : s)),
      600,
    );
    return () => window.clearTimeout(t);
  }, [step, roomStatus, connected]);

  // Establish the WHEP output stream — only while the player has the feed
  // switched on. Off never opens a peer connection in the first place.
  useEffect(() => {
    if (step !== 'play' || !streamOn || !room?.whepUrl) {
      setWhepState('off');
      return;
    }
    let cancelled = false;
    // The connection THIS run owns. The cleanup has to close this one rather
    // than whatever the shared ref currently holds: on a quick ON→OFF→ON the
    // first run's cleanup would otherwise tear down the second run's link.
    let mine: WhepConnection | null = null;
    setWhepState('linking');
    const whepUrl = resolveMediaUrl(room.whepUrl);
    const watchdog = window.setTimeout(() => {
      if (!cancelled && !mine) setWhepState('failed');
    }, WHEP_WATCHDOG_MS);
    void connectWhep(whepUrl)
      .then((conn) => {
        // StrictMode runs the first cleanup before this resolves — that run
        // closes its own connection here instead of leaking it. (connectWhep
        // takes no AbortSignal, so a cancelled attempt still finishes its
        // fetch before shutting down. Bounded and harmless.)
        if (cancelled) {
          conn.close();
          return;
        }
        mine = conn;
        whepCloseRef.current = conn.close;
        setStream(conn.stream);
        setWhepState('live');
      })
      .catch(() => {
        if (!cancelled) setWhepState('failed');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      mine?.close();
      // Identity guard: only clear the shared handle when it is still ours.
      if (mine && whepCloseRef.current === mine.close) {
        whepCloseRef.current = null;
      }
      setStream(null);
    };
  }, [step, streamOn, room?.whepUrl]);

  // Attach the stream with a callback ref rather than an effect: the <video>
  // is conditionally mounted now, and this ref's identity changes with
  // `stream`, so React drives the detach/attach and a fresh play() itself
  // (muted + playsInline on the element keep iOS autoplay happy).
  const attachOutputVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== stream) {
        el.srcObject = stream;
        if (stream) void el.play().catch(() => {});
      }
    },
    [stream],
  );

  // Cleanup on unmount. Deliberately NO shoot_leave here: an accidental
  // refresh must keep the server-side entry alive so the session's playerKey
  // re-adopts it (score, color, camera); truly gone phones are reaped by the
  // disconnect grace. (The old leave was dead code anyway — the connect
  // effect's cleanup nulled wsRef before this ran.)
  useEffect(() => {
    return () => {
      camPcRef.current?.close();
      camPcRef.current = null;
      whepCloseRef.current?.();
    };
  }, []);

  const fontClass = `${pressStart.variable} ${doto.variable} ${robotoMono.variable}`;

  // Spectator view of the room's output. Relative path, to avoid an SSR/client
  // mismatch on the origin. `?server=` is deliberately left off: it lives in
  // localStorage (see the query-param effect above), which the new tab shares.
  // Opened in a new tab so the panel's socket, camera and playerKey survive.
  const previewHref = `/room-preview/${encodeURIComponent(String(roomId))}`;
  const previewTitle = 'Room preview (opens in a new tab)';

  // ---- Wizard screens -----------------------------------------------------

  if (step !== 'play') {
    const meta = STEP_META[step];
    return (
      <div className={fontClass}>
        <PhoneShell
          stepIndex={meta.index}
          stepCount={STEP_COUNT}
          stepLabel={meta.label}
          compact={step === 'calibrate'}
          topRight={
            <ChipButton
              dense
              href={previewHref}
              title={previewTitle}
              label='👁 PREVIEW'
            />
          }>
          {/* Refusals land on whichever step they send the player to — hunter
              select for a taken pick, the briefing for a kick — so the banner
              lives above the whole wizard rather than on one step. */}
          {notice ? <WarnPanel>{notice}</WarnPanel> : null}
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
              onContinue={() => setStep('character')}
            />
          ) : null}
          {step === 'character' ? (
            <CharacterStep
              selectedId={characterId}
              takenIds={takenCharacterIds}
              onPick={pickCharacter}
            />
          ) : null}
          {step === 'weapon' ? (
            <WeaponStep
              onGyro={() => void pickGyro()}
              onFinger={pickFinger}
              // Not `showFingerOption`: its `|| !gyroMode` half is about the
              // in-game chip, and here nothing has been picked yet — it would
              // put the card back on the very first visit.
              showFinger={fingerUnlocked}
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
              moveSens={moveSens}
              onMoveSens={setMoveSens}
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
            <>
              <ReadyStep
                name={name}
                gyroMode={gyroMode}
                camOn={!!camStream}
                targetActive={targetActive}
                playersCount={scores.length}
                maxPlayers={MAX_SHOOTER_PLAYERS}
                lobbyFull={lobbyFull}
                characterName={myCharacterName}
                match={match}
                joined={joined}
                canEnter={canEnterPlay}
                onJoin={joinAndPlay}
                onBack={() => {
                  // Backing out un-commits the join, so the gate effect can't
                  // yank the player straight back into play mid-recalibration.
                  setJoined(false);
                  wantsJoinRef.current = false;
                  send({ type: 'shoot_leave' });
                  setStep('weapon');
                }}
              />
            </>
          ) : null}
        </PhoneShell>
      </div>
    );
  }

  // ---- The hunt -----------------------------------------------------------

  // Our assigned color (from the scoreboard, matched on our clientId); falls
  // back to the default cyan until the server has told us who we are.
  const myRow = scores.find((s) => s.clientId === myClientId);
  const myColor = myRow?.color ?? '#00f3ff';
  // Read off the scoreboard rather than accumulated from hit events, so it
  // zeroes with the round the moment the server says so.
  const myDogScore = myRow?.dogScore ?? 0;

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
        {/* Feed on: the output stream. Feed off (the default): the gun panel,
            so the phone is a controller instead of a second screen. */}
        {streamOn ? (
          <>
            <video
              ref={attachOutputVideo}
              className='w-full h-full object-contain bg-black pointer-events-none'
              autoPlay
              playsInline
              muted
            />
            {whepState !== 'live' && whepState !== 'off' ? (
              <FeedLinkingCard state={whepState} />
            ) : null}
          </>
        ) : (
          <GunPanel
            connected={connected}
            match={match}
            targetActive={targetActive}
            triggerBlocked={triggerBlocked}
            ammo={ammo}
            maxAmmo={maxAmmo}
            reloadLeftMs={reloadLeftMs}
            reloadMs={reloadMs}
            score={score}
            dogScore={myDogScore}
            myColor={myColor}
            myClientId={myClientId}
            scores={scores}
            streak={streak}
            gyroMode={gyroMode}
            gyroWarn={gyroWarn != null}
            camOn={!!camStream}
            camLive={camLive}
            camVideo={
              camStream ? (
                <video
                  ref={attachCamVideo}
                  autoPlay
                  playsInline
                  muted
                  className='w-9 h-9 rounded-full object-cover border-2 -scale-x-100 pointer-events-none'
                  style={{ borderColor: myColor }}
                />
              ) : undefined
            }
          />
        )}

        {/* Instant local crosshair (server crosshair on the video lags via
            WHEP). Feed mode only — over the panel it would be a crosshair on
            a scoreboard, and the aim it mirrors isn't visible here anyway. */}
        {streamOn && localAim && (
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

        {/* Feed mode only: over the gun panel it would duplicate every readout
            the panel already carries, and its translucent-overlay styling
            reads as a second HUD on an opaque background. */}
        {streamOn ? (
          <PlayTopBar
            connected={connected}
            match={match}
            score={score}
            dogScore={myDogScore}
            myColor={myColor}
            scores={scores}
          />
        ) : null}

        {!connected && wsDbg && (
          // Lower in panel mode, where top-16 would sit on the LED row.
          <div
            className={`absolute left-2 right-2 z-10 ${streamOn ? 'top-16' : 'top-24'}`}>
            <WarnPanel>
              <span style={{ wordBreak: 'break-all' }}>{wsDbg}</span>
            </WarnPanel>
          </div>
        )}
        {/* Bottom message stack: one column so a refused-shot banner and the
            gyro warning can never land on top of each other. z-20 puts it over
            the match overlays (zIndex 7) — a blocked trigger has to stay
            readable on the GAME OVER card, which is the whole point. */}
        {(fireAlert || (gyroMode && gyroWarn)) && (
          <div
            className='absolute bottom-2 left-2 right-2 z-20 flex flex-col gap-2 pointer-events-none'
            role='status'
            aria-live='polite'>
            {fireAlert && (
              <div key={fireAlert.id} className='r5-enter'>
                <WarnPanel tone='bad'>{fireAlert.text}</WarnPanel>
              </div>
            )}
            {gyroMode && gyroWarn && <WarnPanel>{gyroWarn}</WarnPanel>}
          </div>
        )}

        {/* Self view: the camera being shared next to your name. In panel mode
            it lives inside the panel's LED row instead — floating here it
            would cover the standings table. Moving the <video> between the two
            places unmounts it, which attachCamVideo already handles. */}
        {camStream && streamOn && (
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

      <AmmoRow
        ammo={ammo}
        maxAmmo={maxAmmo}
        reloadLeftMs={reloadLeftMs}
        right={
          <ChipButton
            dense
            href={previewHref}
            title={previewTitle}
            label='👁'
          />
        }
      />
      <ControlsRow
        gyroMode={gyroMode}
        showModeToggle={showFingerOption}
        streamOn={streamOn}
        onToggleStream={() => {
          // OFF is always allowed; a second ON while the last one is still
          // linking is ignored, or every impatient tap would mint another
          // RTCPeerConnection.
          if (streamOn) setStreamOn(false);
          else if (whepState !== 'linking') setStreamOn(true);
        }}
        onToggleMode={() => {
          if (gyroMode) {
            // Aiming by touch needs the picture to touch.
            setStreamOn(true);
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
        blocked={triggerBlocked}
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
