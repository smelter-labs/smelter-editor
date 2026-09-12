'use client';

import React from 'react';
import type { BbCamRole } from '@smelter-editor/types';
import {
  BB,
  BbButton,
  BbPlate,
  Chip,
  Copy,
  Display,
  Mono,
  UseCameraLink,
  UseRecordingLink,
  WarnPlate,
  Wordmark,
  useIsLandscape,
} from '../bb-kit';

const COPY: Record<BbCamRole, { title: string; text: string; hint: string }> = {
  hoop: {
    title: 'CAMERA RIG',
    text: 'Tripod 5–8 m from the hoop, 45° off the backboard, above head height. Lock exposure. Whole rim and net in frame. Do not touch the phone after calibrating.',
    hint: 'PUT THE RIM IN THE CENTRE CROSS',
  },
  court: {
    title: 'CAMERA RIG',
    text: 'Wide on the whole half-court — this is the picture viewers watch. Tripod at mid-court, as high as you can get it. Landscape, rear camera.',
    hint: 'WIDE ON THE HALF COURT',
  },
};

/**
 * The fixed camera rig: rear-camera preview with the centre cross (hoop),
 * role copy, ENABLE → GO LIVE → CONTINUE. Landscape puts the panel beside
 * the preview; portrait stacks it.
 */
export function FixedCamStep({
  role,
  camOn,
  camErr,
  fileMode,
  filePlaying,
  onToggleFile,
  onRestartFile,
  sendFps,
  publishing,
  live,
  attachVideo,
  onEnable,
  onUseFile,
  onUseCamera,
  onFlip,
  onGoLive,
  onContinue,
}: {
  role: BbCamRole;
  camOn: boolean;
  camErr: string | null;
  fileMode: boolean;
  filePlaying: boolean;
  onToggleFile: () => void;
  onRestartFile: () => void;
  sendFps: number | null;
  publishing: boolean;
  live: boolean;
  attachVideo: (el: HTMLVideoElement | null) => void;
  onEnable: () => void;
  onUseFile: (file: File) => void;
  onUseCamera: () => void;
  onFlip: () => void;
  onGoLive: () => void;
  onContinue: () => void;
}) {
  const copy = COPY[role];
  const landscape = useIsLandscape();
  const status = live
    ? sendFps != null
      ? `SENDING ${Math.round(sendFps)} FPS`
      : 'LIVE'
    : publishing
      ? 'CONNECTING…'
      : camOn
        ? 'PREVIEW · REAR CAMERA'
        : 'CAMERA OFF';

  const preview = (
    <div
      style={{
        position: 'relative',
        flex: landscape ? 1 : undefined,
        aspectRatio: landscape ? undefined : '16 / 9',
        background: 'radial-gradient(ellipse at 50% 40%,#2c2c30,#161618 75%)',
        overflow: 'hidden',
        minHeight: 0,
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
          objectFit: 'contain',
          opacity: camOn ? 1 : 0,
        }}
      />
      {role === 'hoop' ? (
        <>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: 1,
              background: 'rgba(34,211,238,.5)',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 1,
              background: 'rgba(34,211,238,.5)',
            }}
          />
        </>
      ) : null}
      <span
        style={{
          position: 'absolute',
          left: 12,
          top: 12,
          height: 26,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: BB.plate,
        }}>
        <span
          className={publishing && !live ? 'bb-pulse' : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: live ? BB.good : publishing ? BB.amber : BB.rule2,
          }}
        />
        <Mono size={10} weight={600} tracking={0.22}>
          {status}
        </Mono>
      </span>
      {camOn && !fileMode ? (
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
      {camOn ? (
        <span
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            padding: '5px 10px',
            background: BB.plate,
            opacity: 0.9,
          }}>
          <Mono size={10} tracking={0.18}>
            {copy.hint}
          </Mono>
        </span>
      ) : null}
    </div>
  );

  const panel = (
    <BbPlate
      cutPx={0}
      style={{
        padding: landscape ? 20 : 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: landscape ? 280 : undefined,
        flexShrink: 0,
      }}>
      {landscape ? <Wordmark size={24} /> : null}
      <Display size={28} weight={800} lineHeight={0.95}>
        {copy.title}
      </Display>
      <Copy size={11} color='rgba(232,228,218,.75)' lineHeight={1.7}>
        {copy.text}
      </Copy>
      {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}
      {camOn ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
          {fileMode ? (
            <>
              <Chip
                dense
                label={filePlaying ? 'PAUSE CLIP' : 'PLAY CLIP'}
                onClick={onToggleFile}
              />
              <Chip dense label='RESTART CLIP' onClick={onRestartFile} />
              <UseCameraLink onClick={onUseCamera} />
            </>
          ) : (
            <UseRecordingLink onUseFile={onUseFile} />
          )}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
        {!camOn ? (
          <BbButton
            block
            variant='outline'
            size='sm'
            label='ENABLE THE CAMERA'
            active
            onClick={onEnable}
          />
        ) : null}
        {camOn && !live ? (
          <BbButton
            block
            active={!publishing}
            disabled={publishing}
            size='md'
            label={
              publishing
                ? 'CONNECTING…'
                : role === 'hoop'
                  ? 'GO LIVE → CALIBRATE'
                  : 'GO LIVE'
            }
            onClick={onGoLive}
            style={{ height: 52, fontSize: 24 }}
          />
        ) : null}
        {live ? (
          <BbButton
            block
            active
            size='md'
            label={role === 'hoop' ? 'CALIBRATE THE RIM' : 'CONTINUE'}
            onClick={onContinue}
            style={{ height: 52, fontSize: 24 }}
          />
        ) : null}
      </div>
    </BbPlate>
  );

  if (landscape) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap: 0,
          minHeight: 0,
          margin:
            '-8px -16px calc(-1 * env(safe-area-inset-bottom, 0px) - 12px)',
        }}>
        {preview}
        {panel}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {preview}
      {panel}
    </div>
  );
}
