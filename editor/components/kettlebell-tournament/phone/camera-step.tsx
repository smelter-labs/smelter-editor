'use client';

import React from 'react';
import {
  Bar,
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  StatusDot,
  WarnPlate,
  kbtMonoFont,
} from '../kbt-kit';

export type CameraStepVariant =
  | 'lifter'
  | 'commentator-phone'
  | 'commentator-desktop';

/**
 * Step 3 — the camera rig. The phone becomes the player's broadcast camera:
 * preview with a framing guide (whole body + bell in frame, phone propped
 * 2–3 m away), then GO LIVE publishes the stream into the room via WHIP.
 * Front camera by default so the athlete still sees their score on screen.
 * The rig copy follows the host's cameraView config: facing the lens vs
 * lifting side-on to it.
 *
 * The commentator variants reuse the same machinery with booth copy: mic
 * front and center, head-and-shoulders framing instead of the whole-body
 * dashed zone, and (on desktop) no phone-flip affordance.
 */
export function CameraStep({
  camOn,
  camErr,
  fileMode,
  filePlaying,
  onToggleFile,
  onRestartFile,
  sendFps,
  facing,
  cameraView,
  publishing,
  live,
  attachVideo,
  onEnable,
  onUseFile,
  onFlip,
  onGoLive,
  onContinue,
  variant = 'lifter',
  micLevel,
}: {
  camOn: boolean;
  camErr: string | null;
  /** The "camera" is a looping recorded clip, not a live capture. */
  fileMode?: boolean;
  /** The recording is currently playing (vs paused on a frame). */
  filePlaying?: boolean;
  onToggleFile?: () => void;
  onRestartFile?: () => void;
  /** Outbound video fps while live (file-mode publish diagnostics). */
  sendFps?: number | null;
  facing: 'user' | 'environment';
  /** Host-chosen lifter orientation (from kbt_state config). */
  cameraView: 'front' | 'side';
  /** WHIP publish requested, waiting for the connection to settle. */
  publishing: boolean;
  /** Stream is up (server acked the input). */
  live: boolean;
  attachVideo: (el: HTMLVideoElement | null) => void;
  onEnable: () => void;
  /** When set, offers "use a recording" — a clip published as the camera. */
  onUseFile?: (file: File) => void;
  onFlip?: () => void;
  onGoLive: () => void;
  onContinue: () => void;
  /** Role copy bundle; commentator variants are mic-aware. */
  variant?: CameraStepVariant;
  /** Live mic level (0..1) — renders a MIC meter (commentator variants). */
  micLevel?: number | null;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const commentator = variant !== 'lifter';
  const desktop = variant === 'commentator-desktop';
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
        <Label size={10}>{commentator ? 'CAM + MIC RIG' : 'CAMERA RIG'}</Label>
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            lineHeight: 1.6,
            color: KBT.dim,
            whiteSpace: 'pre-line',
          }}>
          {commentator ? (
            <>
              {desktop
                ? '1. Sit facing your webcam — head and shoulders in frame.'
                : '1. Prop the phone so it sees your face — head and shoulders is perfect.'}
              {'\n'}2. Your voice goes straight into the broadcast mix.
              {'\n'}3. GO LIVE — your camera shows in the lower-third between
              heats.
            </>
          ) : (
            <>
              {cameraView === 'side'
                ? '1. Prop the phone upright, 2–3 m away, pointed at your SIDE — you lift side-on to the lens.'
                : '1. Prop the phone upright, 2–3 m away, screen facing you.'}
              {'\n'}2. Whole body + bell must fit inside the frame.
              {'\n'}3. GO LIVE — your camera becomes your arena tile.
            </>
          )}
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
        {/* Framing guide: keep the whole silhouette inside the dashed zone.
            Commentators only need their face — no zone, no caption. */}
        {!commentator ? (
          <div
            style={{
              position: 'absolute',
              inset: '4% 12%',
              border: `2px dashed ${KBT.dim}`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        {camOn && !commentator ? (
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
                background: KBT.scrim,
                padding: '4px 8px',
              }}>
              WHOLE BODY IN THE DASHED ZONE
            </Label>
          </div>
        ) : !camOn ? (
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
        ) : null}
        {camOn && !live && !fileMode && !desktop && onFlip ? (
          <ChipButton
            label={facing === 'user' ? 'FLIP → REAR' : 'FLIP → FRONT'}
            dense
            onClick={onFlip}
            style={{ position: 'absolute', top: 8, right: 8 }}
          />
        ) : null}
        {camOn && fileMode ? (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              pointerEvents: 'none',
            }}>
            <div style={{ background: KBT.scrim, padding: '5px 9px' }}>
              <Label
                size={9}
                tracking={2}
                color={filePlaying === false ? KBT.amber : KBT.cream}>
                {filePlaying === false ? 'PAUSED' : 'RECORDING'}
              </Label>
            </div>
            {/* A paused clip legitimately encodes nothing — the PAUSED chip
                already says so, so only report fps while playing. */}
            {live && sendFps != null && filePlaying !== false ? (
              <div style={{ background: KBT.scrim, padding: '4px 8px' }}>
                <Label
                  size={9}
                  tracking={2}
                  color={sendFps > 0 ? KBT.good : KBT.bad}>
                  {sendFps > 0 ? `SENDING ${sendFps} FPS` : 'NO SIGNAL OUT'}
                </Label>
              </div>
            ) : null}
          </div>
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
              background: KBT.scrim,
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

      {fileMode && camOn ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <ChipButton
            label={filePlaying ? '⏸ PAUSE' : '▶ PLAY'}
            dense
            onClick={() => onToggleFile?.()}
          />
          <ChipButton
            label='↺ FROM THE TOP'
            dense
            onClick={() => onRestartFile?.()}
          />
        </div>
      ) : null}

      {/* Mic meter: proof the voice is being picked up before going on air. */}
      {commentator && camOn && micLevel != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Label size={9} tracking={2}>
            MIC
          </Label>
          <Bar
            value={micLevel}
            max={1}
            color={micLevel > 0.03 ? KBT.good : KBT.amber}
            style={{ flex: 1 }}
          />
        </div>
      ) : null}

      {camErr ? <WarnPlate>{camErr}</WarnPlate> : null}

      {!camOn ? (
        <KbtButton
          block
          variant='solid'
          label={commentator ? 'ENABLE CAMERA + MIC' : 'ENABLE CAMERA'}
          sub={
            commentator
              ? desktop
                ? 'browser will ask for webcam + microphone'
                : 'front camera + microphone — browser asks once'
              : cameraView === 'side'
                ? "either camera works — you won't face the screen"
                : 'front camera keeps your score visible'
          }
          active
          onClick={onEnable}
        />
      ) : !live ? (
        <KbtButton
          block
          variant='solid'
          label={publishing ? 'CONNECTING…' : 'GO LIVE'}
          sub={
            commentator
              ? 'your voice goes into the live mix'
              : 'publish this camera into the arena'
          }
          disabled={publishing}
          active={!publishing}
          onClick={onGoLive}
        />
      ) : (
        <KbtButton
          block
          variant='solid'
          label={commentator ? 'ON AIR' : 'TO THE BRIEFING'}
          sub={commentator ? 'rig locked in' : 'camera locked in'}
          active
          onClick={onContinue}
        />
      )}

      {/* Discreet alternative: publish a recorded clip instead of the camera. */}
      {onUseFile && !live ? (
        <>
          <input
            ref={fileInputRef}
            type='file'
            accept='video/*'
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // re-picking the same file must re-fire
              if (file) onUseFile(file);
            }}
          />
          <button
            type='button'
            className='kbt-btn'
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '2px 0 6px',
              alignSelf: 'center',
              fontFamily: kbtMonoFont,
              fontSize: 10,
              letterSpacing: 1,
              color: KBT.dim,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}>
            {fileMode
              ? 'PICK A DIFFERENT RECORDING'
              : 'USE A RECORDING INSTEAD'}
          </button>
        </>
      ) : null}
    </div>
  );
}
