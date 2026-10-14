'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ObTally } from '@smelter-editor/types';
import {
  Display,
  Meta,
  MicMeter,
  Mono,
  OB,
  ObButton,
  WarnPlate,
  useArmed,
  useIsLandscape,
} from '@/components/ob-van/ob-kit';
import { TALLY_LABEL } from '@/lib/ob-van/tally';
import type { Quad } from '@/lib/ob-van/finger-frame';
import type { HandFrameStatus } from './use-hand-frame';

export type HudStatus = { text: string; tone: 'ok' | 'warn' };

const TALLY_BG: Record<ObTally, string> = {
  program: OB.program,
  preview: OB.preview,
  off: OB.scrim,
};

const TALLY_FG: Record<ObTally, string> = {
  program: '#fff',
  preview: OB.dark,
  off: OB.chalk,
};

/**
 * The live screen: a clean full-bleed self-view (the publish track stays
 * warm and framing stays visible), with the tally as a thick border around
 * the picture plus a pulsing chip up top — ON AIR red, PREVIEW green,
 * STANDBY dark — instead of the old full-screen colour wash. When the
 * finger frame is on, the quad detected in this browser is traced over the
 * preview (instant feedback — the program shows it after the air delay).
 * The controls sit on a dark dock so they read over any picture.
 */
export function CamLiveHud({
  tally,
  camNumber,
  name,
  roleText,
  talent,
  facing,
  attachVideo,
  status,
  camErr,
  muted,
  micLevel,
  fingerFrameOn,
  handQuad,
  handStatus,
  lastSwitchAt,
  onToggleMute,
  onStopVideo,
  onLeave,
}: {
  tally: ObTally | null;
  camNumber: number | null;
  name: string;
  roleText: string;
  talent: string | null;
  facing: 'user' | 'environment';
  attachVideo: (el: HTMLVideoElement | null) => void;
  status: HudStatus;
  camErr: string | null;
  muted: boolean;
  micLevel: number;
  /** Operator's FRAME toggle (drives the in-browser detector). */
  fingerFrameOn: boolean;
  /** Latest detected fingertip quad (captured-frame coords) or null. */
  handQuad: Quad | null;
  handStatus: HandFrameStatus;
  /** Wall time of the last pinch shader-switch (flashes a chip). */
  lastSwitchAt: number | null;
  onToggleMute: () => void;
  /** Stop publishing on purpose and go back to the rig. */
  onStopVideo: () => void;
  onLeave: () => void;
}) {
  const landscape = useIsLandscape();
  const { armed, arm, disarm } = useArmed(4000);
  const t: ObTally = tally ?? 'off';
  const lit = t !== 'off';

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const attachBoth = useCallback(
    (el: HTMLVideoElement | null) => {
      videoElRef.current = el;
      attachVideo(el);
    },
    [attachVideo],
  );

  // Trace the detected quad over the cover-fitted preview. The quad is in
  // the captured (raw, unmirrored) frame's coordinates; the preview of the
  // front camera is CSS-mirrored, so X flips to match what the eye sees.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoElRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(rect.height * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!handQuad || !video || video.videoWidth === 0) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    const dispW = video.videoWidth * scale;
    const dispH = video.videoHeight * scale;
    const offX = (cw - dispW) / 2;
    const offY = (ch - dispH) / 2;
    const pts = handQuad.map(([x, y]) => {
      const sx = offX + x * dispW;
      return [facing === 'user' ? cw - sx : sx, offY + y * dispH] as const;
    });

    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = 'rgba(242, 244, 248, 0.92)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 3 * dpr;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(242, 244, 248, 0.95)';
    for (const [x, y] of pts) {
      ctx.fillRect(x - 3.5 * dpr, y - 3.5 * dpr, 7 * dpr, 7 * dpr);
    }
  }, [handQuad, facing]);

  const press = (id: 'leave' | 'stop', fire: () => void) => {
    if (armed === id) {
      disarm();
      fire();
    } else {
      arm(id);
    }
  };

  // Freshly switched look (pinch): flash a chip for a moment.
  const switchFresh = lastSwitchAt != null && Date.now() - lastSwitchAt < 1500;

  const tallyChip = (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: TALLY_BG[t],
        color: TALLY_FG[t],
        borderRadius: 3,
        maxWidth: '100%',
        boxSizing: 'border-box',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
      }}>
      <span
        aria-hidden
        className={t === 'program' ? 'ob-pulse' : undefined}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          background: TALLY_FG[t],
          opacity: lit ? 1 : 0.45,
        }}
      />
      <Display size={20} weight={800} tracking={0.1} color={TALLY_FG[t]}>
        {TALLY_LABEL[t]}
      </Display>
      <Mono
        size={12}
        weight={600}
        tracking={0.12}
        color={TALLY_FG[t]}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.92,
        }}>
        CAM {camNumber ?? '–'} · {(name || 'CAMERA').toUpperCase()}
        {talent ? ` · ${talent.toUpperCase()}` : ''}
      </Mono>
    </div>
  );

  const frameNote = !fingerFrameOn ? null : handStatus === 'unavailable' ? (
    <Mono size={9.5} weight={600} tracking={0.14} color={OB.amber}>
      FRAME · DETECTION UNAVAILABLE ON THIS DEVICE
    </Mono>
  ) : (
    <Mono
      size={9.5}
      weight={600}
      tracking={0.14}
      color={switchFresh ? OB.amber : OB.chalk}
      style={{ background: OB.scrim, padding: '3px 7px', borderRadius: 2 }}>
      {switchFresh
        ? 'FRAME · LOOK SWITCHED'
        : handStatus === 'loading'
          ? 'FRAME · LOADING…'
          : handQuad
            ? 'FRAME · TRACKING'
            : 'FRAME · SHOW BOTH HANDS'}
    </Mono>
  );

  const dock = (
    <div
      style={{
        position: 'relative',
        zIndex: 2,
        flex: landscape ? '0 0 min(300px, 42vw)' : undefined,
        alignSelf: landscape ? 'stretch' : undefined,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: landscape ? 'center' : undefined,
        gap: 10,
        background: OB.scrim,
        borderTop: landscape ? 'none' : `1px solid ${OB.rule2}`,
        borderLeft: landscape ? `1px solid ${OB.rule2}` : 'none',
        padding: landscape
          ? 'calc(env(safe-area-inset-top, 0px) + 12px) calc(env(safe-area-inset-right, 0px) + 14px) calc(env(safe-area-inset-bottom, 0px) + 12px) 14px'
          : '12px calc(env(safe-area-inset-right, 0px) + 14px) calc(env(safe-area-inset-bottom, 0px) + 12px) calc(env(safe-area-inset-left, 0px) + 14px)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Meta size={9.5}>MIC</Meta>
        {muted ? (
          <Mono size={10} weight={600} tracking={0.18} color={OB.amber}>
            MUTED
          </Mono>
        ) : (
          <MicMeter level={micLevel} style={{ flex: 1 }} />
        )}
      </div>
      {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <ObButton
          size='md'
          variant={muted ? 'danger' : 'outline'}
          label={muted ? 'UNMUTE' : 'MUTE MIC'}
          active={muted}
          onClick={onToggleMute}
          style={{ flex: 1 }}
        />
        <ObButton
          size='md'
          variant={armed === 'leave' ? 'dangerSolid' : 'danger'}
          label={armed === 'leave' ? 'PRESS AGAIN' : 'LEAVE'}
          onClick={() => press('leave', onLeave)}
          style={{ flex: 1 }}
        />
      </div>
      <ObButton
        size='sm'
        variant={armed === 'stop' ? 'danger' : 'ghost'}
        label={armed === 'stop' ? 'PRESS AGAIN TO STOP VIDEO' : 'STOP VIDEO'}
        onClick={() => press('stop', onStopVideo)}
        block
      />
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: OB.page,
        color: OB.chalk,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: landscape ? 'row' : 'column',
      }}>
      <div
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}>
        {/* Clean self-view — the tally lives on the border + chip now. */}
        <video
          ref={attachBoth}
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
            pointerEvents: 'none',
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
        {/* Tally border: the picture is framed in the tally colour. */}
        {lit ? (
          <div
            aria-hidden
            className={t === 'program' ? 'ob-pulse' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              border: `6px solid ${TALLY_BG[t]}`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            padding: landscape
              ? 'calc(env(safe-area-inset-top, 0px) + 14px) 14px 14px calc(env(safe-area-inset-left, 0px) + 16px)'
              : 'calc(env(safe-area-inset-top, 0px) + 16px) calc(env(safe-area-inset-right, 0px) + 16px) 14px calc(env(safe-area-inset-left, 0px) + 16px)',
            pointerEvents: 'none',
          }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              alignSelf: 'stretch',
            }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '4px 8px',
                background: OB.scrim,
                borderRadius: 2,
                minWidth: 0,
              }}>
              <span
                aria-hidden
                className={status.tone === 'warn' ? 'ob-pulse' : undefined}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: status.tone === 'warn' ? OB.amber : OB.chalk,
                }}
              />
              <Mono
                size={10}
                weight={600}
                tracking={0.16}
                color={status.tone === 'warn' ? OB.amber : OB.chalk}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                {status.text}
              </Mono>
            </span>
            <Mono
              size={10}
              weight={600}
              tracking={0.2}
              color={OB.chalk}
              style={{
                background: OB.scrim,
                padding: '4px 8px',
                borderRadius: 2,
              }}>
              OB · CAMERA · {roleText}
            </Mono>
          </div>
          {tallyChip}
          {frameNote}
        </div>
      </div>
      {dock}
    </div>
  );
}
