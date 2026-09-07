'use client';

import React from 'react';
import type { BbCamRole } from '@smelter-editor/types';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  StatusDot,
  WarnPlate,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import {
  UseCameraButton,
  UseRecordingButton,
} from '@/components/kettlebell-tournament/phone/use-recording-button';

const COPY: Record<BbCamRole, { title: string; lines: string[] }> = {
  hoop: {
    title: 'THE HOOP CAMERA',
    lines: [
      'Tripod or clamp — the phone must not move once calibrated.',
      '45° off the backboard, 5–8 m from the hoop, above head height.',
      'Rim in the upper-middle third, backboard fully in frame, net visible.',
      'Landscape. Rear camera. No sun into the lens.',
    ],
  },
  court: {
    title: 'THE COURT CAMERA',
    lines: [
      'Wide on the whole half-court — this is the picture viewers watch.',
      'Tripod at mid-court, as high as you can get it.',
      'Landscape. Rear camera.',
    ],
  },
};

/**
 * The fixed camera rig: rear camera preview with role-specific framing copy,
 * "use a recording" for tests, GO LIVE publishes into the room via WHIP.
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
        }}>
        <Label size={10}>{copy.title}</Label>
        <ul
          style={{
            margin: 0,
            paddingLeft: 16,
            fontFamily: kbtMonoFont,
            fontSize: 11,
            lineHeight: 1.6,
            color: KBT.dim,
          }}>
          {copy.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Plate>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#000',
          border: `1px solid ${live ? KBT.good : KBT.border}`,
          overflow: 'hidden',
        }}>
        <video
          autoPlay
          playsInline
          muted
          ref={attachVideo}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
        {!camOn ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Label size={11}>CAMERA OFF</Label>
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}>
          <StatusDot
            state={live ? 'good' : publishing ? 'warn' : 'idle'}
            pulse={publishing && !live}
          />
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 10,
              letterSpacing: 1.5,
              color: KBT.cream,
              background: KBT.scrim,
              padding: '2px 6px',
            }}>
            {live
              ? sendFps != null
                ? `SENDING ${Math.round(sendFps)} FPS`
                : 'LIVE'
              : publishing
                ? 'CONNECTING…'
                : 'PREVIEW'}
          </span>
        </div>
      </div>
      {camErr ? <WarnPlate>{camErr}</WarnPlate> : null}
      {!camOn ? (
        <KbtButton
          block
          active
          label='ENABLE THE CAMERA'
          sub='rear camera, landscape'
          onClick={onEnable}
        />
      ) : null}
      {camOn ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
          {!fileMode ? (
            <ChipButton dense label='FLIP' onClick={onFlip} />
          ) : null}
          {fileMode ? (
            <>
              <ChipButton
                dense
                label={filePlaying ? 'PAUSE CLIP' : 'PLAY CLIP'}
                onClick={onToggleFile}
              />
              <ChipButton dense label='RESTART CLIP' onClick={onRestartFile} />
              <UseCameraButton onClick={onUseCamera} />
            </>
          ) : (
            <UseRecordingButton onUseFile={onUseFile} />
          )}
        </div>
      ) : null}
      {camOn && !live ? (
        <KbtButton
          block
          active
          label={publishing ? 'CONNECTING…' : 'GO LIVE'}
          sub='publish this camera into the room'
          onClick={onGoLive}
          disabled={publishing}
        />
      ) : null}
      {live ? (
        <KbtButton
          block
          active
          label='CONTINUE'
          sub={role === 'hoop' ? 'next: calibrate the rim' : 'to the live view'}
          onClick={onContinue}
        />
      ) : null}
    </div>
  );
}
