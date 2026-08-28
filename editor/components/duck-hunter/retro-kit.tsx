'use client';

import React, { useEffect, useState } from 'react';
import { ArcadeStage as SharedArcadeStage } from '@/lib/arcade/stage';

/* ------------------------------------------------------------------ *
 * Retro kit for the /duck-hunter arcade page — a straight port of the
 * workshops repo `Workshop5RetroKit.tsx` (the "DUCK HUNTER character
 * select" look: dark navy blueprint background, chunky chamfered pixel
 * panels, arcade headline with an orange→yellow gradient and hard black
 * outline, winged emblems, segmented stat bars and (A)/(B) bevel
 * buttons) from Remotion frame-driven styling to plain React + CSS
 * animations (retro.css). Everything is laid out in a fixed 1280×720
 * design space (the same as the character-select videos) and scaled to
 * the viewport by <ArcadeStage>.
 * ------------------------------------------------------------------ */

/** Retro navy-blueprint palette lifted from the character-select art. */
export const R5 = {
  bgDeep: '#081120',
  panel: '#0b1a33',
  panelDark: '#08132a',
  edge: '#04080f',
  line: '#2e5c9e',
  lineBright: '#4d86d8',
  lineRgb: '46, 92, 158',
  gridRgb: '64, 110, 180',
  cyan: '#4fc3f7',
  cyanRgb: '79, 195, 247',
  orange: '#ff9210',
  orangeRgb: '255, 146, 16',
  orangeBright: '#ffb428',
  yellow: '#ffd23e',
  yellowRgb: '255, 210, 62',
  red: '#ff4030',
  redRgb: '255, 64, 48',
  green: '#3fd05a',
  greenRgb: '63, 208, 90',
  purple: '#a55eea',
  purpleRgb: '165, 94, 234',
  ink: '#dbe6f5',
  inkMuted: '#7c93b8',
  titleGradient:
    'linear-gradient(180deg, #ffe45e 0%, #ffb01f 48%, #ff7a12 72%, #ff5313 100%)',
} as const;

export type RetroAccent =
  | 'blue'
  | 'orange'
  | 'green'
  | 'red'
  | 'cyan'
  | 'yellow'
  | 'pink';

export const ACCENT_LINE: Record<RetroAccent, string> = {
  blue: R5.line,
  orange: R5.orangeBright,
  green: R5.green,
  red: R5.red,
  cyan: R5.cyan,
  yellow: R5.yellow,
  pink: '#FF4081',
};

export const ACCENT_RGB: Record<RetroAccent, string> = {
  blue: R5.lineRgb,
  orange: R5.orangeRgb,
  green: R5.greenRgb,
  red: R5.redRgb,
  cyan: R5.cyanRgb,
  yellow: R5.yellowRgb,
  pink: '255, 64, 129',
};

/** Font stacks wired up by the page via next/font CSS variables. */
export const pixelFont = "var(--font-pixel), 'Press Start 2P', monospace";
export const ledFont = "var(--font-led), 'Doto', monospace";
export const monoFont = "var(--font-retro-mono), 'Roboto Mono', monospace";

/** Chamfered-corner clip path — the recurring cut-corner panel shape. */
export const chamfer = (px: number): string => {
  const p = Math.max(1, Math.round(px));
  return `polygon(${p}px 0, calc(100% - ${p}px) 0, 100% ${p}px, 100% calc(100% - ${p}px), calc(100% - ${p}px) 100%, ${p}px 100%, 0 calc(100% - ${p}px), 0 ${p}px)`;
};

/* --------------------------- arcade stage --------------------------- */

export { STAGE_W, STAGE_H } from '@/lib/arcade/stage';

/**
 * Fullscreen wrapper that letterboxes and scales a fixed 1280×720 design
 * space to the viewport — the same canvas the character-select videos were
 * rendered at, so fullscreen video and panel overlays always line up.
 */
export function ArcadeStage({ children }: { children: React.ReactNode }) {
  return <SharedArcadeStage background={R5.bgDeep}>{children}</SharedArcadeStage>;
}

/* --------------------------- pixel panel --------------------------- */

/**
 * Double-stroked chamfered panel: bright line → dark gap → fill.
 * Children render inside the innermost layer (which clips, so badges
 * that overflow belong on a wrapper around the panel, not inside it).
 */
export function PixelPanel({
  accent = 'blue',
  fill,
  cut = 10,
  glow = 0,
  style,
  innerStyle,
  children,
}: {
  accent?: RetroAccent;
  fill?: string;
  cut?: number;
  /** 0..1 outer glow strength around the bright line. */
  glow?: number;
  style?: React.CSSProperties;
  innerStyle?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const lineW = 2;
  const gapW = 3;
  return (
    <div
      style={{
        position: 'relative',
        filter:
          glow > 0
            ? `drop-shadow(0 0 10px rgba(${ACCENT_RGB[accent]}, ${0.65 * glow}))`
            : undefined,
        ...style,
      }}>
      <div
        style={{
          clipPath: chamfer(cut),
          background: ACCENT_LINE[accent],
          padding: lineW,
        }}>
        <div
          style={{
            clipPath: chamfer(cut - lineW),
            background: R5.edge,
            padding: gapW,
          }}>
          <div
            style={{
              clipPath: chamfer(cut - lineW - gapW),
              background: fill ?? R5.panel,
              position: 'relative',
              ...innerStyle,
            }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Centered panel section title with side rails — the "STATS" header. */
export function PanelTitle({
  color = R5.cyan,
  children,
}: {
  color?: string;
  children: React.ReactNode;
}) {
  const rail = (gradient: string) => (
    <div style={{ flex: 1, height: 2, background: gradient }} />
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {rail(`linear-gradient(90deg, transparent, rgba(${R5.gridRgb},0.55))`)}
      <div
        style={{
          fontFamily: pixelFont,
          fontSize: 10,
          letterSpacing: 2,
          color,
          textShadow: `0 0 8px rgba(${R5.cyanRgb},0.5)`,
          whiteSpace: 'nowrap',
        }}>
        {children}
      </div>
      {rail(`linear-gradient(90deg, rgba(${R5.gridRgb},0.55), transparent)`)}
    </div>
  );
}

/* --------------------------- arcade text --------------------------- */

/**
 * The big cabinet headline: pixel font, yellow→orange gradient fill,
 * fat black outline and a hard drop shadow. Pass `\n` for line breaks.
 */
export function ArcadeText({
  size,
  children,
  glow = 0.35,
  style,
}: {
  size: number;
  children: string;
  glow?: number;
  style?: React.CSSProperties;
}) {
  const stroke = Math.max(2, Math.round(size * 0.12));
  const drop = Math.max(2, Math.round(size * 0.11));
  const common: React.CSSProperties = {
    fontFamily: pixelFont,
    fontSize: size,
    lineHeight: 1.35,
    letterSpacing: 2,
    whiteSpace: 'pre-line',
    textAlign: 'center',
  };
  return (
    <div
      style={{
        position: 'relative',
        filter:
          glow > 0
            ? `drop-shadow(0 0 ${size * 0.35}px rgba(${R5.orangeRgb},${glow}))`
            : undefined,
        ...style,
      }}>
      <div
        aria-hidden
        style={{
          ...common,
          position: 'absolute',
          inset: 0,
          transform: `translate(${Math.round(drop * 0.55)}px, ${drop}px)`,
          color: '#1c0508',
          WebkitTextStroke: `${stroke}px #1c0508`,
        }}>
        {children}
      </div>
      <div
        aria-hidden
        style={{
          ...common,
          position: 'absolute',
          inset: 0,
          color: '#1c0508',
          WebkitTextStroke: `${stroke}px #1c0508`,
        }}>
        {children}
      </div>
      <div
        style={{
          ...common,
          position: 'relative',
          background: R5.titleGradient,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}>
        {children}
      </div>
    </div>
  );
}

/** Three-feather winged emblem flanking arcade titles. */
export function PixelWing({
  size,
  flip = false,
  style,
}: {
  size: number;
  flip?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={(size * 24) / 46}
      viewBox='0 0 46 24'
      style={{
        display: 'block',
        transform: flip ? 'scaleX(-1)' : undefined,
        imageRendering: 'pixelated',
        ...style,
      }}>
      <polygon points='46,0 8,2 0,7 46,9' fill='#8fdcff' />
      <polygon points='46,11 12,12 5,16 46,17' fill='#3f9bea' />
      <polygon points='46,19 18,20 13,23 46,24' fill='#1d5fc2' />
    </svg>
  );
}

/** Cyan sub-headline between red stars — "★ CHARACTER SELECT ★". */
export function StarLine({
  size = 11,
  color = R5.cyan,
  style,
  children,
}: {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        ...style,
      }}>
      <span style={{ color: R5.red, fontSize: size }}>★</span>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: size,
          letterSpacing: 3,
          color,
          textShadow: `0 0 10px rgba(${R5.cyanRgb},0.55)`,
          whiteSpace: 'nowrap',
        }}>
        {children}
      </span>
      <span style={{ color: R5.red, fontSize: size }}>★</span>
    </div>
  );
}

/* ---------------------------- stat bar ---------------------------- */

/** Segmented pixel stat bar — lit cells glow, unlit cells stay faint. */
export function StatBar({
  label,
  color,
  colorRgb,
  value,
  total = 12,
  icon,
  labelWidth = 64,
  cell = 9,
}: {
  label: string;
  color: string;
  colorRgb: string;
  value: number;
  total?: number;
  icon?: string;
  labelWidth?: number;
  cell?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon ? (
        <span style={{ fontSize: 12, width: 16, textAlign: 'center' }}>
          {icon}
        </span>
      ) : null}
      <div
        style={{
          width: labelWidth,
          fontFamily: pixelFont,
          fontSize: 8,
          color: R5.ink,
          letterSpacing: 1,
        }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{
              width: cell,
              height: cell + 2,
              background: i < value ? color : 'rgba(120,150,200,0.12)',
              boxShadow:
                i < value
                  ? `inset 0 2px 0 rgba(255,255,255,0.35), 0 0 4px rgba(${colorRgb},0.5)`
                  : 'inset 0 0 0 1px rgba(120,150,200,0.16)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* --------------------------- pixel button --------------------------- */

/** Bevel action button — "(A) SELECT" / "(B) BACK". Interactive. */
export function PixelButton({
  accent,
  glyph,
  label,
  active = false,
  disabled = false,
  onClick,
  style,
}: {
  accent: RetroAccent;
  glyph: string;
  label: string;
  /** Pulse the glow (the "press me" affordance). */
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const color = ACCENT_LINE[accent];
  const rgb = ACCENT_RGB[accent];
  return (
    <button
      type='button'
      className={`r5-btn${active && !disabled ? ' r5-pulse-glow' : ''}`}
      disabled={disabled}
      onClick={onClick}
      style={style}>
      <PixelPanel
        accent={accent}
        cut={8}
        glow={active && !disabled ? 0.9 : 0.25}
        fill={`rgba(${rgb},0.14)`}
        innerStyle={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
        }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: `2px solid ${color}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: pixelFont,
            fontSize: 8,
            color,
            flexShrink: 0,
          }}>
          {glyph}
        </span>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 10,
            letterSpacing: 1.5,
            color,
            textShadow: `0 0 8px rgba(${rgb},0.6)`,
            whiteSpace: 'nowrap',
          }}>
          {label}
        </span>
      </PixelPanel>
    </button>
  );
}

/* ---------------------------- retro frame ---------------------------- */

function CornerTick({ pos }: { pos: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: 6,
        height: 6,
        background: `rgba(${R5.gridRgb},0.8)`,
        zIndex: 2,
        ...pos,
      }}
    />
  );
}

const FRAME_DOTS = [
  { x: '6%', y: '18%' },
  { x: '13%', y: '72%' },
  { x: '28%', y: '9%' },
  { x: '46%', y: '84%' },
  { x: '63%', y: '12%' },
  { x: '78%', y: '68%' },
  { x: '91%', y: '26%' },
  { x: '95%', y: '80%' },
] as const;

/** Blueprint grid + scattered twinkling pixels + corner ticks — the
 * background layer of every arcade screen. */
export function BlueprintBackdrop() {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            `repeating-linear-gradient(0deg, rgba(${R5.gridRgb},0.09) 0 1px, transparent 1px 26px)`,
            `repeating-linear-gradient(90deg, rgba(${R5.gridRgb},0.09) 0 1px, transparent 1px 26px)`,
            `radial-gradient(ellipse at 50% 0%, rgba(${R5.gridRgb},0.14), transparent 60%)`,
          ].join(', '),
          zIndex: 0,
        }}
      />
      {FRAME_DOTS.map((d, i) => (
        <div
          key={i}
          className='r5-twinkle'
          style={{
            position: 'absolute',
            left: d.x,
            top: d.y,
            width: 3,
            height: 3,
            background: `rgba(${R5.gridRgb},0.5)`,
            animationDelay: `${(i * 0.37) % 2.6}s`,
            zIndex: 0,
          }}
        />
      ))}
      <CornerTick pos={{ top: 8, left: 8 }} />
      <CornerTick pos={{ top: 8, right: 8 }} />
      <CornerTick pos={{ bottom: 8, left: 8 }} />
      <CornerTick pos={{ bottom: 8, right: 8 }} />
    </>
  );
}

/**
 * The retro screen shell filling the 1280×720 stage: chamfered navy panel
 * with a blueprint grid, arcade header (eyebrow / winged title / star
 * sub-line), CRT scanlines and a footer slot.
 */
export function RetroFrame({
  title,
  eyebrow,
  subtitle,
  titleSize = 34,
  wings = true,
  scanlines = true,
  footer,
  children,
}: {
  /** Arcade headline; omit to run a headerless (title-in-body) layout. */
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  titleSize?: number;
  wings?: boolean;
  scanlines?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className='r5-enter' style={{ position: 'absolute', inset: 0 }}>
      <PixelPanel
        accent='blue'
        cut={16}
        fill={R5.bgDeep}
        glow={0.3}
        style={{ position: 'absolute', inset: 10 }}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          height: 690,
        }}>
        <BlueprintBackdrop />

        {title ? (
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 18,
              gap: 8,
            }}>
            {eyebrow ? (
              <div
                style={{
                  fontFamily: pixelFont,
                  fontSize: 8,
                  letterSpacing: 3,
                  color: R5.inkMuted,
                }}>
                {eyebrow}
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {wings ? <PixelWing size={46} /> : null}
              <ArcadeText size={titleSize}>{title}</ArcadeText>
              {wings ? <PixelWing size={46} flip /> : null}
            </div>
            {subtitle ? <StarLine>{subtitle}</StarLine> : null}
            <div
              style={{
                alignSelf: 'stretch',
                margin: '6px 22px 0',
                height: 2,
                background: `linear-gradient(90deg, transparent, rgba(${R5.gridRgb},0.6) 20%, rgba(${R5.gridRgb},0.6) 80%, transparent)`,
              }}
            />
          </div>
        ) : null}

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            minHeight: 0,
            padding: '20px 28px',
            display: 'flex',
            flexDirection: 'column',
          }}>
          {children}
        </div>

        {footer ? (
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              padding: '0 28px 16px',
            }}>
            {footer}
          </div>
        ) : null}

        {scanlines ? <div className='r5-scanlines' /> : null}
      </PixelPanel>
    </div>
  );
}

/** Footer strip: blinking "▸ tip" on the left, optional buttons right. */
export function RetroFooter({
  tip,
  right,
}: {
  tip: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: right ? 'space-between' : 'center',
        gap: 16,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: monoFont,
          fontSize: 11,
          letterSpacing: 1.5,
          color: R5.inkMuted,
          textTransform: 'uppercase',
        }}>
        <span className='r5-blink' style={{ color: R5.orange }}>
          ▸
        </span>
        {tip}
      </div>
      {right}
    </div>
  );
}

/** LED-style numeric readout (Doto) — timers, scores, counters. */
export function LedText({
  size,
  color = R5.yellow,
  glowRgb = R5.yellowRgb,
  style,
  children,
}: {
  size: number;
  color?: string;
  glowRgb?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: ledFont,
        fontSize: size,
        fontWeight: 900,
        color,
        textShadow: `0 0 ${Math.round(size * 0.4)}px rgba(${glowRgb},0.55)`,
        ...style,
      }}>
      {children}
    </span>
  );
}
