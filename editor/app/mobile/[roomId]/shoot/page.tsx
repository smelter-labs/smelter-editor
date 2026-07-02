'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

// Degrees of tilt (from the recentered neutral) that map to half the screen.
// Smaller = more sensitive. Scaled by the sensitivity slider.
const AIM_RANGE_DEG = 35;
const AIM_THROTTLE_MS = 25;

type ScoreRow = { clientId: string; name: string; color: string; score: number };

export default function ShootControllerPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [started, setStarted] = useState(false);
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [gyroOk, setGyroOk] = useState(false);
  const [score, setScore] = useState(0);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const neutralRef = useRef<{ beta: number; gamma: number } | null>(null);
  const lastRawRef = useRef<{ beta: number; gamma: number }>({ beta: 0, gamma: 0 });
  const lastAimSentRef = useRef(0);
  const sensRef = useRef(1);
  const [sensitivity, setSensitivity] = useState(1);

  // Apply the ?server=... param so getEffectiveClientServerUrl() is correct.
  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
  }, [searchParams]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const sendAim = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastAimSentRef.current < AIM_THROTTLE_MS) return;
      lastAimSentRef.current = now;
      send({ type: 'shoot_aim', x, y });
    },
    [send],
  );

  const fire = useCallback(() => {
    send({ type: 'shoot_fire' });
  }, [send]);

  const recenter = useCallback(() => {
    neutralRef.current = { ...lastRawRef.current };
  }, []);

  // Gyroscope aiming.
  useEffect(() => {
    if (!started || !gyroOk) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0; // front-back tilt
      const gamma = e.gamma ?? 0; // left-right tilt
      lastRawRef.current = { beta, gamma };
      if (!neutralRef.current) neutralRef.current = { beta, gamma };
      const range = AIM_RANGE_DEG / Math.max(0.2, sensRef.current);
      const dx = (gamma - neutralRef.current.gamma) / (2 * range);
      const dy = (beta - neutralRef.current.beta) / (2 * range);
      const x = clamp01(0.5 + dx);
      const y = clamp01(0.5 + dy); // tilt top away -> aim up
      sendAim(x, y);
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [started, gyroOk, sendAim]);

  const connect = useCallback(
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
          window.setTimeout(() => setFlash(null), 250);
        } else if (m.type === 'shooter_miss') {
          setFlash('miss');
          window.setTimeout(() => setFlash(null), 150);
        } else if (m.type === 'shooter_state') {
          setScores((data as { players: ScoreRow[] }).players ?? []);
        }
      };
    },
    [roomId],
  );

  const start = useCallback(async () => {
    // iOS requires an explicit, user-gesture-triggered permission request.
    let granted = true;
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        })
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        granted = (await DOE.requestPermission()) === 'granted';
      } catch {
        granted = false;
      }
    } else {
      granted = typeof window.DeviceOrientationEvent !== 'undefined';
    }
    setGyroOk(granted);
    connect(name.trim() || 'Player');
    setStarted(true);
  }, [connect, name]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      send({ type: 'shoot_leave' });
      wsRef.current?.close();
    };
  }, [send]);

  // Touch-drag fallback aiming (no gyroscope / permission denied / desktop).
  const onTouchAim = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      if (gyroOk) return;
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const pt =
        'touches' in e && e.touches.length
          ? e.touches[0]
          : (e as React.MouseEvent);
      const x = clamp01((pt.clientX - rect.left) / rect.width);
      const y = clamp01((pt.clientY - rect.top) / rect.height);
      sendAim(x, y);
    },
    [gyroOk, sendAim],
  );

  if (!started) {
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-6 p-6'>
        <h1 className='text-3xl font-bold'>🎯 Ghost Shooter</h1>
        <p className='text-sm text-neutral-400 text-center max-w-xs'>
          Przechyl telefonem, aby celować w duszki, i naciśnij STRZAŁ. Wymaga
          zgody na czujnik ruchu (i HTTPS na iOS).
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
    <div
      className={`min-h-screen w-full flex flex-col select-none touch-none transition-colors ${
        flash === 'hit'
          ? 'bg-green-600'
          : flash === 'miss'
            ? 'bg-red-900'
            : 'bg-[#0a0a0a]'
      }`}
      onTouchStart={onTouchAim}
      onTouchMove={onTouchAim}
      onMouseMove={(e) => e.buttons === 1 && onTouchAim(e)}>
      <header className='flex items-center justify-between p-3 text-white text-sm'>
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? '● online' : '○ offline'}
        </span>
        <span className='font-mono'>Wynik: {score}</span>
      </header>

      <div className='px-3 text-white text-xs'>
        {scores.length > 0 && (
          <div className='flex flex-wrap gap-2'>
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
        {!gyroOk && (
          <p className='text-amber-400 mt-2'>
            Brak żyroskopu — celuj przeciągając palcem po ekranie.
          </p>
        )}
      </div>

      <div className='flex-1' />

      <div className='p-4 flex flex-col gap-3'>
        <div className='flex items-center gap-3 text-white text-xs'>
          <span>Czułość</span>
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
          <button
            onClick={recenter}
            className='rounded bg-neutral-800 text-white px-3 py-1'>
            Wyśrodkuj
          </button>
        </div>
        <button
          onPointerDown={fire}
          className='rounded-2xl bg-[#ff3b3b] text-white font-extrabold py-8 text-2xl active:scale-95 transition-transform'>
          STRZAŁ 🔫
        </button>
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
