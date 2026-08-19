'use client';

import React from 'react';
import type { KbtMatchEvent } from '@smelter-editor/types';
import {
  BlueprintBackdrop,
  R5,
  ledFont,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * The in-heat screen, readable from 2–3 m: a giant score, the clock, the
 * detected exercise and streak. The athlete never touches the phone here —
 * it is the camera; this is pure feedback (plus a flash/beep per rep from
 * the page). Keeps the local camera preview alive underneath at low opacity
 * so the publish track keeps flowing and framing drift stays visible.
 */
export function LiveHud({
  match,
  points,
  reps,
  streak,
  exercise,
  color,
  remainingMs,
  flash,
  attachVideo,
  facing,
}: {
  match: KbtMatchEvent | null;
  points: number;
  reps: number;
  streak: number;
  exercise: string;
  color: string;
  remainingMs: number | null;
  flash: 'good' | 'bad' | null;
  attachVideo: (el: HTMLVideoElement | null) => void;
  facing: 'user' | 'environment';
}) {
  const phase = match?.phase ?? 'playing';
  const countdownN =
    phase === 'countdown' && remainingMs != null
      ? Math.max(1, Math.ceil(remainingMs / 1000))
      : null;
  const clockDanger =
    phase === 'playing' && remainingMs != null && remainingMs <= 10_000;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: R5.bgDeep,
        overflow: 'hidden',
        color: R5.ink,
      }}>
      <BlueprintBackdrop />
      {/* Dim self-view: keeps the camera pipeline warm + shows framing. */}
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.22,
          transform: facing === 'user' ? 'scaleX(-1)' : undefined,
        }}
      />
      {flash ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: `10px solid ${flash === 'bad' ? R5.red : color}`,
            boxShadow: `inset 0 0 60px ${flash === 'bad' ? R5.red : color}`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding:
            'calc(env(safe-area-inset-top, 0px) + 10px) 16px calc(env(safe-area-inset-bottom, 0px) + 10px)',
        }}>
        <div
          style={{
            fontFamily: ledFont,
            fontWeight: 900,
            fontSize: 'min(18vw, 12vh)',
            color: clockDanger ? R5.red : R5.ink,
            textShadow: clockDanger ? `0 0 24px ${R5.red}` : undefined,
          }}
          className={clockDanger ? 'r5-blink' : undefined}>
          {phase === 'ended'
            ? 'TIME!'
            : remainingMs != null
              ? formatClock(remainingMs)
              : '--:--'}
        </div>
        {countdownN != null ? (
          <div
            style={{
              fontFamily: ledFont,
              fontWeight: 900,
              fontSize: 'min(55vw, 40vh)',
              lineHeight: 1,
              color: R5.yellow,
              textShadow: `0 0 40px rgba(${R5.yellowRgb},0.8)`,
            }}>
            {countdownN}
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: ledFont,
                fontWeight: 900,
                fontSize: 'min(42vw, 34vh)',
                lineHeight: 1,
                color,
                textShadow: `0 0 36px ${color}`,
              }}>
              {points}
            </div>
            <div
              style={{
                fontFamily: pixelFont,
                fontSize: 'min(3.6vw, 14px)',
                letterSpacing: 2,
                color: R5.inkMuted,
              }}>
              POINTS
            </div>
          </>
        )}
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'baseline',
            fontFamily: monoFont,
            fontSize: 'min(4.5vw, 16px)',
            color: R5.ink,
          }}>
          <span>
            REPS <b style={{ fontFamily: ledFont }}>{reps}</b>
          </span>
          <span style={{ color: R5.cyan }}>
            {exercise === 'idle' ? '—' : exercise.toUpperCase()}
          </span>
          {streak >= 3 ? (
            <span style={{ color: R5.green }}>x{streak}</span>
          ) : null}
        </div>
      </div>
      <div className='r5-scanlines' />
    </div>
  );
}
