'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  LedText,
  PixelButton,
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
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
  const allPosed = heatPlayers.every((p) => p?.poseTracked);
  const heatLabel = match?.final
    ? 'FINAL'
    : match?.heatIndex != null
      ? `HEAT ${match.heatIndex + 1}`
      : 'HEAT';

  useArcadeKeys({
    back: () => setConfirmAbort((c) => !c),
    confirm: () => {
      if (phase === 'intro') {
        onBegin();
      } else if (confirmAbort) {
        setConfirmAbort(false);
        onAbort();
      }
    },
  });

  const now = Date.now();
  let clockLabel = '';
  let clockColor: string = R5.yellow;
  let clockGlow: string = R5.yellowRgb;
  let urgent = false;
  if (phase === 'countdown') {
    const left = Math.max(0, (match?.startsAtMs ?? now) - now);
    clockLabel = `GET SET ${Math.max(1, Math.ceil(left / 1000))}`;
    clockColor = R5.green;
    clockGlow = R5.greenRgb;
  } else if (phase === 'playing') {
    const left = Math.max(0, (match?.endsAtMs ?? now) - now);
    const total = Math.round(left / 1000);
    clockLabel = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    if (left <= 10_000) {
      clockColor = R5.red;
      clockGlow = R5.redRgb;
      urgent = true;
    }
  } else if (phase === 'ended') {
    clockLabel = 'TIME!';
    clockColor = R5.red;
    clockGlow = R5.redRgb;
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
            'linear-gradient(180deg, rgba(5,10,25,0.85), rgba(5,10,25,0))',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 13,
            letterSpacing: 2,
            color: R5.cyan,
          }}>
          {heatLabel}
        </span>
        <LedText
          size={26}
          color={clockColor}
          glowRgb={clockGlow}
          style={urgent ? undefined : undefined}>
          <span className={urgent ? 'r5-blink' : undefined}>{clockLabel}</span>
        </LedText>
        <div style={{ flex: 1 }} />
        {rows.map((r) => (
          <div
            key={r.clientId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: monoFont,
              fontSize: 13,
              color: R5.ink,
              background: 'rgba(5,10,25,0.6)',
              border: `1px solid ${r.color}`,
              padding: '4px 10px',
            }}>
            <span style={{ color: r.color }}>■</span>
            {r.name}
            <LedText size={17} color={r.color} glowRgb={R5.yellowRgb}>
              {r.points}
            </LedText>
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
            background: 'rgba(5,10,25,0.45)',
          }}>
          <PixelPanel
            accent='green'
            cut={12}
            glow={0.5}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              padding: '22px 28px',
              minWidth: 420,
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 16,
                letterSpacing: 2,
                color: R5.green,
              }}>
              {`${heatLabel} — ON THE PLATFORM`}
            </span>
            {heatPlayers.map((p, i) =>
              p ? (
                <div
                  key={p.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    fontFamily: monoFont,
                    fontSize: 14,
                    color: R5.ink,
                    width: '100%',
                  }}>
                  <span style={{ color: p.color }}>■</span>
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <span
                    className={p.poseTracked ? undefined : 'r5-blink'}
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 10,
                      color: p.poseTracked ? R5.green : R5.orangeBright,
                    }}>
                    {p.poseTracked
                      ? 'POSE ✓'
                      : p.camConnected
                        ? 'STEP INTO FRAME'
                        : 'NO CAMERA'}
                  </span>
                </div>
              ) : (
                <div
                  key={`missing-${i}`}
                  style={{
                    fontFamily: monoFont,
                    fontSize: 13,
                    color: R5.inkMuted,
                  }}>
                  (lifter left the tournament)
                </div>
              ),
            )}
            <PixelButton
              accent='green'
              glyph='A'
              label={allPosed ? 'BEGIN THE HEAT' : 'BEGIN ANYWAY'}
              active={allPosed}
              onClick={onBegin}
            />
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
              }}>
              AI referee is live — reps count only after the countdown.
            </span>
          </PixelPanel>
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
            'linear-gradient(0deg, rgba(5,10,25,0.85), rgba(5,10,25,0))',
        }}>
        {confirmAbort ? (
          <>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 12,
                color: R5.orangeBright,
                alignSelf: 'center',
              }}>
              stop this heat?
            </span>
            <PixelButton
              accent='red'
              glyph='A'
              label='STOP HEAT'
              active
              onClick={() => {
                setConfirmAbort(false);
                onAbort();
              }}
            />
            <PixelButton
              accent='blue'
              glyph='B'
              label='KEEP GOING'
              onClick={() => setConfirmAbort(false)}
            />
          </>
        ) : phase !== 'intro' ? (
          <PixelButton
            accent='red'
            glyph='B'
            label='ABORT'
            onClick={() => setConfirmAbort(true)}
          />
        ) : null}
      </div>
    </div>
  );
}
