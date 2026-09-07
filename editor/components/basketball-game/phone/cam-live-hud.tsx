'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  BbBallEvent,
  BbCamRole,
  BbRim,
  BbStateEvent,
  BbTeamId,
} from '@smelter-editor/types';
import {
  pointToVideoNorm,
  sampleVideoColorAt,
} from '@/lib/arcade/color-sample';
import {
  ChipButton,
  KBT,
  Label,
  StatusDot,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import { normToLocal } from './rim-calibration';

/**
 * The fixed camera's live screen: the preview stays up (the operator sees the
 * framing), the strip reports publish health and — on the hoop cam — the
 * AI's ball tracking, the score, and lets the operator tap a jersey to set a
 * team colour.
 */
export function CamLiveHud({
  role,
  name,
  state,
  rim,
  ball,
  live,
  sendFps,
  fileMode,
  filePlaying,
  onToggleFile,
  onRestartFile,
  attachVideo,
  warmupFlash,
  onRecalibrate,
  onSampleColor,
  onStop,
}: {
  role: BbCamRole;
  name: string;
  state: BbStateEvent | null;
  rim: BbRim | null;
  ball: BbBallEvent | null;
  live: boolean;
  sendFps: number | null;
  fileMode: boolean;
  filePlaying: boolean;
  onToggleFile: () => void;
  onRestartFile: () => void;
  attachVideo: (el: HTMLVideoElement | null) => void;
  /** A warm-up make was just detected (lobby) — flash TEST MAKE ✓. */
  warmupFlash: boolean;
  onRecalibrate: () => void;
  onSampleColor: (team: BbTeamId, hex: string) => void;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [sampling, setSampling] = useState<BbTeamId | null>(null);
  const [, forceRender] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceRender((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const attach = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    attachVideo(el);
  };

  const teams = state?.teams;
  const phase = state?.phase ?? 'lobby';
  const box = boxRef.current?.getBoundingClientRect();
  const v = videoRef.current;
  const local =
    rim && box && v?.videoWidth
      ? normToLocal(box, v.videoWidth, v.videoHeight, rim.cx, rim.cy)
      : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: KBT.page,
        display: 'flex',
        flexDirection: 'column',
        color: KBT.cream,
      }}>
      <div
        ref={boxRef}
        onClick={(e) => {
          if (!sampling || !videoRef.current || !boxRef.current) return;
          const p = pointToVideoNorm(
            boxRef.current,
            videoRef.current,
            e.clientX,
            e.clientY,
          );
          if (!p) return;
          const hex = sampleVideoColorAt(videoRef.current, p.nx, p.ny);
          if (hex) onSampleColor(sampling, hex);
          setSampling(null);
        }}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          background: '#000',
          cursor: sampling ? 'crosshair' : undefined,
        }}>
        <video
          autoPlay
          playsInline
          muted
          ref={attach}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
        {role === 'hoop' && local && v ? (
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}>
            <ellipse
              cx={local.x}
              cy={local.y}
              rx={rim!.rx * v.videoWidth * local.scale}
              ry={rim!.ry * v.videoHeight * local.scale}
              fill='none'
              stroke={ball?.zone === 'rim' ? KBT.good : KBT.accent}
              strokeWidth={2}
            />
          </svg>
        ) : null}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: KBT.scrim,
              padding: '4px 8px',
            }}>
            <StatusDot state={live ? 'good' : 'bad'} pulse={!live} />
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 11,
                letterSpacing: 1.5,
              }}>
              {role.toUpperCase()} CAM · {name.toUpperCase()} ·{' '}
              {live
                ? sendFps != null
                  ? `SENDING ${Math.round(sendFps)} FPS`
                  : 'LIVE'
                : 'NO SIGNAL OUT'}
            </span>
          </div>
          {role === 'hoop' ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: KBT.scrim,
                padding: '4px 8px',
              }}>
              <StatusDot
                state={!rim ? 'bad' : ball?.tracked ? 'good' : 'warn'}
              />
              <span
                style={{
                  fontFamily: kbtMonoFont,
                  fontSize: 11,
                  letterSpacing: 1.5,
                }}>
                {!rim
                  ? 'RIM NOT CALIBRATED'
                  : ball?.tracked
                    ? `BALL · ${ball.zone.toUpperCase()}${ball.source ? ` · ${ball.source}` : ''}`
                    : 'AI READY · NO BALL'}
              </span>
            </div>
          ) : null}
        </div>
        {warmupFlash ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}>
            <span
              style={{
                fontFamily: 'var(--font-kbt-display)',
                fontSize: 48,
                fontWeight: 800,
                color: KBT.good,
                background: KBT.scrim,
                padding: '8px 20px',
              }}>
              TEST MAKE ✓
            </span>
          </div>
        ) : null}
        {sampling ? (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              right: 8,
              textAlign: 'center',
            }}>
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 12,
                letterSpacing: 1.5,
                background: KBT.amber,
                color: KBT.dark,
                padding: '4px 10px',
              }}>
              TAP A TEAM {sampling} JERSEY IN THE PICTURE
            </span>
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding:
            '8px calc(env(safe-area-inset-right, 0px) + 12px) calc(env(safe-area-inset-bottom, 0px) + 10px) calc(env(safe-area-inset-left, 0px) + 12px)',
          borderTop: `1px solid ${KBT.border}`,
        }}>
        {teams ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontFamily: 'var(--font-kbt-display)',
              fontWeight: 800,
              fontSize: 22,
            }}>
            <span style={{ color: teams.A.color }}>
              {teams.A.name.toUpperCase()} {teams.A.score}
            </span>
            <Label size={10} tracking={2}>
              —
            </Label>
            <span style={{ color: teams.B.color }}>
              {teams.B.score} {teams.B.name.toUpperCase()}
            </span>
            <Label size={10} tracking={2} style={{ marginLeft: 'auto' }}>
              {phase.toUpperCase()}
            </Label>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {role === 'hoop' ? (
            <ChipButton dense label='RECALIBRATE RIM' onClick={onRecalibrate} />
          ) : null}
          {role === 'hoop' && teams
            ? (['A', 'B'] as const).map((t) => (
                <ChipButton
                  key={t}
                  dense
                  active={sampling === t}
                  leading={
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        background: teams[t].color,
                      }}
                    />
                  }
                  label={sampling === t ? 'TAP JERSEY…' : `COLOUR ${t}`}
                  onClick={() => setSampling(sampling === t ? null : t)}
                />
              ))
            : null}
          {fileMode ? (
            <>
              <ChipButton
                dense
                label={filePlaying ? 'PAUSE CLIP' : 'PLAY CLIP'}
                onClick={onToggleFile}
              />
              <ChipButton dense label='RESTART CLIP' onClick={onRestartFile} />
            </>
          ) : null}
          <ChipButton
            dense
            tone='danger'
            label='STOP CAMERA'
            onClick={onStop}
            style={{ marginLeft: 'auto' }}
          />
        </div>
      </div>
    </div>
  );
}
