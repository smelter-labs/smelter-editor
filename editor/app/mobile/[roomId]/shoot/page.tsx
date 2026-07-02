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
// Gyro fallback: degrees of tilt (from neutral) that map to half the screen.
const AIM_RANGE_DEG = 35;
// Tap detection: short press with little movement counts as a shot.
const TAP_MS = 400;
const TAP_MOVE_PX = 16;

type ScoreRow = { clientId: string; name: string; color: string; score: number };
type Rect = { left: number; top: number; width: number; height: number };

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [started, setStarted] = useState(false);
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
  const [gyroAvailable, setGyroAvailable] = useState(false);
  const [gyroWarn, setGyroWarn] = useState<string | null>(null);
  const gyroLiveRef = useRef(false);

  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const whepCloseRef = useRef<(() => void) | null>(null);
  const lastAimSentRef = useRef(0);
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const neutralRef = useRef<{ beta: number; gamma: number } | null>(null);
  const lastRawRef = useRef({ beta: 0, gamma: 0 });
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

  // Gyro fallback aiming (optional toggle).
  useEffect(() => {
    if (!started || !gyroMode) return;
    gyroLiveRef.current = false;
    setGyroWarn(null);
    const onOrient = (e: DeviceOrientationEvent) => {
      // Some browsers deliver an all-null event; ignore until real data.
      if (e.beta == null && e.gamma == null) return;
      gyroLiveRef.current = true;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      lastRawRef.current = { beta, gamma };
      if (!neutralRef.current) neutralRef.current = { beta, gamma };
      const range = AIM_RANGE_DEG / Math.max(0.2, sensRef.current);
      const x = clamp01(0.5 + (gamma - neutralRef.current.gamma) / (2 * range));
      const y = clamp01(0.5 + (beta - neutralRef.current.beta) / (2 * range));
      sendAim(x, y);
      setLocalAim(normToLocal(x, y));
    };
    window.addEventListener('deviceorientation', onOrient);
    // If nothing arrives shortly, the sensor is blocked (usually insecure http).
    const warnTimer = window.setTimeout(() => {
      if (!gyroLiveRef.current) {
        setGyroWarn(
          window.isSecureContext
            ? 'Brak danych z żyroskopu na tym urządzeniu.'
            : 'Żyroskop wymaga HTTPS — użyj celowania palcem (lub otwórz przez https/tunel).',
        );
      }
    }, 1200);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.clearTimeout(warnTimer);
    };
  }, [started, gyroMode, sendAim, normToLocal]);

  const connectWs = useCallback(
    (playerName: string) => {
      const base = toWsUrl(getEffectiveClientServerUrl());
      const url = `${base}/room/${encodeURIComponent(String(roomId))}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'shoot_join', name: playerName }));
      };
      ws.onclose = () => setConnected(false);
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
    // Probe gyroscope availability (and iOS permission) but don't require it.
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        })
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        setGyroAvailable((await DOE.requestPermission()) === 'granted');
      } catch {
        setGyroAvailable(false);
      }
    } else {
      setGyroAvailable(typeof window.DeviceOrientationEvent !== 'undefined');
    }

    const info = await getRoomInfo(String(roomId));
    if (info && info !== 'not-found') setRoom(info);

    connectWs(name.trim() || 'Player');
    setStarted(true);
  }, [connectWs, name, roomId]);

  // Establish the WHEP output stream once we have the room's whepUrl.
  useEffect(() => {
    if (!started || !room?.whepUrl) return;
    let cancelled = false;
    void connectWhep(room.whepUrl)
      .then((conn) => {
        if (cancelled) {
          conn.close();
          return;
        }
        whepCloseRef.current = conn.close;
        if (videoRef.current) videoRef.current.srcObject = conn.stream;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      whepCloseRef.current?.();
      whepCloseRef.current = null;
    };
  }, [started, room?.whepUrl]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      send({ type: 'shoot_leave' });
      wsRef.current?.close();
      whepCloseRef.current?.();
    };
  }, [send]);

  if (!started) {
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-6 p-6'>
        <h1 className='text-3xl font-bold'>🎯 Ghost Shooter</h1>
        <p className='text-sm text-neutral-400 text-center max-w-xs'>
          Zobaczysz obraz z gry i celujesz palcem po ekranie — tapnij duszka, aby
          strzelić. (Ustaw input z duszkami na pełny ekran dla celności.)
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
        {scores.length > 0 && (
          <div className='absolute top-9 left-0 right-0 px-3 flex flex-wrap gap-2 text-xs pointer-events-none'>
            {scores.map((s) => (
              <span key={s.clientId} style={{ color: s.color }} className='font-mono'>
                {s.name}: {s.score}
              </span>
            ))}
          </div>
        )}
        {gyroMode && gyroWarn && (
          <div className='absolute bottom-2 left-2 right-2 rounded bg-amber-500/90 text-black text-xs px-3 py-2 text-center pointer-events-none'>
            {gyroWarn}
          </div>
        )}
      </div>

      {/* Controls. */}
      <div className='p-3 flex items-center gap-3 bg-[#0a0a0a]'>
        <button
          onClick={() => {
            // Re-request iOS permission on demand (needs a user gesture).
            const DOE = window.DeviceOrientationEvent as
              | (typeof DeviceOrientationEvent & {
                  requestPermission?: () => Promise<'granted' | 'denied'>;
                })
              | undefined;
            if (!gyroMode && DOE && typeof DOE.requestPermission === 'function') {
              void DOE.requestPermission().catch(() => {});
            }
            neutralRef.current = { ...lastRawRef.current };
            setGyroWarn(null);
            setGyroMode((v) => !v);
          }}
          className={`rounded px-3 py-2 text-xs ${
            gyroMode ? 'bg-[#00f3ff] text-black' : 'bg-neutral-800 text-white'
          } ${gyroAvailable ? '' : 'opacity-70'}`}>
          {gyroMode ? 'Żyroskop' : 'Palec'}
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
