'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  DisplayText,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
  cut,
  kbtMonoFont,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
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
  onAbort,
}: {
  room: KbtRoom;
  feed: KbtFeed;
  onBegin: () => void;
  onAbort: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [confirmAbort, setConfirmAbort] = useState(false);

  useEffect(() => {
    if (!room.whepUrl) return;
    let closeConnection = () => {};
    let cancelled = false;
    void connectWhep(room.whepUrl).then(({ stream, close }) => {
      if (cancelled) {
        close();
        return;
      }
      closeConnection = close;
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
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
  const allReady = heatPlayers.every((p) => p?.briefed && p?.camConnected);
  const waitingNames = heatPlayers
    .filter((p) => !p || !p.briefed || !p.camConnected)
    .map((p) => p?.name ?? '?');
  const heatLabel = match?.final
    ? 'FINAL'
    : match?.heatIndex != null
      ? `HEAT ${match.heatIndex + 1}`
      : 'HEAT';

  useArcadeKeys({
    back: () => setConfirmAbort((c) => !c),
    confirm: () => {
      if (confirmAbort) {
        setConfirmAbort(false);
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
            'linear-gradient(180deg, rgba(13,14,16,0.85), rgba(13,14,16,0))',
        }}>
        <Tab size={11}>{heatLabel}</Tab>
        <Num size={28} color={clockColor}>
          <span className={urgent ? 'kbt-blink' : undefined}>{clockLabel}</span>
        </Num>
        <div style={{ flex: 1 }} />
        {rows.map((r) => (
          <div
            key={r.clientId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              clipPath: cut(10),
              background: KBT.plate,
              border: `1px solid ${KBT.border}`,
              padding: '5px 14px 5px 10px',
            }}>
            <span
              style={{
                width: 8,
                height: 8,
                background: r.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 12,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: KBT.cream,
              }}>
              {r.name}
            </span>
            <DisplayText size={20} weight={800}>
              {`${r.points}`}
            </DisplayText>
          </div>
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
            background: 'rgba(13,14,16,0.6)',
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
              const ready = p.briefed && p.camConnected && p.poseTracked;
              const state: 'good' | 'warn' | 'bad' = ready
                ? 'good'
                : p.briefed && !p.camConnected
                  ? 'bad'
                  : 'warn';
              const text = !p.briefed
                ? 'ON THE PHONE…'
                : !p.camConnected
                  ? 'SIGNAL LOST'
                  : !p.poseTracked
                    ? 'STEP INTO FRAME'
                    : 'READY ✓';
              return (
                <div
                  key={p.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                  }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: p.color,
                      flexShrink: 0,
                    }}
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
              <Label size={10} tracking={1.5} style={{ textAlign: 'center' }}>
                {`WAITING FOR ${waitingNames.join(', ')}`}
              </Label>
            ) : null}
            <Label size={10} tracking={1} style={{ textAlign: 'center' }}>
              AI referee is live — reps count only after the countdown.
            </Label>
          </Plate>
        </div>
      ) : null}

      {/* Bottom chrome: abort. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
          padding: '10px 16px',
          background:
            'linear-gradient(0deg, rgba(13,14,16,0.85), rgba(13,14,16,0))',
        }}>
        {confirmAbort ? (
          <>
            <Label
              size={11}
              tracking={1.5}
              color={KBT.amber}
              style={{ alignSelf: 'center' }}>
              stop this heat?
            </Label>
            <KbtButton
              variant='danger'
              dense
              label='STOP HEAT'
              active
              onClick={() => {
                setConfirmAbort(false);
                onAbort();
              }}
            />
            <KbtButton
              variant='outline'
              dense
              label='KEEP GOING'
              onClick={() => setConfirmAbort(false)}
            />
          </>
        ) : (
          <KbtButton
            variant='danger'
            dense
            label='ABORT'
            onClick={() => setConfirmAbort(true)}
          />
        )}
      </div>
    </div>
  );
}
