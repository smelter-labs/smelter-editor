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
import { BB, Chip, Display, Mono, ScoreRow, TeamStripe } from '../bb-kit';
import { normToLocal } from './rim-calibration';

// SVG attributes need real colours (no CSS vars).
const RIM_ORANGE = '#E8632A';
const RIM_GREEN = '#2EE06A';

/**
 * The fixed camera's live screen: the preview stays up (the operator sees
 * the framing), chips report publish health and — on the hoop cam — the
 * AI's ball tracking; the bottom bar carries the score and lets the
 * operator recalibrate or tap a jersey to set a team colour.
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
  /** A warm-up make was just detected (lobby) — stamp TEST MAKE ✓. */
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
  const ballIn = !!ball?.tracked && ball.zone === 'rim';

  const chip = (
    children: React.ReactNode,
    opts: { bg?: string; fg?: string; opacity?: number } = {},
  ) => (
    <span
      style={{
        height: 26,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: opts.bg ?? BB.plate,
        color: opts.fg ?? BB.chalk,
        opacity: opts.opacity,
        fontFamily: 'inherit',
      }}>
      {children}
    </span>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: BB.page,
        display: 'flex',
        flexDirection: 'column',
        color: BB.chalk,
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
            {ballIn ? (
              <ellipse
                cx={local.x}
                cy={local.y}
                rx={rim!.rx * v.videoWidth * local.scale + 6}
                ry={rim!.ry * v.videoHeight * local.scale + 6}
                fill='none'
                stroke='rgba(46,224,106,.2)'
                strokeWidth={6}
              />
            ) : null}
            <ellipse
              cx={local.x}
              cy={local.y}
              rx={rim!.rx * v.videoWidth * local.scale}
              ry={rim!.ry * v.videoHeight * local.scale}
              fill='none'
              stroke={ballIn ? RIM_GREEN : RIM_ORANGE}
              strokeWidth={ballIn ? 4 : 3}
              opacity={ballIn ? 1 : 0.85}
            />
          </svg>
        ) : null}
        {/* top-left: who + publish health */}
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}>
          {chip(
            <Mono size={10} weight={600} tracking={0.22} color={BB.dark}>
              {role.toUpperCase()} CAM · {name}
            </Mono>,
            { bg: BB.chalk, fg: BB.dark },
          )}
          {chip(
            <>
              <span
                className={live ? undefined : 'bb-pulse'}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: live ? BB.good : BB.bad,
                }}
              />
              <Mono size={10} tracking={0.22}>
                {live
                  ? sendFps != null
                    ? `SENDING ${Math.round(sendFps)} FPS`
                    : 'LIVE'
                  : 'NO SIGNAL OUT'}
              </Mono>
            </>,
          )}
        </div>
        {/* top-right: AI state (hoop only) */}
        {role === 'hoop' ? (
          <div
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
              display: 'flex',
              gap: 6,
            }}>
            {!rim
              ? chip(
                  <Mono size={10} weight={600} tracking={0.22} color={BB.bad}>
                    RIM NOT CALIBRATED
                  </Mono>,
                )
              : chip(
                  <Mono size={10} weight={600} tracking={0.22} color={BB.good}>
                    AI READY
                  </Mono>,
                )}
            {rim
              ? ball?.tracked
                ? chip(
                    <Mono
                      size={10}
                      weight={600}
                      tracking={0.22}
                      color={BB.dark}>
                      BALL · {ball.zone.toUpperCase()}
                    </Mono>,
                    { bg: ballIn ? BB.good : BB.chalk },
                  )
                : chip(
                    <Mono size={10} tracking={0.22}>
                      NO BALL
                    </Mono>,
                    { opacity: 0.7 },
                  )
              : null}
          </div>
        ) : null}
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
              className='bb-stamp'
              style={{
                fontFamily: 'var(--font-bb-display)',
                fontWeight: 900,
                fontSize: 64,
                letterSpacing: '.06em',
                lineHeight: 1,
                background: BB.good,
                color: BB.dark,
                padding: '4px 24px',
                clipPath:
                  'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)',
              }}>
              TEST MAKE ✓
            </span>
          </div>
        ) : null}
        {sampling ? (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 0,
              right: 0,
              textAlign: 'center',
            }}>
            <span
              style={{
                background: BB.amber,
                color: BB.dark,
                padding: '5px 12px',
              }}>
              <Mono size={11} weight={600} tracking={0.2} color={BB.dark}>
                TAP A TEAM {sampling} JERSEY IN THE PICTURE
              </Mono>
            </span>
          </div>
        ) : null}
      </div>

      {/* bottom bar */}
      <div
        style={{
          background: BB.plate,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding:
            '10px calc(env(safe-area-inset-right, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 10px) calc(env(safe-area-inset-left, 0px) + 16px)',
          minHeight: 64,
          boxSizing: 'border-box',
        }}>
        {teams ? (
          <ScoreRow
            teams={teams}
            nameSize={22}
            scoreSize={30}
            stripe={{ w: 8, h: 30 }}
            separator='—'
            spread={false}
          />
        ) : null}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}>
          {phase === 'lobby' && role === 'hoop' ? (
            <Mono
              size={10}
              tracking={0.22}
              color={BB.chalk}
              style={{ opacity: 0.7, marginRight: 6 }}>
              WARM-UP · MAKES DON&apos;T COUNT YET
            </Mono>
          ) : null}
          {role === 'hoop' ? (
            <Chip label='RECALIBRATE RIM' onClick={onRecalibrate} />
          ) : null}
          {role === 'hoop' && teams
            ? (['A', 'B'] as const).map((t) => (
                <Chip
                  key={t}
                  label={sampling === t ? 'TAP JERSEY…' : t}
                  active={sampling === t}
                  leading={<TeamStripe color={teams[t].color} w={8} h={14} />}
                  onClick={() => setSampling(sampling === t ? null : t)}
                  title={`Sample team ${t}'s jersey colour from the picture`}
                />
              ))
            : null}
          {fileMode ? (
            <>
              <Chip
                label={filePlaying ? 'PAUSE CLIP' : 'PLAY CLIP'}
                onClick={onToggleFile}
              />
              <Chip label='RESTART CLIP' onClick={onRestartFile} />
            </>
          ) : null}
          <Chip tone='danger' label='STOP CAMERA' onClick={onStop} />
        </div>
        {!teams ? (
          <Display size={18} weight={800} style={{ opacity: 0.5 }}>
            {phase.toUpperCase()}
          </Display>
        ) : null}
      </div>
    </div>
  );
}
