'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

const AIM_THROTTLE_MS = 25;
// Gyro: degrees of tilt (from neutral) mapping to half the screen. Larger =
// less sensitive (need more tilt). Divided by the sensitivity slider.
const AIM_RANGE_DEG = 55;
// Exponential smoothing for gyro aim (0..1). Lower = smoother/less jittery.
const GYRO_SMOOTH = 0.14;
// Axis direction for gyro aiming (-1 = inverted so tilt matches crosshair).
const INVERT_X = -1;
const INVERT_Y = -1;
// Tap detection: short press with little movement counts as a shot.
const TAP_MS = 400;
const TAP_MOVE_PX = 16;

type ScoreRow = { clientId: string; name: string; color: string; score: number };
type Rect = { left: number; top: number; width: number; height: number };

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [stage, setStage] = useState<'name' | 'calibrate' | 'play'>('name');
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [score, setScore] = useState(0);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const [localAim, setLocalAim] = useState<{ left: number; top: number } | null>(
    null,
  );
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

  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const whepCloseRef = useRef<(() => void) | null>(null);
  const lastAimSentRef = useRef(0);
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const neutralRef = useRef<{ beta: number; gamma: number } | null>(null);
  const lastRawRef = useRef({ beta: 0, gamma: 0 });
  const smoothRef = useRef({ x: 0.5, y: 0.5 });
  const sensRef = useRef(1);
  const [sensitivity, setSensitivity] = useState(1);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
  }, [searchParams]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

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
    send({ type: 'shoot_fire' });
  }, [send]);

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
    if (stage === 'name') return;
    if (stage === 'play' && !gyroMode) return;
    gyroLiveRef.current = false;
    smoothRef.current = { x: 0.5, y: 0.5 };
    setGyroWarn(null);
    let count = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      count += 1;
      const beta = e.beta;
      const gamma = e.gamma;
      setOrient({ b: beta, g: gamma, n: count });
      if (beta == null && gamma == null) return;
      gyroLiveRef.current = true;
      const b = beta ?? 0;
      const g = gamma ?? 0;
      lastRawRef.current = { beta: b, gamma: g };
      if (!neutralRef.current) neutralRef.current = { beta: b, gamma: g };
      if (!aiming) return; // calibration: just read, don't aim
      const range = AIM_RANGE_DEG / Math.max(0.2, sensRef.current);
      const rawX = clamp01(0.5 + (INVERT_X * (g - neutralRef.current.gamma)) / (2 * range));
      const rawY = clamp01(0.5 + (INVERT_Y * (b - neutralRef.current.beta)) / (2 * range));
      // Low-pass filter to kill sensor jitter.
      const s = smoothRef.current;
      s.x += (rawX - s.x) * GYRO_SMOOTH;
      s.y += (rawY - s.y) * GYRO_SMOOTH;
      sendAim(s.x, s.y);
      setLocalAim(normToLocal(s.x, s.y));
    };
    // Some Android devices only emit the "absolute" variant.
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientationabsolute', onOrient);
    // If nothing arrives shortly, the sensor is blocked or not permitted.
    const warnTimer = window.setTimeout(() => {
      if (!gyroLiveRef.current) {
        setGyroWarn(
          !window.isSecureContext
            ? 'Żyroskop wymaga HTTPS.'
            : perm === 'denied'
              ? 'Odmówiono dostępu do czujnika ruchu — włącz w ustawieniach przeglądarki.'
              : 'Brak danych z żyroskopu (0 zdarzeń) — sprawdź uprawnienia/ustawienia ruchu.',
        );
      }
    }, 1500);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('deviceorientationabsolute', onOrient);
      window.clearTimeout(warnTimer);
    };
  }, [stage, gyroMode, aiming, sendAim, normToLocal, perm]);

  const connectWs = useCallback(
    (playerName: string) => {
      const ro = remoteOrigin();
      const base = toWsUrl(ro ?? getEffectiveClientServerUrl());
      const url = `${base}/room/${encodeURIComponent(String(roomId))}/ws`;
      setWsDbg(`łączę: ${url}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setWsDbg('');
        ws.send(JSON.stringify({ type: 'shoot_join', name: playerName }));
      };
      ws.onerror = () => setWsDbg(`błąd WS: ${url}`);
      ws.onclose = (ev) => {
        setConnected(false);
        setWsDbg(`WS zamknięty (${ev.code}) — czy tunel celuje w Caddy :8080? ${url}`);
      };
      ws.onmessage = (ev) => {
        let data: unknown;
        try {
          data = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        const m = data as { type?: string };
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
        }
      };
    },
    [roomId],
  );

  const start = useCallback(async () => {
    // Ask for motion permission from this user gesture (iOS needs it).
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        })
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        setPerm(res === 'granted' ? 'granted' : 'denied');
      } catch {
        setPerm('denied');
      }
    } else if (typeof window.DeviceOrientationEvent === 'undefined') {
      setPerm('unsupported');
    } else {
      setPerm('default');
    }

    const info = await getRoomInfo(String(roomId));
    if (info && info !== 'not-found') setRoom(info);

    connectWs(name.trim() || 'Player');
    neutralRef.current = null; // recalibrate on the calibration screen
    setStage('calibrate');
  }, [connectWs, name, roomId]);

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
      wsRef.current?.close();
      whepCloseRef.current?.();
    };
  }, [send]);

  if (stage === 'name') {
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-6 p-6'>
        <h1 className='text-3xl font-bold'>🎯 Ghost Shooter</h1>
        <p className='text-sm text-neutral-400 text-center max-w-xs'>
          Celuj żyroskopem lub palcem po obrazie — tapnij duszka, aby strzelić.
          (Ustaw input z duszkami na pełny ekran dla celności.)
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Twoje imię'
          className='w-full max-w-xs rounded-lg bg-neutral-900 border border-neutral-700 px-4 py-3 text-center'
        />
        <button
          onClick={() => void start()}
          className='w-full max-w-xs rounded-lg bg-[#00f3ff] text-black font-bold py-4 text-lg active:scale-95 transition-transform'>
          START
        </button>
      </div>
    );
  }

  if (stage === 'calibrate') {
    const sensorLive = orient.n > 0 && (orient.b != null || orient.g != null);
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-5 p-6 text-center'>
        <h2 className='text-2xl font-bold'>Kalibracja</h2>
        <p className='text-sm text-neutral-400 max-w-xs'>
          Trzymaj telefon tak, jak podczas gry (celując w środek ekranu), i
          kliknij <span className='text-neutral-100'>Kalibruj i graj</span>.
        </p>

        {/* Live crosshair preview so you can see the sensor react. */}
        <div className='relative w-56 h-40 rounded-lg border border-neutral-700 bg-neutral-900 overflow-hidden'>
          <CalibPreview orient={orient} neutral={neutralRef.current} />
        </div>

        <div className='text-[11px] font-mono text-cyan-300'>
          perm:{perm} · zdarzeń:{orient.n} · β:
          {orient.b == null ? '—' : orient.b.toFixed(0)} · γ:
          {orient.g == null ? '—' : orient.g.toFixed(0)}
        </div>
        {gyroWarn && (
          <div className='rounded bg-amber-500/90 text-black text-xs px-3 py-2 max-w-xs'>
            {gyroWarn}
          </div>
        )}

        <div className='flex flex-col gap-3 w-full max-w-xs'>
          <button
            disabled={!sensorLive}
            onClick={() => {
              neutralRef.current = { ...lastRawRef.current };
              setGyroMode(true);
              setStage('play');
            }}
            className={`w-full rounded-lg py-4 text-lg font-bold transition-transform active:scale-95 ${
              sensorLive
                ? 'bg-[#00f3ff] text-black'
                : 'bg-neutral-800 text-neutral-500'
            }`}>
            🎯 Kalibruj i graj
          </button>
          <button
            onClick={() => {
              setGyroMode(false);
              setStage('play');
            }}
            className='w-full rounded-lg bg-neutral-800 text-white py-3'>
            👆 Graj palcem
          </button>
        </div>
      </div>
    );
  }

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
            <div className='absolute inset-0 rounded-full border-2 border-[#00f3ff]' />
            <div className='absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#00f3ff]' />
            <div className='absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2 bg-[#00f3ff]' />
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
          <span className='font-mono'>Wynik: {score}</span>
        </div>
        {!connected && wsDbg && (
          <div className='absolute top-16 left-2 right-2 rounded bg-black/70 text-amber-300 text-[10px] px-2 py-1 text-center break-all pointer-events-none'>
            {wsDbg}
          </div>
        )}
        {scores.length > 0 && (
          <div className='absolute top-9 left-0 right-0 px-3 flex flex-wrap gap-2 text-xs pointer-events-none'>
            {scores.map((s) => (
              <span key={s.clientId} style={{ color: s.color }} className='font-mono'>
                {s.name}: {s.score}
              </span>
            ))}
          </div>
        )}
        {gyroMode && (
          <div className='absolute bottom-2 left-2 rounded bg-black/70 text-cyan-300 text-[10px] font-mono px-2 py-1 pointer-events-none'>
            perm:{perm} · zdarzeń:{orient.n} · β:
            {orient.b == null ? '—' : orient.b.toFixed(0)} · γ:
            {orient.g == null ? '—' : orient.g.toFixed(0)}
          </div>
        )}
        {gyroMode && gyroWarn && (
          <div className='absolute bottom-9 left-2 right-2 rounded bg-amber-500/90 text-black text-xs px-3 py-2 text-center pointer-events-none'>
            {gyroWarn}
          </div>
        )}
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
            const DOE = window.DeviceOrientationEvent as
              | (typeof DeviceOrientationEvent & {
                  requestPermission?: () => Promise<'granted' | 'denied'>;
                })
              | undefined;
            if (DOE && typeof DOE.requestPermission === 'function') {
              try {
                const res = await DOE.requestPermission();
                setPerm(res === 'granted' ? 'granted' : 'denied');
              } catch {
                setPerm('denied');
              }
            } else if (typeof window.DeviceOrientationEvent === 'undefined') {
              setPerm('unsupported');
            } else {
              setPerm('default'); // Android/desktop: no explicit prompt.
            }
            neutralRef.current = null; // recalibrate center on first reading
            setGyroWarn(null);
            setOrient({ b: null, g: null, n: 0 });
            setGyroMode(true);
          }}
          className={`rounded px-3 py-2 text-xs ${
            gyroMode ? 'bg-[#00f3ff] text-black' : 'bg-neutral-800 text-white'
          }`}>
          {gyroMode ? '🎯 Żyroskop' : '👆 Palec'}
        </button>
        {gyroMode && (
          <input
            type='range'
            min={0.4}
            max={2.5}
            step={0.1}
            value={sensitivity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSensitivity(v);
              sensRef.current = v;
            }}
            className='flex-1'
          />
        )}
        <button
          onPointerDown={fire}
          className='flex-1 rounded-xl bg-[#ff3b3b] text-white font-extrabold py-4 text-xl active:scale-95 transition-transform'>
          STRZAŁ 🔫
        </button>
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Calibration preview: a crosshair that moves with the sensor so you can see
// it reacting before entering the game.
function CalibPreview({
  orient,
  neutral,
}: {
  orient: { b: number | null; g: number | null; n: number };
  neutral: { beta: number; gamma: number } | null;
}) {
  const b = orient.b ?? 0;
  const g = orient.g ?? 0;
  const nb = neutral?.beta ?? b;
  const ng = neutral?.gamma ?? g;
  const x = clamp01(0.5 + (INVERT_X * (g - ng)) / (2 * AIM_RANGE_DEG));
  const y = clamp01(0.5 + (INVERT_Y * (b - nb)) / (2 * AIM_RANGE_DEG));
  return (
    <div
      className='absolute w-7 h-7'
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}>
      <div className='absolute inset-0 rounded-full border-2 border-[#00f3ff]' />
      <div className='absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#00f3ff]' />
      <div className='absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2 bg-[#00f3ff]' />
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
