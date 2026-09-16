'use client';

import React from 'react';
import { ACCENT_LINE, R5, ledFont, pixelFont } from './retro-kit';

/* ------------------------------------------------------------------ *
 * Pixel-style drawings for the HOW TO PLAY / PIPELINE screens. Inline SVG
 * on a coarse grid with crisp edges (same fidelity as PixelWing in the
 * retro kit), plus the real NES sprites the game draws on air, served from
 * /public/duck-hunter. Everything takes a `size` and scales uniformly.
 * ------------------------------------------------------------------ */

const crisp: React.CSSProperties = {
  display: 'block',
  shapeRendering: 'crispEdges',
};

/** One of the on-air sprites (nearest-neighbour upscaled PNGs). */
export function Sprite({
  name,
  size,
  style,
}: {
  name: 'duck-fly' | 'duck-shot' | 'dog-laugh' | 'dog-tally';
  size: number;
  style?: React.CSSProperties;
}) {
  return (
    // Pixel art: next/image would add a loader round-trip and fight the
    // `pixelated` rendering this needs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/duck-hunter/${name}.png`}
      alt=''
      style={{
        display: 'block',
        width: size,
        height: size,
        objectFit: 'contain',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}

/**
 * A phone, portrait, drawn on a 40×72 grid. `tilt` rotates it (degrees)
 * around its center; `children` render inside the screen area (x 4..36,
 * y 8..60 in phone units) — used for the QR, the hunter tiles, the fire pad.
 */
export function Phone({
  size,
  tilt = 0,
  accent = R5.cyan,
  children,
}: {
  /** Height in px. */
  size: number;
  tilt?: number;
  accent?: string;
  children?: React.ReactNode;
}) {
  const w = (size * 40) / 72;
  return (
    <svg
      width={w}
      height={size}
      viewBox='0 0 40 72'
      style={{
        ...crisp,
        overflow: 'visible',
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
      }}>
      <rect x='0' y='0' width='40' height='72' fill={R5.edge} />
      <rect x='2' y='2' width='36' height='68' fill={accent} />
      <rect x='4' y='8' width='32' height='52' fill={R5.bgDeep} />
      <rect x='16' y='4' width='8' height='2' fill={R5.edge} />
      <rect x='16' y='63' width='8' height='4' fill={R5.edge} />
      {children}
    </svg>
  );
}

/** A QR-ish block pattern; fits the phone screen or stands alone. */
export function QrGlyph({
  x = 8,
  y = 16,
  cell = 2,
  color = R5.ink,
}: {
  x?: number;
  y?: number;
  cell?: number;
  color?: string;
}) {
  // 12×12 pattern with the three finder squares.
  const rows = [
    '111111101101',
    '100000101001',
    '101110100111',
    '101110101100',
    '101110100010',
    '100000101101',
    '111111101011',
    '000000000110',
    '101101111011',
    '011010100100',
    '110011101110',
    '101101011001',
  ];
  return (
    <g>
      {rows.map((r, j) =>
        r
          .split('')
          .map((c, i) =>
            c === '1' ? (
              <rect
                key={`${i}-${j}`}
                x={x + i * cell}
                y={y + j * cell}
                width={cell}
                height={cell}
                fill={color}
              />
            ) : null,
          ),
      )}
    </g>
  );
}

/** The on-air crosshair: ring + ticks + center dot, optional name tag. */
export function Crosshair({
  size,
  color = R5.yellow,
  tag,
}: {
  size: number;
  color?: string;
  tag?: string;
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox='0 0 32 32' style={crisp}>
        <rect x='14' y='0' width='4' height='8' fill={color} />
        <rect x='14' y='24' width='4' height='8' fill={color} />
        <rect x='0' y='14' width='8' height='4' fill={color} />
        <rect x='24' y='14' width='8' height='4' fill={color} />
        <rect x='8' y='8' width='16' height='2' fill={color} />
        <rect x='8' y='22' width='16' height='2' fill={color} />
        <rect x='8' y='8' width='2' height='16' fill={color} />
        <rect x='22' y='8' width='2' height='16' fill={color} />
        <rect x='14' y='14' width='4' height='4' fill={R5.red} />
      </svg>
      {tag ? (
        <span
          style={{
            position: 'absolute',
            left: size + 6,
            top: -2,
            fontFamily: pixelFont,
            fontSize: 7,
            letterSpacing: 1,
            color,
            whiteSpace: 'nowrap',
            textShadow: '0 0 6px rgba(0,0,0,0.8)',
          }}>
          {tag}
        </span>
      ) : null}
    </div>
  );
}

/** Ammo pips: `loaded` bright, the rest dim — the phone HUD's magazine. */
export function AmmoPips({
  max,
  loaded,
  size = 14,
}: {
  max: number;
  loaded: number;
  size?: number;
}) {
  const n = Math.max(1, Math.min(12, max));
  return (
    <div style={{ display: 'flex', gap: Math.round(size * 0.4) }}>
      {Array.from({ length: n }).map((_, i) => {
        const on = i < loaded;
        return (
          <svg
            key={i}
            width={size * 0.6}
            height={size}
            viewBox='0 0 6 10'
            style={crisp}>
            <rect
              x='0'
              y='2'
              width='6'
              height='8'
              fill={on ? R5.orange : 'rgba(124,147,184,0.25)'}
            />
            <rect
              x='1'
              y='0'
              width='4'
              height='2'
              fill={on ? R5.yellow : 'rgba(124,147,184,0.25)'}
            />
          </svg>
        );
      })}
    </div>
  );
}

/** The spawn aura: a pulsing ring that marks a real bird before the duck. */
export function Aura({
  size,
  color = R5.cyan,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      className='r5-pulse'
      style={crisp}>
      <rect x='8' y='0' width='8' height='2' fill={color} />
      <rect x='8' y='22' width='8' height='2' fill={color} />
      <rect x='0' y='8' width='2' height='8' fill={color} />
      <rect x='22' y='8' width='2' height='8' fill={color} />
      <rect x='4' y='2' width='4' height='2' fill={color} />
      <rect x='16' y='2' width='4' height='2' fill={color} />
      <rect x='2' y='4' width='2' height='4' fill={color} />
      <rect x='20' y='4' width='2' height='4' fill={color} />
      <rect x='4' y='20' width='4' height='2' fill={color} />
      <rect x='16' y='20' width='4' height='2' fill={color} />
      <rect x='2' y='16' width='2' height='4' fill={color} />
      <rect x='20' y='16' width='2' height='4' fill={color} />
    </svg>
  );
}

/** Pixel arrow, pointing right by default. */
export function Arrow({
  size,
  dir = 'right',
  color = R5.inkMuted,
}: {
  size: number;
  dir?: 'right' | 'left' | 'up' | 'down' | 'up-right';
  color?: string;
}) {
  const rot = {
    right: 0,
    down: 90,
    left: 180,
    up: 270,
    'up-right': -45,
  }[dir];
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      style={{ ...crisp, transform: `rotate(${rot}deg)` }}>
      <rect x='0' y='6' width='10' height='4' fill={color} />
      <rect x='8' y='2' width='2' height='12' fill={color} />
      <rect x='10' y='4' width='2' height='8' fill={color} />
      <rect x='12' y='6' width='2' height='4' fill={color} />
      <rect x='14' y='7' width='2' height='2' fill={color} />
    </svg>
  );
}

/** A big LED readout with a pixel caption under it (clock / target). */
export function LedBadge({
  value,
  caption,
  color = R5.yellow,
  glowRgb = R5.yellowRgb,
  size = 34,
}: {
  value: string;
  caption: string;
  color?: string;
  glowRgb?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}>
      <span
        style={{
          fontFamily: ledFont,
          fontSize: size,
          fontWeight: 900,
          lineHeight: 1,
          color,
          textShadow: `0 0 ${Math.round(size * 0.4)}px rgba(${glowRgb},0.55)`,
        }}>
        {value}
      </span>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 7,
          letterSpacing: 1.5,
          color: R5.inkMuted,
        }}>
        {caption}
      </span>
    </div>
  );
}

/* ----------------------- pipeline node icons ----------------------- */

/** Film strip — the stage video coming in. */
export function FilmIcon({
  size,
  color = R5.cyan,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' style={crisp}>
      <rect x='2' y='4' width='20' height='16' fill={color} />
      <rect x='5' y='7' width='14' height='10' fill={R5.bgDeep} />
      {[3, 7, 11, 15, 19].map((x) => (
        <React.Fragment key={x}>
          <rect x={x} y='4' width='2' height='2' fill={R5.bgDeep} />
          <rect x={x} y='18' width='2' height='2' fill={R5.bgDeep} />
        </React.Fragment>
      ))}
      <rect x='9' y='9' width='2' height='6' fill={color} />
      <rect x='11' y='10' width='2' height='4' fill={color} />
      <rect x='13' y='11' width='2' height='2' fill={color} />
    </svg>
  );
}

/** A tap off the pipe — frames branching to the sidecar. */
export function TapIcon({
  size,
  color = R5.orange,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' style={crisp}>
      <rect x='0' y='10' width='24' height='4' fill={color} />
      <rect x='10' y='14' width='4' height='6' fill={color} />
      <rect x='6' y='20' width='12' height='2' fill={color} />
      <rect x='4' y='4' width='2' height='6' fill={color} />
      <rect x='18' y='4' width='2' height='6' fill={color} />
      <rect x='4' y='2' width='16' height='2' fill={color} />
    </svg>
  );
}

/** An eye over a tile grid — YOLO looking at tiles. */
export function EyeIcon({
  size,
  color = R5.green,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' style={crisp}>
      {[0, 8, 16].map((x) =>
        [0, 8, 16].map((y) => (
          <rect
            key={`${x}-${y}`}
            x={x + 1}
            y={y + 1}
            width='6'
            height='6'
            fill='none'
            stroke={`rgba(${R5.gridRgb},0.7)`}
            strokeWidth='1'
          />
        )),
      )}
      <rect x='4' y='10' width='16' height='4' fill={color} />
      <rect x='6' y='8' width='12' height='2' fill={color} />
      <rect x='6' y='14' width='12' height='2' fill={color} />
      <rect x='10' y='10' width='4' height='4' fill={R5.bgDeep} />
      <rect x='11' y='11' width='2' height='2' fill={color} />
    </svg>
  );
}

/** A chip — the game logic. */
export function ChipIcon({
  size,
  color = R5.yellow,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' style={crisp}>
      <rect x='5' y='5' width='14' height='14' fill={color} />
      <rect x='8' y='8' width='8' height='8' fill={R5.bgDeep} />
      {[7, 11, 15].map((p) => (
        <React.Fragment key={p}>
          <rect x={p} y='1' width='2' height='4' fill={color} />
          <rect x={p} y='19' width='2' height='4' fill={color} />
          <rect x='1' y={p} width='4' height='2' fill={color} />
          <rect x='19' y={p} width='4' height='2' fill={color} />
        </React.Fragment>
      ))}
    </svg>
  );
}

/** A screen with a broadcast bar — the compositor's output. */
export function ScreenIcon({
  size,
  color = ACCENT_LINE.pink,
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' style={crisp}>
      <rect x='1' y='3' width='22' height='15' fill={color} />
      <rect x='3' y='5' width='18' height='11' fill={R5.bgDeep} />
      <rect x='9' y='18' width='6' height='2' fill={color} />
      <rect x='6' y='20' width='12' height='2' fill={color} />
      <rect x='5' y='7' width='4' height='2' fill={color} />
      <rect
        x='5'
        y='12'
        width='14'
        height='2'
        fill={`rgba(${R5.cyanRgb},0.8)`}
      />
    </svg>
  );
}
