'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BbRim } from '@smelter-editor/types';
import { BB, BbButton, Chip, Display, Mono } from '../bb-kit';

// SVG attributes need real colours (no CSS vars).
const RIM_ORANGE = '#E8632A';
const NET_GREEN = '#2EE06A';
const CHALK = '#E8E4DA';
const ELECTRIC = '#22D3EE';
const DARK = '#141416';

/** Electric square handle with a cut corner + glyph (design: 32 px). */
function Handle({ x, y, glyph }: { x: number; y: number; glyph: string }) {
  const s = 32;
  const c = 8;
  const pts = `${x},${y} ${x + s - c},${y} ${x + s},${y + c} ${x + s},${y + s} ${x},${y + s}`;
  return (
    <g>
      <polygon points={pts} fill={ELECTRIC} />
      <text
        x={x + s / 2}
        y={y + s / 2 + 5}
        textAnchor='middle'
        fontSize={14}
        fontWeight={600}
        fill={DARK}
        fontFamily='IBM Plex Mono, monospace'>
        {glyph}
      </text>
    </g>
  );
}
import {
  clientToNorm,
  defaultRim,
  hitTest,
  moveHandle,
  normToLocal,
  nudgeRim,
  scaleRim,
  type RimHandle,
} from './rim-calibration';

/**
 * Draw the rim: a still is grabbed from the live preview so the ellipse can
 * be placed on a frozen frame (a live view jitters under the thumb). Drag the
 * ellipse to the rim, pull the right handle to its width and the bottom
 * handle to its height, then CALIBRATE.
 */
export function RimCalibrator({
  attachVideo,
  initial,
  onCalibrate,
  onSkip,
}: {
  /** The page's preview ref-callback (the frozen still is grabbed from it). */
  attachVideo: (el: HTMLVideoElement | null) => void;
  initial: BbRim | null;
  onCalibrate: (rim: BbRim) => void;
  onSkip?: () => void;
}) {
  const [rim, setRim] = useState<BbRim>(initial ?? defaultRim());
  const [still, setStill] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<RimHandle | null>(null);
  const [, forceRender] = useState(0);

  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      attachVideo(el);
    },
    [attachVideo],
  );

  const grabStill = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    setStill(canvas.toDataURL('image/jpeg', 0.85));
    setDims({ w: v.videoWidth, h: v.videoHeight });
  }, []);

  // Grab the first still as soon as frames flow; the FREEZE button re-grabs.
  useEffect(() => {
    if (still) return;
    const t = window.setInterval(() => {
      if (videoRef.current?.videoWidth) {
        grabStill();
        window.clearInterval(t);
      }
    }, 300);
    return () => window.clearInterval(t);
  }, [still, grabStill]);

  useEffect(() => {
    const onResize = () => forceRender((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const aspect = dims ? dims.w / dims.h : 16 / 9;

  const toNorm = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box || !dims) return null;
    return clientToNorm(
      box.getBoundingClientRect(),
      dims.w,
      dims.h,
      e.clientX,
      e.clientY,
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!p) return;
    const handle = hitTest(rim, p.x, p.y, aspect, 0.07);
    dragRef.current = handle ?? 'center';
    if (!handle) setRim(moveHandle(rim, 'center', p.x, p.y));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const handle = dragRef.current;
    if (!handle) return;
    const p = toNorm(e);
    if (!p) return;
    setRim((r) => moveHandle(r, handle, p.x, p.y));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const box = boxRef.current?.getBoundingClientRect();
  const local =
    box && dims ? normToLocal(box, dims.w, dims.h, rim.cx, rim.cy) : null;
  const rxPx = local && dims ? rim.rx * dims.w * local.scale : 0;
  const ryPx = local && dims ? rim.ry * dims.h * local.scale : 0;

  const netH = dims ? rxPx * 2 * (dims.w / dims.h) * 0.45 : 0;
  const nudge = 0.005;
  const tool = (label: string, onClick: () => void, square = false) => (
    <Chip
      label={label}
      onClick={onClick}
      disabled={!still}
      style={{
        height: 44,
        width: square ? 44 : undefined,
        padding: square ? 0 : '0 14px',
        background: BB.plate,
      }}
    />
  );

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'fixed',
        inset: 0,
        background: BB.page,
        touchAction: 'none',
        userSelect: 'none',
        overflow: 'hidden',
      }}>
      {/* hidden live preview — the still is grabbed from it */}
      <video
        autoPlay
        playsInline
        muted
        ref={attach}
        style={{ display: 'none' }}
      />
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={still}
          alt=''
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: 'saturate(.6)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Mono size={12} weight={600} tracking={0.24}>
            WAITING FOR THE CAMERA…
          </Mono>
        </div>
      )}
      {local ? (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}>
          {/* net zone: where the ball counts */}
          <polygon
            points={`${local.x - rxPx * 1.3},${local.y + ryPx} ${local.x + rxPx * 1.3},${local.y + ryPx} ${local.x + rxPx * 0.75},${local.y + ryPx + netH} ${local.x - rxPx * 0.75},${local.y + ryPx + netH}`}
            fill='rgba(46,224,106,.25)'
            stroke={NET_GREEN}
            strokeWidth={2}
          />
          <ellipse
            cx={local.x}
            cy={local.y}
            rx={rxPx * 1.15}
            ry={ryPx * 1.15}
            fill='none'
            stroke='rgba(232,228,218,.7)'
            strokeWidth={2}
            strokeDasharray='6 6'
          />
          <ellipse
            cx={local.x}
            cy={local.y}
            rx={rxPx}
            ry={ryPx}
            fill='rgba(232,99,42,.15)'
            stroke={RIM_ORANGE}
            strokeWidth={4}
          />
          <circle cx={local.x} cy={local.y} r={5} fill={CHALK} />
          <Handle x={local.x + rxPx - 16} y={local.y - 16} glyph='▸' />
          <Handle x={local.x - 16} y={local.y + ryPx - 16} glyph='▾' />
        </svg>
      ) : null}

      {/* top-left: title + instructions */}
      <div
        style={{
          position: 'absolute',
          left: 'calc(env(safe-area-inset-left, 0px) + 16px)',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
          pointerEvents: 'none',
        }}>
        <span
          style={{
            height: 26,
            padding: '0 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: BB.plate,
          }}>
          <span style={{ width: 8, height: 8, background: BB.amber }} />
          <Mono size={10} weight={600} tracking={0.22}>
            {still ? 'FROZEN FRAME' : 'LIVE'}
          </Mono>
        </span>
        <Display
          size={30}
          weight={800}
          style={{ background: BB.plate, padding: '6px 10px' }}>
          RIM CALIBRATION
        </Display>
        <span
          style={{ background: BB.plate, padding: '6px 10px', maxWidth: 300 }}>
          <Mono
            size={10}
            tracking={0.14}
            color={BB.chalk}
            style={{ opacity: 0.85, lineHeight: 1.5 }}>
            DRAG THE ORANGE RING ONTO THE RIM. PULL ▸ FOR WIDTH, ▾ FOR HEIGHT.
            GREEN = NET ZONE, WHERE THE BALL COUNTS.
          </Mono>
        </span>
      </div>

      {/* top-right: readout */}
      <div
        style={{
          position: 'absolute',
          right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          background: BB.plate,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          pointerEvents: 'none',
        }}>
        {(
          [
            [
              'CX · CY',
              dims
                ? `${Math.round(rim.cx * dims.w)} · ${Math.round(rim.cy * dims.h)}`
                : '—',
              BB.chalk,
            ],
            [
              'RX · RY',
              dims
                ? `${Math.round(rim.rx * dims.w)} · ${Math.round(rim.ry * dims.h)}`
                : '—',
              BB.chalk,
            ],
            [
              'NET',
              dims ? `${Math.round(netH / (local?.scale ?? 1))} PX` : '—',
              BB.good,
            ],
          ] as const
        ).map(([k, v, c]) => (
          <div
            key={k}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 24,
            }}>
            <Mono
              size={10}
              tracking={0.14}
              color={BB.chalk}
              style={{ opacity: 0.6 }}>
              {k}
            </Mono>
            <Mono size={10} weight={600} tracking={0.14} color={c}>
              {v}
            </Mono>
          </div>
        ))}
      </div>

      {/* bottom bar: tools + CALIBRATE */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 'calc(env(safe-area-inset-left, 0px) + 16px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
        {tool('FREEZE NEW FRAME', grabStill)}
        {tool('BIGGER', () => setRim((r) => scaleRim(r, 1.1)))}
        {tool('SMALLER', () => setRim((r) => scaleRim(r, 0.9)))}
        {tool('◂', () => setRim((r) => nudgeRim(r, -nudge, 0)), true)}
        {tool('▴', () => setRim((r) => nudgeRim(r, 0, -nudge)), true)}
        {tool('▾', () => setRim((r) => nudgeRim(r, 0, nudge)), true)}
        {tool('▸', () => setRim((r) => nudgeRim(r, nudge, 0)), true)}
        <div style={{ flex: 1 }} />
        {onSkip ? (
          <Chip
            label='LATER'
            onClick={onSkip}
            style={{ height: 44, background: BB.plate }}
          />
        ) : null}
        <BbButton
          size='sm'
          active
          label='CALIBRATE'
          disabled={!still}
          onClick={() => onCalibrate(rim)}
          style={{ height: 44, fontSize: 22, padding: '0 22px' }}
        />
      </div>
    </div>
  );
}
