'use client';

import { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import type { MatchSetup } from '../arcade';
import type { ArcadeCharacter } from '../characters';
import type { DuckHunterRoom } from '../use-duck-hunter-room';
import type { ShooterFeed } from '../use-shooter-feed';
import {
  ACCENT_LINE,
  LedText,
  PixelButton,
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

/**
 * The live game: fullscreen WHEP of the composited output (ducks,
 * crosshairs and the match HUD are burned in server-side) inside slim
 * retro chrome. The page-side clock interpolates from the authoritative
 * `shooter_match` ticks so WHEP latency never desyncs the numbers the
 * players argue about. Esc aborts the round (with confirm).
 */
export function GameScreen({
  character,
  setup,
  room,
  feed,
  onAbort,
}: {
  character: ArcadeCharacter;
  setup: MatchSetup;
  room: DuckHunterRoom;
  feed: ShooterFeed;
  onAbort: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
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

  // Local 4 Hz clock re-render; the displayed value anchors on the last
  // server tick (endsAtMs / startsAtMs are wall-clock).
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);

  useArcadeKeys({
    back: () => setConfirmAbort((c) => !c),
    confirm: () => {
      if (confirmAbort) {
        setConfirmAbort(false);
        onAbort();
      }
    },
  });

  const match = feed.match;
  const now = Date.now();
  const phase = match?.phase ?? 'playing';

  let clockLabel: string;
  let clockColor: string = R5.yellow;
  let clockGlow: string = R5.yellowRgb;
  let clockUrgent = false;
  if (phase === 'countdown') {
    const left = Math.max(0, (match?.startsAtMs ?? now) - now);
    clockLabel = `GET READY ${Math.max(1, Math.ceil(left / 1000))}`;
    clockColor = R5.green;
    clockGlow = R5.greenRgb;
  } else if (setup.mode === 'time') {
    const left = Math.max(0, (match?.endsAtMs ?? now) - now);
    const total = Math.round(left / 1000);
    clockLabel = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    if (left <= 10_000) {
      clockColor = R5.red;
      clockGlow = R5.redRgb;
      clockUrgent = true;
    }
  } else {
    const leader = [...feed.players].sort((a, b) => b.score - a.score)[0];
    clockLabel = leader
      ? `${leader.score} / ${setup.targetScore}`
      : `0 / ${setup.targetScore}`;
  }

  const scores = [...feed.players].sort((a, b) => b.score - a.score);

  return (
    <div className='r5-enter' style={{ position: 'absolute', inset: 0 }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
        }}
      />

      {/* Slim chrome: top-center clock chip. */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 5,
          pointerEvents: 'none',
        }}>
        <PixelPanel
          accent={phase === 'countdown' ? 'green' : 'yellow'}
          cut={8}
          glow={0.4}
          fill='rgba(4,8,15,0.82)'
          innerStyle={{ padding: '6px 18px' }}>
          <span className={clockUrgent ? 'r5-blink-fast' : undefined}>
            <LedText size={30} color={clockColor} glowRgb={clockGlow}>
              {clockLabel}
            </LedText>
          </span>
        </PixelPanel>
      </div>

      {/* Left rail: hunter identity + mini scoreboard mirror. */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          bottom: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 5,
          pointerEvents: 'none',
        }}>
        <PixelPanel
          accent={character.accent}
          cut={8}
          fill='rgba(4,8,15,0.82)'
          innerStyle={{ padding: '6px 12px' }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 9,
              color: ACCENT_LINE[character.accent],
            }}>
            {character.name}
          </span>
        </PixelPanel>
        {scores.slice(0, 4).map((p, i) => (
          <div
            key={p.clientId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: monoFont,
              fontSize: 12,
              color: R5.ink,
              textShadow: '0 1px 3px #000',
            }}>
            <span style={{ color: R5.inkMuted }}>{i + 1}</span>
            <span
              style={{
                width: 10,
                height: 10,
                background: p.color,
                boxShadow: `0 0 6px ${p.color}`,
              }}
            />
            <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </span>
            <LedText size={16}>{p.score}</LedText>
          </div>
        ))}
      </div>

      {/* Bottom-right controls. */}
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 14,
          display: 'flex',
          gap: 10,
          zIndex: 5,
        }}>
        <PixelButton
          accent='cyan'
          glyph={muted ? '♪' : '✕'}
          label={muted ? 'UNMUTE' : 'MUTE'}
          onClick={() => setMuted((m) => !m)}
        />
        {confirmAbort ? (
          <PixelButton
            accent='red'
            glyph='!'
            label='CONFIRM END'
            active
            onClick={() => {
              setConfirmAbort(false);
              onAbort();
            }}
          />
        ) : (
          <PixelButton
            accent='red'
            glyph='B'
            label='END ROUND'
            onClick={() => setConfirmAbort(true)}
          />
        )}
      </div>
    </div>
  );
}
