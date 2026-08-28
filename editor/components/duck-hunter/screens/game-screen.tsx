'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import { resolveMediaUrl } from '@/lib/server-url';
import type { DuckHunterRoom } from '../use-duck-hunter-room';
import { PixelButton, R5, monoFont } from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

// Host controls fade out after this much pointer silence.
const CONTROLS_HIDE_MS = 3000;

/**
 * The live game: fullscreen WHEP of the composited output. Everything the
 * audience sees — ducks, crosshairs, the match clock, the scoreboard, the
 * results scene — is burned in server-side (retro-panel shader HUD), so the
 * page adds NO overlays of its own on top of the video. The only chrome is
 * the host's MUTE / END ROUND buttons, and even those auto-hide until the
 * pointer moves. Esc aborts the round (with confirm).
 */
export function GameScreen({
  room,
  onAbort,
}: {
  room: DuckHunterRoom;
  onAbort: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [whepError, setWhepError] = useState<string | null>(null);

  // Auto-hiding host controls: any pointer/touch activity shows them and
  // re-arms the fade; a pending END ROUND confirm pins them visible.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);
  useEffect(() => {
    pokeControls();
    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [pokeControls]);
  const showControls = controlsVisible || confirmAbort;

  useEffect(() => {
    if (!room.whepUrl) return;
    let closeConnection = () => {};
    let cancelled = false;
    setWhepError(null);
    // The URL may only be reachable via the ?server= base / page origin.
    void connectWhep(resolveMediaUrl(room.whepUrl))
      .then((conn) => {
        if (cancelled) {
          conn.close();
          return;
        }
        closeConnection = conn.close;
        setStream(conn.stream);
      })
      .catch(() => {
        // A failed WHEP was an unhandled rejection + a permanently black
        // screen; the ducks are burned in server-side, so at least say so.
        if (!cancelled) setWhepError('VIDEO LINK FAILED — game continues');
      });
    return () => {
      cancelled = true;
      closeConnection();
      setStream(null);
    };
  }, [room.whepUrl]);

  // Attach in a separate effect: holding the stream in state means a video
  // element that mounts a beat later still gets it (the old code silently
  // discarded the stream when the ref was momentarily null).
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !stream) return;
    if (vid.srcObject !== stream) {
      vid.srcObject = stream;
      vid.play().catch(() => {});
    }
  }, [stream]);

  useArcadeKeys({
    back: () => {
      pokeControls();
      setConfirmAbort((c) => !c);
    },
    confirm: () => {
      if (confirmAbort) {
        setConfirmAbort(false);
        onAbort();
      }
    },
  });

  return (
    <div
      className='r5-enter'
      style={{ position: 'absolute', inset: 0 }}
      onPointerMove={pokeControls}
      onPointerDown={pokeControls}
      onTouchStart={pokeControls}>
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

      {whepError ? (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 6,
            pointerEvents: 'none',
          }}>
          <span
            style={{
              padding: '4px 10px',
              background: 'rgba(40,8,8,0.9)',
              border: `2px solid ${R5.red}`,
              color: R5.ink,
              fontFamily: monoFont,
              fontSize: 12,
              letterSpacing: 1,
            }}>
            {whepError}
          </span>
        </div>
      ) : null}

      {/* Bottom-right host controls (auto-hidden while the pointer rests). */}
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 14,
          display: 'flex',
          gap: 10,
          zIndex: 5,
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
          transition: 'opacity 0.4s ease',
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
