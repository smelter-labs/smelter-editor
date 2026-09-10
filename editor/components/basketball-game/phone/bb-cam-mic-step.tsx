'use client';

import React from 'react';
import {
  BB,
  BbButton,
  Chip,
  Copy,
  Display,
  Meta,
  MicMeter,
  WarnPlate,
} from '../bb-kit';

/**
 * CAM + MIC (optional) — the commentator / moderator rig: mirrored
 * portrait preview, mic meter, ENABLE → GO LIVE → ON AIR. `onSkip` adds
 * the "MODERATE WITHOUT A CAMERA" way out.
 */
export function BbCamMicStep({
  heading = ['CAM + MIC'],
  optional = true,
  hint = 'Go on air as the courtside voice. Your picture and voice ride with the cameras, about 3 s behind.',
  camOn,
  camErr,
  publishing,
  live,
  facing = 'user',
  attachVideo,
  onEnable,
  onFlip,
  onGoLive,
  onContinue,
  onSkip,
  skipLabel = 'MODERATE WITHOUT A CAMERA',
  micLevel,
  devicePickers,
}: {
  heading?: string[];
  optional?: boolean;
  hint?: string;
  camOn: boolean;
  camErr: string | null;
  publishing: boolean;
  live: boolean;
  facing?: 'user' | 'environment';
  attachVideo: (el: HTMLVideoElement | null) => void;
  onEnable: () => void;
  onFlip?: () => void;
  onGoLive: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  micLevel?: number | null;
  devicePickers?: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Display
        size={44}
        weight={800}
        lineHeight={0.95}
        style={{ marginTop: 8, whiteSpace: 'pre-line' }}>
        {heading.join('\n')}
        {optional ? (
          <>
            {'\n'}
            <span style={{ opacity: 0.5, fontWeight: 500 }}>(OPTIONAL)</span>
          </>
        ) : null}
      </Display>
      <Copy size={13} color='rgba(232,228,218,.7)' lineHeight={1.6}>
        {hint}
      </Copy>
      <div
        style={{
          position: 'relative',
          aspectRatio: '3 / 4',
          maxHeight: '44vh',
          background: 'radial-gradient(ellipse at 50% 30%,#3d3a36,#18181a 75%)',
          overflow: 'hidden',
        }}>
        <video
          autoPlay
          playsInline
          muted
          ref={attachVideo}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: facing === 'user' ? 'scaleX(-1)' : undefined,
            opacity: camOn ? 1 : 0,
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            height: 24,
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            background: BB.plate,
          }}>
          <Meta size={10} tracking={0.22} weight={600} color={BB.chalk}>
            {camOn
              ? live
                ? 'ON AIR'
                : publishing
                  ? 'CONNECTING…'
                  : 'PREVIEW · MIRRORED'
              : 'CAMERA OFF'}
          </Meta>
        </span>
        {camOn && onFlip ? (
          <Chip
            dense
            label='FLIP'
            onClick={onFlip}
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              background: BB.plate,
            }}
          />
        ) : null}
      </div>
      {camOn && micLevel != null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Meta size={10} tracking={0.22}>
              MIC
            </Meta>
            <Meta
              size={10}
              tracking={0.22}
              weight={600}
              color={micLevel > 0.03 ? BB.good : BB.amber}>
              {micLevel > 0.03 ? 'LIVE' : 'QUIET'}
            </Meta>
          </div>
          <MicMeter level={micLevel} />
        </div>
      ) : null}
      {devicePickers}
      {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
        {!camOn ? (
          <BbButton
            block
            active
            size='lg'
            label='ENABLE CAM + MIC'
            onClick={onEnable}
            style={{ height: 60, fontSize: 26 }}
          />
        ) : !live ? (
          <BbButton
            block
            active={!publishing}
            disabled={publishing}
            size='lg'
            label={publishing ? 'CONNECTING…' : 'GO LIVE'}
            onClick={onGoLive}
            style={{ height: 60, fontSize: 26 }}
          />
        ) : (
          <BbButton
            block
            active
            size='lg'
            label='CONTINUE'
            keyBadge='ON AIR'
            onClick={onContinue}
            style={{ height: 60, fontSize: 26 }}
          />
        )}
        {onSkip ? (
          <BbButton
            block
            variant='outline'
            size='md'
            label={skipLabel}
            onClick={onSkip}
            style={{ fontSize: 20 }}
          />
        ) : null}
      </div>
    </div>
  );
}
