'use client';

import React from 'react';
import type { KbtMatchEvent } from '@smelter-editor/types';
import { KETTLEBELL_ISSUE_LABELS } from '@smelter-editor/types';
import {
  Backdrop,
  DisplayText,
  KBT,
  Label,
  Num,
  Tab,
  displayFont,
  kbtMonoFont,
} from '../kbt-kit';
import type { KbtRepLogEntry } from './heat-report';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * The in-heat screen, readable from 2–3 m: a giant score, the clock, the
 * last judged rep (exercise + verdict + fault) and streak. The athlete never
 * touches the phone here — it is the camera; this is pure feedback (plus a
 * flash/beep per rep from the page). Keeps the local camera preview alive
 * underneath at low opacity so the publish track keeps flowing and framing
 * drift stays visible.
 */
export function LiveHud({
  match,
  points,
  reps,
  streak,
  lastRep,
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
  lastRep: KbtRepLogEntry | null;
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
        background: KBT.page,
        overflow: 'hidden',
        color: KBT.cream,
      }}>
      <Backdrop />
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
            border: `10px solid ${flash === 'bad' ? KBT.bad : KBT.good}`,
            background:
              flash === 'bad' ? 'rgba(255,64,48,.16)' : 'rgba(56,224,138,.14)',
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
          gap: 10,
          padding:
            'calc(env(safe-area-inset-top, 0px) + 10px) 16px calc(env(safe-area-inset-bottom, 0px) + 10px)',
        }}>
        <span
          className={clockDanger ? 'kbt-blink' : undefined}
          style={{ display: 'inline-block' }}>
          <Num
            size={48}
            weight={600}
            color={clockDanger ? KBT.bad : KBT.cream}
            style={{ fontSize: 'min(16vw, 11vh)' }}>
            {phase === 'ended'
              ? 'TIME!'
              : remainingMs != null
                ? formatClock(remainingMs)
                : '--:--'}
          </Num>
        </span>
        {countdownN != null ? (
          <DisplayText
            size={200}
            weight={800}
            color={KBT.amber}
            style={{ fontSize: 'min(55vw, 40vh)', lineHeight: 1 }}>
            {countdownN}
          </DisplayText>
        ) : (
          <>
            <DisplayText
              size={140}
              weight={800}
              color={KBT.cream}
              style={{ fontSize: 'min(40vw, 32vh)', lineHeight: 0.9 }}>
              {points}
            </DisplayText>
            {/* Player color as the accent bar under the score. */}
            <div style={{ width: 64, height: 4, background: color }} />
            <Label size={12} tracking={4}>
              POINTS
            </Label>
          </>
        )}
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            fontFamily: kbtMonoFont,
            fontSize: 'min(4.5vw, 16px)',
            color: KBT.cream,
          }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 7,
            }}>
            <Label size={11} tracking={2} color={KBT.dim}>
              REPS
            </Label>
            <span
              style={{
                fontFamily: displayFont,
                fontWeight: 700,
                fontSize: '1.35em',
              }}>
              {reps}
            </span>
          </span>
          {lastRep == null ? (
            <Label size={11} tracking={2} color={KBT.dim}>
              —
            </Label>
          ) : (
            <Tab
              size={11}
              color={lastRep.verdict === 'incorrect' ? KBT.bad : KBT.good}>
              {lastRep.exercise.toUpperCase()}{' '}
              {lastRep.verdict === 'incorrect' ? '✗' : '✓'}
            </Tab>
          )}
          {streak >= 3 ? (
            <Label size={12} tracking={2} weight={600} color={KBT.good}>
              x{streak}
            </Label>
          ) : null}
        </div>
        {/* Fixed-height fault line so rows don't jump when a fault appears. */}
        <div
          style={{
            minHeight: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}>
          {lastRep?.verdict === 'incorrect' && lastRep.issues.length > 0 ? (
            <Label size={10} tracking={1} color={KBT.bad}>
              {KETTLEBELL_ISSUE_LABELS[lastRep.issues[0]] ?? lastRep.issues[0]}
            </Label>
          ) : null}
        </div>
      </div>
    </div>
  );
}
