'use client';

import React from 'react';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  StatusDot,
  WarnPlate,
  kbtMonoFont,
} from '../kbt-kit';

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
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 16px',
        }}>
        <Label size={10}>CAMERA RIG</Label>
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            lineHeight: 1.6,
            color: KBT.dim,
            whiteSpace: 'pre-line',
          }}>
          1. Prop the phone upright, 2–3 m away, screen facing you.
          {'\n'}2. Whole body + bell must fit inside the frame.
          {'\n'}3. GO LIVE — your camera becomes your arena tile.
        </span>
      </Plate>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 220,
          background: '#000',
          border: `1px solid ${KBT.border}`,
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
            border: '2px dashed rgba(232,228,218,.5)',
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
              pointerEvents: 'none',
            }}>
            <Label
              size={9}
              tracking={2}
              color={KBT.cream}
              style={{
                background: 'rgba(13,14,16,.7)',
                padding: '4px 8px',
              }}>
              WHOLE BODY IN THE DASHED ZONE
            </Label>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Label size={11} tracking={3}>
              CAMERA OFF
            </Label>
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
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: 'rgba(13,14,16,.7)',
              padding: '5px 9px',
              pointerEvents: 'none',
            }}>
            <StatusDot state='good' pulse size={7} />
            <Label size={9} tracking={2} color={KBT.good}>
              LIVE
            </Label>
          </div>
        ) : null}
      </div>

      {camErr ? <WarnPlate>{camErr}</WarnPlate> : null}

      {!camOn ? (
        <KbtButton
          block
          variant='solid'
          label='ENABLE CAMERA'
          sub='front camera keeps your score visible'
          active
          onClick={onEnable}
        />
      ) : !live ? (
        <KbtButton
          block
          variant='solid'
          label={publishing ? 'CONNECTING…' : 'GO LIVE'}
          sub='publish this camera into the arena'
          disabled={publishing}
          active={!publishing}
          onClick={onGoLive}
        />
      ) : (
        <KbtButton
          block
          variant='solid'
          label='TO THE BRIEFING'
          sub='camera locked in'
          active
          onClick={onContinue}
        />
      )}
    </div>
  );
}
