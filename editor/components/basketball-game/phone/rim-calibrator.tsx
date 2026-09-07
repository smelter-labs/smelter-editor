'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BbRim } from '@smelter-editor/types';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
        }}>
        <Label size={10}>CALIBRATE THE RIM</Label>
        <div
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            lineHeight: 1.6,
            color: KBT.dim,
          }}>
          Drag the ring onto the rim. Pull the ▸ handle to the rim&apos;s width
          and the ▾ handle to its height as seen from here. The AI counts a make
          when the ball drops through this ring into the net below it.
        </div>
      </Plate>
      {/* hidden live preview — the still is grabbed from it */}
      <video
        autoPlay
        playsInline
        muted
        ref={attach}
        style={{ display: 'none' }}
      />
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspect}`,
          background: '#000',
          border: `1px solid ${KBT.border}`,
          touchAction: 'none',
          userSelect: 'none',
          overflow: 'hidden',
        }}>
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
            <Label size={11}>WAITING FOR THE CAMERA…</Label>
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
            <ellipse
              cx={local.x}
              cy={local.y}
              rx={rxPx}
              ry={ryPx}
              fill='rgba(255,106,31,.15)'
              stroke={KBT.accent}
              strokeWidth={3}
            />
            <ellipse
              cx={local.x}
              cy={local.y}
              rx={rxPx * 1.15}
              ry={ryPx * 1.15}
              fill='none'
              stroke='rgba(244,239,230,.35)'
              strokeDasharray='6 6'
            />
            <rect
              x={local.x - rxPx * 1.4}
              y={local.y + ryPx}
              width={rxPx * 2.8}
              height={2 * rxPx * (dims ? dims.w / dims.h : 1.78) * 0.9}
              fill='rgba(46,224,106,.08)'
              stroke='rgba(46,224,106,.5)'
              strokeDasharray='4 6'
            />
            <circle cx={local.x} cy={local.y} r={7} fill={KBT.cream} />
            <circle
              cx={local.x + rxPx}
              cy={local.y}
              r={11}
              fill={KBT.accent}
              stroke={KBT.dark}
              strokeWidth={2}
            />
            <circle
              cx={local.x}
              cy={local.y + ryPx}
              r={11}
              fill={KBT.accent}
              stroke={KBT.dark}
              strokeWidth={2}
            />
          </svg>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <ChipButton dense label='FREEZE NEW FRAME' onClick={grabStill} />
        <ChipButton
          dense
          label='BIGGER'
          onClick={() => setRim((r) => scaleRim(r, 1.1))}
        />
        <ChipButton
          dense
          label='SMALLER'
          onClick={() => setRim((r) => scaleRim(r, 0.9))}
        />
        <ChipButton
          dense
          label='◀'
          onClick={() => setRim((r) => nudgeRim(r, -0.005, 0))}
        />
        <ChipButton
          dense
          label='▶'
          onClick={() => setRim((r) => nudgeRim(r, 0.005, 0))}
        />
        <ChipButton
          dense
          label='▲'
          onClick={() => setRim((r) => nudgeRim(r, 0, -0.005))}
        />
        <ChipButton
          dense
          label='▼'
          onClick={() => setRim((r) => nudgeRim(r, 0, 0.005))}
        />
      </div>
      <div
        style={{
          fontFamily: kbtMonoFont,
          fontSize: 10,
          letterSpacing: 1,
          color: KBT.dim,
        }}>
        centre {rim.cx.toFixed(3)} · {rim.cy.toFixed(3)} · rx{' '}
        {rim.rx.toFixed(3)} · ry {rim.ry.toFixed(3)}
      </div>
      <KbtButton
        block
        active
        label='CALIBRATE'
        sub='send the ring to the AI'
        onClick={() => onCalibrate(rim)}
        disabled={!still}
      />
      {onSkip ? (
        <KbtButton block variant='outline' label='LATER' onClick={onSkip} />
      ) : null}
    </div>
  );
}
