'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  ConfirmRail,
  DisplayText,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
  WarnPlate,
  useArmed,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import { KbtAvatar } from '../avatar';
import { ScoreChip } from '../score-chip';
import type { KbtFeed } from '../use-kbt-feed';
import type { KbtRoom } from '../use-kbt-room';

/**
 * The live heat: fullscreen WHEP of the composited output (camera tiles,
 * skeletons, scores and the heat clock are burned in server-side) with slim
 * host chrome. During the intro it overlays the pose checklist + BEGIN; the
 * chrome clock mirrors the *live* server clock (the video runs ~3s behind —
 * the burned-in clock is the one synced to what viewers see).
 */
export function HeatScreen({
  room,
  feed,
  onBegin,
  onForceBegin,
  onKick,
  onRestart,
  onAbort,
}: {
  room: KbtRoom;
  feed: KbtFeed;
  onBegin: () => void;
  /** Start despite unready lifters (dead phone) — host's explicit override. */
  onForceBegin?: () => void;
  /** Drop a participant so the show can go on without them. */
  onKick?: (clientId: string) => void;
  /** Re-run a heat that never finished (back to a fresh intro). */
  onRestart?: () => void;
  onAbort: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rail = useArmed(5000);
  const kick = useArmed(3000);
  const [feedDown, setFeedDown] = useState(false);

  // WHEP with self-heal: a failed handshake or a died track used to leave a
  // black screen forever — retry with backoff and say what's happening.
  useEffect(() => {
    const whepUrl = room.whepUrl;
    if (!whepUrl) return;
    let cancelled = false;
    let closeConnection = () => {};
    let retryTimer: number | null = null;
    let delay = 1000;
    const schedule = () => {
      if (cancelled || retryTimer != null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
      delay = Math.min(8000, delay * 2);
    };
    const connect = () => {
      if (cancelled) return;
      void connectWhep(whepUrl)
        .then(({ stream, close }) => {
          if (cancelled) {
            close();
            return;
          }
          closeConnection = close;
          setFeedDown(false);
          delay = 1000;
          const vid = videoRef.current;
          if (vid && vid.srcObject !== stream) {
            vid.srcObject = stream;
            vid.play().catch(() => {});
          }
          stream.getVideoTracks()[0]?.addEventListener('ended', () => {
            if (cancelled) return;
            setFeedDown(true);
            closeConnection();
            schedule();
          });
        })
        .catch(() => {
          if (cancelled) return;
          setFeedDown(true);
          schedule();
        });
    };
    connect();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      closeConnection();
    };
  }, [room.whepUrl]);

  // 4 Hz chrome clock anchored on the authoritative match timestamps.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);

  const match = feed.match;
  const phase = match?.phase ?? 'intro';
  const heat =
    match?.heatIndex != null ? feed.state?.heats[match.heatIndex] : null;
  const players = feed.state?.players ?? [];
  const heatPlayers = (heat?.playerIds ?? []).map(
    (id) => players.find((p) => p.clientId === id) ?? null,
  );
  // Mirrors the server's begin_heat gate: briefing reached + live camera.
  const allReady = heatPlayers.every(
    (p) => p?.briefed && p?.camConnected && p?.connected !== false,
  );
  const waitingNames = heatPlayers
    .filter((p) => !p || !p.briefed || !p.camConnected || p.connected === false)
    .map((p) => p?.name ?? '?');
  const heatLabel = match?.final
    ? 'FINAL'
    : match?.heatIndex != null
      ? `HEAT ${match.heatIndex + 1}`
      : 'HEAT';

  useArcadeKeys({
    back: () => (rail.armed === 'stop' ? rail.disarm() : rail.arm('stop')),
    confirm: () => {
      if (rail.armed === 'stop') {
        rail.disarm();
        onAbort();
      } else if (phase === 'intro' && allReady) {
        onBegin();
      }
    },
  });

  const now = Date.now();
  let clockLabel = '';
  let clockColor: string = KBT.cream;
  let urgent = false;
  if (phase === 'countdown') {
    const left = Math.max(0, (match?.startsAtMs ?? now) - now);
    clockLabel = `GET SET ${Math.max(1, Math.ceil(left / 1000))}`;
    clockColor = KBT.good;
  } else if (phase === 'playing') {
    const left = Math.max(0, (match?.endsAtMs ?? now) - now);
    const total = Math.round(left / 1000);
    clockLabel = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    clockColor = KBT.good;
    if (left <= 10_000) {
      clockColor = KBT.bad;
      urgent = true;
    }
  } else if (phase === 'ended') {
    clockLabel = 'TIME!';
    clockColor = KBT.bad;
  }

  // Live score chips from the 1 Hz match scores.
  const rows = Object.entries(match?.scores ?? {})
    .map(([clientId, s]) => ({ clientId, ...s }))
    .sort((a, b) => b.points - a.points);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000',
        overflow: 'hidden',
      }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />

      {feedDown ? (
        <div
          className='kbt-pulse'
          style={{
            position: 'absolute',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
          }}>
          <WarnPlate>PROGRAM FEED LOST — RECONNECTING…</WarnPlate>
        </div>
      ) : null}

      {/* Top chrome: heat label + live clock + score chips. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          background:
            'linear-gradient(180deg, rgba(13,14,16,.85), rgba(13,14,16,0))',
        }}>
        <Tab size={11}>{heatLabel}</Tab>
        <Num size={28} color={clockColor}>
          <span className={urgent ? 'kbt-blink' : undefined}>{clockLabel}</span>
        </Num>
        <div style={{ flex: 1 }} />
        {rows.map((r) => (
          <ScoreChip
            key={r.clientId}
            large
            name={r.name}
            color={r.color}
            photoUrl={r.photoUrl}
            points={r.points}
          />
        ))}
      </div>

      {/* Intro overlay: pose checklist + BEGIN. */}
      {phase === 'intro' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(13,14,16,.6)',
          }}>
          <Plate
            cutPx={22}
            accentBar
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: '24px 28px',
              minWidth: 420,
            }}>
            <PlateTitle>{`${heatLabel} — ON THE PLATFORM`}</PlateTitle>
            {heatPlayers.map((p, i) => {
              if (!p) {
                return (
                  <Label key={`missing-${i}`} size={11} tracking={1.5}>
                    (lifter left — abort the heat)
                  </Label>
                );
              }
              // Absent on older servers = assume connected.
              const offline = p.connected === false;
              const ready =
                !offline && p.briefed && p.camConnected && p.poseTracked;
              const state: 'good' | 'warn' | 'bad' = ready
                ? 'good'
                : offline || (p.briefed && !p.camConnected)
                  ? 'bad'
                  : 'warn';
              const text = offline
                ? 'OFFLINE'
                : !p.briefed
                  ? 'ON THE PHONE…'
                  : !p.camConnected
                    ? 'SIGNAL LOST'
                    : !p.poseTracked
                      ? 'STEP INTO FRAME'
                      : 'READY ✓';
              const blocking = offline || !p.briefed || !p.camConnected;
              return (
                <div
                  key={p.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                  }}>
                  <KbtAvatar
                    name={p.name}
                    color={p.color}
                    photoUrl={p.photoUrl}
                    size={28}
                  />
                  <DisplayText
                    size={20}
                    weight={700}
                    tracking={1.5}
                    style={{ flex: 1 }}>
                    {p.name}
                  </DisplayText>
                  <StatusDot state={state} pulse={state === 'warn'} />
                  <Label
                    size={10}
                    tracking={1.5}
                    color={
                      state === 'good'
                        ? KBT.good
                        : state === 'bad'
                          ? KBT.bad
                          : KBT.amber
                    }>
                    <span className={ready ? undefined : 'kbt-blink'}>
                      {text}
                    </span>
                  </Label>
                  {blocking && onKick ? (
                    <KbtButton
                      variant='danger'
                      dense
                      active={kick.armed === p.clientId}
                      label={kick.armed === p.clientId ? 'KICK?' : 'KICK'}
                      title={`Remove ${p.name} so the heat can start without them`}
                      onClick={() => {
                        if (kick.armed === p.clientId) {
                          kick.disarm();
                          onKick(p.clientId);
                        } else {
                          kick.arm(p.clientId);
                        }
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            <KbtButton
              variant='solid'
              label='BEGIN THE HEAT'
              active={allReady}
              disabled={!allReady}
              onClick={onBegin}
            />
            {!allReady ? (
              <>
                <Label size={10} tracking={1.5} style={{ textAlign: 'center' }}>
                  {`WAITING FOR ${waitingNames.join(', ')}`}
                </Label>
                {onForceBegin && heatPlayers.some((p) => p?.camConnected) ? (
                  <KbtButton
                    variant='outline'
                    dense
                    label='FORCE START (SKIP THE MISSING)'
                    onClick={onForceBegin}
                  />
                ) : null}
              </>
            ) : null}
            <Label size={10} tracking={1} style={{ textAlign: 'center' }}>
              AI referee is live — reps count only after the countdown.
            </Label>
          </Plate>
        </div>
      ) : null}

      {/* Bottom chrome: restart / stop with the shared two-press rail. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '10px 16px',
          background:
            'linear-gradient(0deg, rgba(13,14,16,.85), rgba(13,14,16,0))',
        }}>
        <ConfirmRail
          control={rail}
          actions={[
            ...(onRestart
              ? [
                  {
                    id: 'restart',
                    label: 'RESTART HEAT',
                    prompt: "restart wipes this heat's reps",
                  },
                ]
              : []),
            { id: 'stop', label: 'STOP HEAT', prompt: 'stop this heat?' },
          ]}
          onConfirm={(id) => (id === 'stop' ? onAbort() : onRestart?.())}
        />
      </div>
    </div>
  );
}
