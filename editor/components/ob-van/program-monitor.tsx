'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import { Chip, Mono, OB, RADIUS, TagChip, scanLines } from './ob-kit';

/**
 * The PROGRAM monitor: the room's WHEP output with reconnect (1 s → 8 s
 * backoff; a dead track re-dials). Shared by the host ON AIR screen and the
 * operator panel. `muted` starts the audio off (a panel next to the stage
 * would feed back); the chip toggles it.
 */
export function ProgramMonitor({
  whepUrl,
  label = 'PROGRAM',
  caption,
  muted: initialMuted = false,
  frame = OB.program,
  overlay,
  style,
}: {
  whepUrl: string | null;
  label?: string;
  caption?: React.ReactNode;
  muted?: boolean;
  /** Border colour (red on air, dim in setup). */
  frame?: string;
  /** Extra layers over the picture (title bug, countdowns). */
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [feedDown, setFeedDown] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [muted, setMuted] = useState(initialMuted);

  useEffect(() => {
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
          setConnecting(false);
          delay = 1000;
          const vid = videoRef.current;
          if (vid && vid.srcObject !== stream) {
            vid.srcObject = stream;
            vid.play().catch(() => {
              // Autoplay with sound refused: fall back to muted.
              if (!vid) return;
              vid.muted = true;
              setMuted(true);
              vid.play().catch(() => {});
            });
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
          setConnecting(false);
          schedule();
        });
    };
    connect();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      closeConnection();
    };
  }, [whepUrl]);

  return (
    <div
      style={{
        position: 'relative',
        background: '#000',
        border: `2px solid ${frame}`,
        borderRadius: RADIUS,
        overflow: 'hidden',
        aspectRatio: '16 / 9',
        ...style,
      }}>
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
      {!whepUrl || connecting ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: scanLines(0.05),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Mono size={11} weight={600} tracking={0.2} color={OB.dim}>
            {whepUrl ? 'CONNECTING PROGRAM…' : 'NO PROGRAM FEED'}
          </Mono>
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}>
        <TagChip tone={frame === OB.program ? 'program' : 'outline'}>
          {label}
        </TagChip>
        {feedDown ? <TagChip tone='amber'>RECONNECTING</TagChip> : null}
      </div>
      <div style={{ position: 'absolute', top: 6, right: 8 }}>
        <Chip
          dense
          label={muted ? 'AUDIO OFF' : 'AUDIO ON'}
          tone={muted ? 'default' : 'preview'}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            const vid = videoRef.current;
            if (vid) {
              vid.muted = next;
              if (!next) vid.play().catch(() => {});
            }
          }}
          style={{ background: 'rgba(10,12,16,.7)' }}
        />
      </div>
      {overlay}
      {caption ? (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 6,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
          {typeof caption === 'string' ? (
            <Mono
              size={9.5}
              weight={600}
              tracking={0.16}
              color={OB.chalk}
              style={{
                background: 'rgba(10,12,16,.7)',
                padding: '2px 6px',
                borderRadius: 2,
              }}>
              {caption}
            </Mono>
          ) : (
            caption
          )}
        </div>
      ) : null}
    </div>
  );
}
