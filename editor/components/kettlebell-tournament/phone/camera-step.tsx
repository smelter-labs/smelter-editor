'use client';

import React from 'react';
import {
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
import {
  ActionButton,
  ChipButton,
  WarnPanel,
} from '../../duck-hunter/phone/phone-shell';

/**
 * Step 3 — the camera rig. The phone becomes the player's broadcast camera:
 * preview with a framing guide (whole body + bell in frame, phone propped
 * 2–3 m away), then GO LIVE publishes the stream into the room via WHIP.
 * Front camera by default so the athlete still sees their score on screen.
 */
export function CameraStep({
  camOn,
  camErr,
  facing,
  publishing,
  live,
  attachVideo,
  onEnable,
  onFlip,
  onGoLive,
  onContinue,
}: {
  camOn: boolean;
  camErr: string | null;
  facing: 'user' | 'environment';
  /** WHIP publish requested, waiting for the connection to settle. */
  publishing: boolean;
  /** Stream is up (server acked the input). */
  live: boolean;
  attachVideo: (el: HTMLVideoElement | null) => void;
  onEnable: () => void;
  onFlip: () => void;
  onGoLive: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      <PixelPanel
        accent='cyan'
        cut={10}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 11,
            letterSpacing: 1.5,
            color: R5.cyan,
          }}>
          CAMERA RIG
        </span>
        <span
          style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
          1. Prop the phone upright, 2–3 m away, screen facing you.
          {'\n'}2. Whole body + bell must fit inside the frame.
          {'\n'}3. GO LIVE — your camera becomes your arena tile.
        </span>
      </PixelPanel>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 220,
          background: '#000',
          border: `1px solid rgba(${R5.gridRgb},0.6)`,
          overflow: 'hidden',
        }}>
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
            transform: facing === 'user' ? 'scaleX(-1)' : undefined,
          }}
        />
        {/* Framing guide: keep the whole silhouette inside the dashed zone. */}
        <div
          style={{
            position: 'absolute',
            inset: '4% 12%',
            border: `2px dashed rgba(${R5.yellowRgb},0.75)`,
            pointerEvents: 'none',
          }}
        />
        {camOn ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 6,
              textAlign: 'center',
              fontFamily: pixelFont,
              fontSize: 9,
              letterSpacing: 1,
              color: R5.yellow,
              textShadow: '0 1px 4px #000',
              pointerEvents: 'none',
            }}>
            WHOLE BODY IN THE DASHED ZONE
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: pixelFont,
              fontSize: 11,
              color: R5.inkMuted,
            }}>
            CAMERA OFF
          </div>
        )}
        {camOn && !live ? (
          <ChipButton
            label={facing === 'user' ? 'FLIP → REAR' : 'FLIP → FRONT'}
            dense
            onClick={onFlip}
            style={{ position: 'absolute', top: 8, right: 8 }}
          />
        ) : null}
        {live ? (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              fontFamily: pixelFont,
              fontSize: 9,
              letterSpacing: 1,
              color: R5.green,
              background: 'rgba(0,0,0,0.55)',
              padding: '5px 8px',
            }}>
            ● LIVE
          </div>
        ) : null}
      </div>

      {camErr ? <WarnPanel>{camErr}</WarnPanel> : null}

      {!camOn ? (
        <ActionButton
          accent='cyan'
          label='ENABLE CAMERA'
          sub='front camera keeps your score visible'
          active
          onClick={onEnable}
        />
      ) : !live ? (
        <ActionButton
          accent='green'
          label={publishing ? 'CONNECTING…' : 'GO LIVE'}
          sub='publish this camera into the arena'
          disabled={publishing}
          active={!publishing}
          onClick={onGoLive}
        />
      ) : (
        <ActionButton
          accent='green'
          label='TO THE BRIEFING'
          sub='camera locked in'
          active
          onClick={onContinue}
        />
      )}
    </div>
  );
}
