'use client';

import React from 'react';
import QRCode from 'react-qr-code';
import type { BbShotEvent, BbTeamId, BbTeamStats } from '@smelter-editor/types';
import { BB_TEAM_COLOR_PRESETS } from '@smelter-editor/types';
import { ArcadeStage } from '@/lib/arcade/stage';
import { useArmed } from '@/lib/arcade/use-armed';
import { colorsTooClose } from '@/lib/arcade/color';
import {
  cut,
  isLightColor,
  luminance,
  monoWidth,
  needsOutline,
} from './bb-kit-helpers';
import type { KbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import type { CommentatorRig } from '@/components/kettlebell-tournament/panel/use-commentator-rig';

/* ------------------------------------------------------------------ *
 * Blacktop kit — the design language of the basketball game
 * (docs/design/blacktop/*.dc.html): asphalt plates with one cut corner
 * and no border-radius anywhere, chalk text, one electric accent, team
 * colours only ever as stripes / rules / chips (never under text), Big
 * Shoulders Display for names + numbers, IBM Plex Mono for time + status.
 * Host screens lay out in the shared 1280×720 arcade stage (design px ×
 * 2/3); phones use <BbPhoneShell>. The broadcast HUD (server/src/inputs/
 * BbHud.tsx + scripts/bb-render-assets.mjs) burns the same tokens.
 * ------------------------------------------------------------------ */

export { colorsTooClose, useArmed };
export { STAGE_W, STAGE_H } from '@/lib/arcade/stage';
export { useIsLandscape } from '@/lib/arcade/use-viewport';

/** Blacktop tokens (apps variant — the HUD uses #F4EFE6 / #33E1FF). */
export const BB = {
  page: '#141416',
  asphalt: '#141416',
  dark: '#141416',
  chalk: '#E8E4DA',
  chalkHud: '#F4EFE6',
  electric: '#22D3EE',
  electricHud: '#33E1FF',
  gold: '#E8B33A',
  goldGrad: 'linear-gradient(135deg,#E8B33A,#F5D77A 45%,#C8901F)',
  goldText: 'linear-gradient(180deg,#F5D77A,#E8B33A 60%,#C8901F)',
  good: '#2EE06A',
  amber: '#FFD21F',
  bad: '#FF2E3D',
  ballOrange: '#E8632A',
  plate: 'rgba(20,20,22,.94)',
  plate2: 'rgba(30,30,34,.94)',
  /** Chip scrim over live video. */
  scrim: 'rgba(20,20,22,.94)',
  rule: 'rgba(232,228,218,.12)',
  rule2: 'rgba(232,228,218,.25)',
  rule3: 'rgba(232,228,218,.3)',
  dim: 'rgba(232,228,218,.6)',
  dim2: 'rgba(232,228,218,.4)',
  fill: 'rgba(232,228,218,.06)',
  fillStrong: 'rgba(232,228,218,.15)',
} as const;

/** Font stacks wired by app/basketball-game/fonts.ts (next/font vars). */
export const bbDisplay =
  "var(--font-bb-display), 'Big Shoulders Display', 'Big Shoulders', sans-serif";
export const bbMono = "var(--font-bb-mono), 'IBM Plex Mono', monospace";

export { cut, isLightColor, luminance, monoWidth, needsOutline };

/* ------------------------------ textures ------------------------------ */

/** Asphalt noise as a CSS url() (feTurbulence), alpha 0..1. */
export const noiseUrl = (alpha = 0.14): string =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${alpha} 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E")`;

/** Chain-link fence: two diagonal hairline grids. */
export const chainLink = (alpha = 0.05, pitch = 30): string =>
  `repeating-linear-gradient(45deg, rgba(232,228,218,${alpha}) 0 1px, transparent 1px ${pitch}px), repeating-linear-gradient(-45deg, rgba(232,228,218,${alpha}) 0 1px, transparent 1px ${pitch}px)`;

/** Halftone dots (backgroundImage); pair with backgroundSize `${size}px ${size}px`. */
export const halftone = (
  rgb = '232,179,58',
  alpha = 0.14,
  at = '15% 20%',
): string =>
  `radial-gradient(circle at ${at}, rgba(${rgb},${alpha}) 1.4px, transparent 1.8px)`;

/** Hazard stripes (feed reconnecting, ref-call block). */
export const hazardStripe = (
  a: string = BB.amber,
  b = 'rgba(20,20,22,.12)',
  w = 12,
): string =>
  `repeating-linear-gradient(135deg, transparent 0 ${w}px, ${b} ${w}px ${w * 2}px), ${a}`;

/** Ruled paper (AI referee plate). */
export const ruledLines = (pitch = 32): string =>
  `repeating-linear-gradient(0deg, transparent 0 ${pitch - 1}px, rgba(232,228,218,.05) ${pitch - 1}px ${pitch}px)`;

/* ------------------------------ helpers ------------------------------ */

/** Format an AI attribution for a ledger row ("AI: A 92%" / "AI: ? 31%"). */
export function aiGuessLabel(shot: BbShotEvent): string {
  if (shot.source === 'manual') return 'MANUAL';
  if (shot.source === 'replay') {
    return `GT: ${shot.aiTeam ?? '?'}${shot.gtPoints ? ` ${shot.gtPoints}PT` : ''}`;
  }
  const pct = Math.round(shot.aiConfidence * 100);
  return `AI: ${shot.aiTeam ?? '?'} ${pct}%`;
}

/* ------------------------------- stage ------------------------------- */

/** The 1280×720 arcade stage on asphalt. */
export function BbStage({ children }: { children: React.ReactNode }) {
  return <ArcadeStage background={BB.page}>{children}</ArcadeStage>;
}

/* -------------------------------- type -------------------------------- */

/** Big Shoulders display text. `tracking` is in em. */
export function Display({
  size,
  weight = 800,
  color = BB.chalk,
  tracking = 0,
  lineHeight = 1,
  uppercase = true,
  style,
  children,
}: {
  size: number;
  weight?: 500 | 700 | 800 | 900;
  color?: string;
  tracking?: number;
  lineHeight?: number;
  uppercase?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: bbDisplay,
        fontWeight: weight,
        fontSize: size,
        lineHeight,
        letterSpacing: `${tracking}em`,
        textTransform: uppercase ? 'uppercase' : undefined,
        color,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}>
      {children}
    </span>
  );
}

/** IBM Plex Mono: time, counts, status, meta. `tracking` in em. */
export function Mono({
  size = 12,
  weight = 400,
  color = BB.chalk,
  tracking = 0.2,
  uppercase = true,
  style,
  children,
}: {
  size?: number;
  weight?: 400 | 500 | 600;
  color?: string;
  tracking?: number;
  uppercase?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: bbMono,
        fontWeight: weight,
        fontSize: size,
        letterSpacing: `${tracking}em`,
        textTransform: uppercase ? 'uppercase' : undefined,
        color,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}>
      {children}
    </span>
  );
}

/** Dim mono caption — the kit's small-print voice. */
export function Meta({
  size = 11,
  tracking = 0.2,
  color = BB.dim,
  weight = 400,
  style,
  children,
}: {
  size?: number;
  tracking?: number;
  color?: string;
  weight?: 400 | 500 | 600;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Mono
      size={size}
      tracking={tracking}
      color={color}
      weight={weight}
      style={style}>
      {children}
    </Mono>
  );
}

/** Mono body copy (sentence case, no tracking). */
export function Copy({
  size = 13,
  color = BB.dim,
  lineHeight = 1.7,
  style,
  children,
}: {
  size?: number;
  color?: string;
  lineHeight?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: bbMono,
        fontSize: size,
        lineHeight,
        color,
        ...style,
      }}>
      {children}
    </span>
  );
}

/** BLACK | TOP — the wordmark. Bar = 0.13 × size wide, skewed −18°. */
export function Wordmark({
  size,
  color = BB.chalk,
  accent = BB.electric,
  style,
}: {
  size: number;
  color?: string;
  accent?: string;
  style?: React.CSSProperties;
}) {
  const barW = Math.max(3, Math.round(size * 0.13));
  const barH = Math.round(size * 0.72);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: bbDisplay,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 0.9,
        color,
        whiteSpace: 'nowrap',
        ...style,
      }}>
      <span>BLACK</span>
      <span
        style={{
          display: 'inline-block',
          width: barW,
          height: barH,
          background: accent,
          transform: 'skewX(-18deg)',
          margin: `0 ${Math.round(size * 0.065)}px 0 ${Math.round(size * 0.09)}px`,
        }}
      />
      <span style={{ color: accent }}>TOP</span>
    </span>
  );
}

/** The tag signature: outlined, rotated, backgrounds only. Once per screen. */
export function TagSignature({
  text = 'BLACKTOP',
  size,
  rotate = -5,
  stroke = 'rgba(232,228,218,.14)',
  strokeWidth = 2,
  shadow,
  style,
}: {
  text?: string;
  size: number;
  rotate?: number;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        fontFamily: bbDisplay,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 0.8,
        letterSpacing: '.02em',
        transform: `rotate(${rotate}deg)`,
        WebkitTextStroke: `${strokeWidth}px ${stroke}`,
        color: 'transparent',
        textShadow: shadow,
        pointerEvents: 'none',
        userSelect: 'none',
        ...style,
      }}>
      {text}
    </span>
  );
}

/** Stencil bridges (SCORE! / FINAL / WINS only). `bg` = the plate behind. */
export function Stencil({
  size,
  weight = 900,
  tracking = 0.06,
  bridge,
  bg = BB.page,
  color = BB.chalk,
  style,
  children,
}: {
  size: number;
  weight?: 800 | 900;
  tracking?: number;
  bridge?: number;
  bg?: string;
  color?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const b = bridge ?? Math.max(2, Math.round(size * 0.05));
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        fontFamily: bbDisplay,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 0.9,
        letterSpacing: `${tracking}em`,
        color,
        ...style,
      }}>
      {children}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: -b,
          right: -b,
          top: '38%',
          height: b,
          background: bg,
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: -b,
          right: -b,
          top: '66%',
          height: b,
          background: bg,
        }}
      />
    </span>
  );
}

/* ------------------------------- plates ------------------------------- */

export type PlateTexture =
  | 'lines'
  | 'chain'
  | 'halftone-gold'
  | 'halftone-electric';

function textureStyle(texture?: PlateTexture): React.CSSProperties {
  switch (texture) {
    case 'lines':
      return { backgroundImage: ruledLines(32) };
    case 'chain':
      return { backgroundImage: chainLink(0.07, 26) };
    case 'halftone-gold':
      return {
        backgroundImage: halftone('232,179,58', 0.18, '20% 0'),
        backgroundSize: '10px 10px',
      };
    case 'halftone-electric':
      return {
        backgroundImage: halftone('34,211,238', 0.55, 'center'),
        backgroundSize: '9px 9px',
      };
    default:
      return {};
  }
}

/**
 * The Blacktop plate: one element, plate fill, one cut corner, no hairline.
 * Team/tone colour lives in a 4–16 px bar drawn inside the clip (so it is
 * cut with the corner, as in the design).
 */
export function BbPlate({
  fill = BB.plate2,
  cutPx = 18,
  leftBar,
  leftBarColor = BB.electric,
  topBar,
  topBarColor = BB.electric,
  bottomBar,
  bottomBarColor = BB.electric,
  border,
  texture,
  className,
  style,
  children,
}: {
  fill?: string;
  cutPx?: number;
  leftBar?: number;
  leftBarColor?: string;
  topBar?: number;
  topBarColor?: string;
  bottomBar?: number;
  bottomBarColor?: string;
  /** Inner 1–2 px border drawn inside the clip (which-camera card etc.). */
  border?: string;
  texture?: PlateTexture;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        clipPath: cut(cutPx),
        background: fill,
        boxSizing: 'border-box',
        ...textureStyle(texture),
        ...style,
      }}>
      {leftBar ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: leftBar,
            background: leftBarColor,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {topBar ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: topBar,
            background: topBarColor,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {bottomBar ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: bottomBar,
            background: bottomBarColor,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {border ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            border,
            clipPath: cut(cutPx),
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** Plate section head: Big Shoulders title left, mono meta right. */
export function PlateHead({
  size = 22,
  color = BB.chalk,
  tracking = 0.04,
  right,
  style,
  children,
}: {
  size?: number;
  color?: string;
  tracking?: number;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        ...style,
      }}>
      <Display size={size} weight={800} tracking={tracking} color={color}>
        {children}
      </Display>
      {right}
    </div>
  );
}

/* ------------------------------ buttons ------------------------------ */

export type BbButtonVariant =
  | 'primary'
  | 'chalk'
  | 'outline'
  | 'danger'
  | 'dangerSolid'
  | 'good';
export type BbButtonSize = 'lg' | 'md' | 'sm';

const BTN_SIZE: Record<
  BbButtonSize,
  { h: number; fs: number; px: number; cut: number; kbd: number }
> = {
  lg: { h: 64, fs: 30, px: 36, cut: 14, kbd: 11 },
  md: { h: 56, fs: 22, px: 24, cut: 12, kbd: 10 },
  sm: { h: 44, fs: 18, px: 16, cut: 10, kbd: 9 },
};

/**
 * The kit's action button. `primary` = electric, dark text, cut corner
 * (the one thing to press); `chalk` = solid chalk (PAUSE); `outline` =
 * 1 px rule + chalk; `danger` = red outline; `dangerSolid` = red; `good` =
 * green (RESUME). Labels are Big Shoulders; `keyBadge` prints the key.
 */
export function BbButton({
  label,
  keyBadge,
  sub,
  variant = 'primary',
  size = 'md',
  scale = 1,
  block = false,
  active = false,
  disabled = false,
  locked = false,
  dimmed = false,
  onClick,
  title,
  style,
}: {
  label: string;
  keyBadge?: string;
  /** Second line, mono, small (rare — the design mostly has none). */
  sub?: string;
  variant?: BbButtonVariant;
  size?: BbButtonSize;
  /** Host screens draw at 2/3 of the 1080p design. */
  scale?: number;
  block?: boolean;
  /** Pulse — "press me". */
  active?: boolean;
  disabled?: boolean;
  /** Momentarily unresponsive without the disabled dim. */
  locked?: boolean;
  /** Shown but not applicable (design: .5 opacity, still clickable). */
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const s = BTN_SIZE[size];
  const h = Math.round(s.h * scale);
  const fs = Math.round(s.fs * scale);
  const px = Math.round(s.px * scale);
  const kbd = Math.max(8, Math.round(s.kbd * scale));
  const solid =
    variant === 'primary' ||
    variant === 'chalk' ||
    variant === 'dangerSolid' ||
    variant === 'good';
  const bg =
    variant === 'primary'
      ? BB.electric
      : variant === 'chalk'
        ? BB.chalk
        : variant === 'dangerSolid'
          ? BB.bad
          : variant === 'good'
            ? BB.good
            : 'transparent';
  const fg =
    variant === 'primary' || variant === 'chalk' || variant === 'good'
      ? BB.dark
      : variant === 'danger'
        ? BB.bad
        : BB.chalk;
  const border =
    variant === 'outline'
      ? `1px solid ${BB.rule3}`
      : variant === 'danger'
        ? '1px solid rgba(255,46,61,.5)'
        : 'none';
  return (
    <button
      type='button'
      className={`bb-btn${active && !disabled ? ' bb-breathe' : ''}`}
      data-variant={solid ? 'solid' : variant}
      data-locked={locked && !disabled ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        display: block ? 'flex' : 'inline-flex',
        width: block ? '100%' : undefined,
        height: h,
        padding: `0 ${px}px`,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Math.round(18 * scale),
        boxSizing: 'border-box',
        background: bg,
        color: fg,
        border,
        clipPath:
          variant === 'primary' ? cut(Math.round(s.cut * scale)) : undefined,
        opacity: dimmed ? 0.5 : undefined,
        fontFamily: bbDisplay,
        fontWeight: solid ? 800 : 700,
        fontSize: fs,
        letterSpacing: '.06em',
        lineHeight: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...style,
      }}>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
        }}>
        <span>{label}</span>
        {sub ? (
          <span
            style={{
              fontFamily: bbMono,
              fontWeight: 400,
              fontSize: Math.max(8, Math.round(9 * scale)),
              letterSpacing: '.12em',
              opacity: 0.7,
            }}>
            {sub}
          </span>
        ) : null}
      </span>
      {keyBadge ? (
        <span
          style={{
            fontFamily: bbMono,
            fontSize: kbd,
            fontWeight: 600,
            letterSpacing: '.2em',
            border: `2px solid ${fg}`,
            padding: `${Math.round(3 * scale)}px ${Math.round(7 * scale)}px`,
            lineHeight: 1,
          }}>
          {keyBadge}
        </span>
      ) : null}
    </button>
  );
}

export type ChipTone =
  | 'default'
  | 'active'
  | 'electric'
  | 'good'
  | 'amber'
  | 'danger'
  | 'bad';

/** Small mono chip (COPY, KICK, MUTE, PICK A…). `active` = chalk solid. */
export function Chip({
  label,
  tone = 'default',
  active = false,
  dense = false,
  disabled = false,
  leading,
  onClick,
  title,
  style,
}: {
  label: string;
  tone?: ChipTone;
  active?: boolean;
  dense?: boolean;
  disabled?: boolean;
  leading?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const t = active ? 'active' : tone;
  const bg =
    t === 'active'
      ? BB.chalk
      : t === 'electric'
        ? BB.electric
        : t === 'good'
          ? BB.good
          : t === 'amber'
            ? BB.amber
            : t === 'bad'
              ? BB.bad
              : 'transparent';
  const fg =
    t === 'active' || t === 'electric' || t === 'good' || t === 'amber'
      ? BB.dark
      : t === 'danger'
        ? BB.bad
        : BB.chalk;
  const border =
    t === 'default'
      ? `1px solid ${BB.rule3}`
      : t === 'danger'
        ? '1px solid rgba(255,46,61,.5)'
        : '1px solid transparent';
  return (
    <button
      type='button'
      className='bb-btn bb-sweep'
      data-variant='chip'
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: dense ? 28 : 36,
        padding: dense ? '0 10px' : '0 14px',
        boxSizing: 'border-box',
        background: bg,
        color: fg,
        border,
        fontFamily: bbMono,
        fontWeight: 600,
        fontSize: dense ? 10 : 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {leading}
      {label}
    </button>
  );
}

/** Chip's anchor twin — opens in a new tab. */
export function ChipLink({
  label,
  href,
  dense = false,
  style,
}: {
  label: string;
  href: string;
  dense?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className='bb-btn bb-sweep'
      data-variant='chip'
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: dense ? 28 : 36,
        padding: dense ? '0 10px' : '0 14px',
        boxSizing: 'border-box',
        border: `1px solid ${BB.rule3}`,
        color: BB.chalk,
        fontFamily: bbMono,
        fontWeight: 600,
        fontSize: dense ? 10 : 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {label}
    </a>
  );
}

/** Underlined mono link-button (USE A RECORDING INSTEAD / USE THE CAMERA). */
function LinkButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      className='bb-btn'
      onClick={onClick}
      style={{
        padding: '2px 0 6px',
        alignSelf: 'center',
        fontFamily: bbMono,
        fontSize: 10,
        letterSpacing: '.1em',
        color: BB.dim,
        textDecoration: 'underline',
        textUnderlineOffset: 3,
        textTransform: 'uppercase',
        background: 'none',
        border: 'none',
      }}>
      {label}
    </button>
  );
}

/** Hidden file input + underlined link: publish a recorded clip instead. */
export function UseRecordingLink({
  fileMode,
  onUseFile,
}: {
  fileMode?: boolean;
  onUseFile: (file: File) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type='file'
        accept='video/*'
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onUseFile(file);
        }}
      />
      <LinkButton
        label={
          fileMode ? 'PICK A DIFFERENT RECORDING' : 'USE A RECORDING INSTEAD'
        }
        onClick={() => ref.current?.click()}
      />
    </>
  );
}

export function UseCameraLink({ onClick }: { onClick: () => void }) {
  return <LinkButton label='USE THE CAMERA' onClick={onClick} />;
}

/* --------------------------- form controls --------------------------- */

/** Segmented toggle: active = chalk solid + dark 600, rest = 1 px rule. */
export function Segment<T extends string | number>({
  options,
  value,
  onChange,
  height = 44,
  fontSize = 13,
  gap = 4,
  style,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  height?: number;
  fontSize?: number;
  gap?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', gap, ...style }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type='button'
            className='bb-btn'
            data-variant={active ? 'solid' : 'segment'}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              height,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 10px',
              boxSizing: 'border-box',
              background: active ? BB.chalk : 'transparent',
              color: active ? BB.dark : BB.chalk,
              border: active
                ? '1px solid transparent'
                : `1px solid ${BB.rule2}`,
              fontFamily: bbMono,
              fontWeight: active ? 600 : 400,
              fontSize,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** − value + inside one ruled box. */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  render,
  height = 44,
  font = 'display',
  fontSize,
  style,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  render?: (v: number) => string;
  height?: number;
  font?: 'display' | 'mono';
  fontSize?: number;
  style?: React.CSSProperties;
}) {
  const bump = (delta: number) =>
    onChange(
      Math.round(Math.min(max, Math.max(min, value + delta)) * 1000) / 1000,
    );
  const glyph = (g: string, delta: number, disabled: boolean) => (
    <button
      type='button'
      className='bb-btn'
      disabled={disabled}
      onClick={() => bump(delta)}
      style={{
        width: height,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        color: BB.chalk,
        opacity: disabled ? 0.25 : 0.5,
        fontFamily: bbMono,
        fontSize: Math.round(height * 0.4),
        flexShrink: 0,
      }}>
      {g}
    </button>
  );
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: `1px solid ${BB.rule2}`,
        boxSizing: 'border-box',
        ...style,
      }}>
      {glyph('−', -step, value <= min)}
      <span
        style={{
          fontFamily: font === 'display' ? bbDisplay : bbMono,
          fontWeight: font === 'display' ? 800 : 600,
          fontSize:
            fontSize ??
            (font === 'display'
              ? Math.round(height * 0.68)
              : Math.round(height * 0.5)),
          color: BB.chalk,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          textAlign: 'center',
          flex: 1,
          whiteSpace: 'nowrap',
        }}>
        {render ? render(value) : String(value)}
      </span>
      {glyph('+', step, value >= max)}
    </div>
  );
}

/** Big name field: Big Shoulders 800 in a ruled box, electric on focus. */
export function NameField({
  value,
  onChange,
  placeholder,
  maxLength,
  counter = false,
  height = 64,
  fontSize = 38,
  autoCapitalize = 'characters',
  autoFocus,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  counter?: boolean;
  height?: number;
  fontSize?: number;
  autoCapitalize?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'relative',
        height,
        display: 'flex',
        alignItems: 'center',
        ...style,
      }}>
      <input
        value={value}
        onChange={(e) =>
          onChange(
            maxLength != null
              ? e.target.value.slice(0, maxLength)
              : e.target.value,
          )
        }
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        autoComplete='off'
        autoFocus={autoFocus}
        spellCheck={false}
        className='bb-input'
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: `0 ${counter ? Math.round(fontSize * 1.6) : 18}px 0 18px`,
          background: 'transparent',
          border: `1px solid ${BB.rule3}`,
          color: BB.chalk,
          fontFamily: bbDisplay,
          fontWeight: 800,
          fontSize,
          letterSpacing: '.02em',
          textTransform:
            autoCapitalize === 'characters' ? 'uppercase' : undefined,
        }}
      />
      {counter && maxLength != null ? (
        <span
          style={{
            position: 'absolute',
            right: 14,
            fontFamily: bbMono,
            fontSize: 12,
            color: BB.chalk,
            opacity: 0.5,
            pointerEvents: 'none',
          }}>
          {value.length}/{maxLength}
        </span>
      ) : null}
    </div>
  );
}

/** Eight bibs + CUSTOM (native colour input). Values are `#rrggbb`. */
export function JerseyGrid({
  value,
  taken,
  onChange,
  columns = 9,
  gap = 8,
}: {
  value: string;
  /** The other team's colour — shown at .3 so it reads as taken. */
  taken?: string;
  onChange: (hex: string) => void;
  columns?: number;
  gap?: number;
}) {
  const v = value.toLowerCase();
  const custom = !BB_TEAM_COLOR_PRESETS.some((p) => p.color === v);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap,
      }}>
      {BB_TEAM_COLOR_PRESETS.map((p) => {
        const selected = p.color === v;
        const isTaken =
          taken != null && p.color === taken.toLowerCase() && !selected;
        return (
          <button
            key={p.id}
            type='button'
            className='bb-btn'
            title={p.label}
            onClick={() => onChange(p.color)}
            style={{
              aspectRatio: '1',
              background: p.color,
              border: 'none',
              outline: selected
                ? `3px solid ${BB.chalk}`
                : needsOutline(p.color)
                  ? `1px solid ${BB.rule2}`
                  : 'none',
              outlineOffset: selected ? 2 : -1,
              opacity: isTaken ? 0.3 : 1,
              padding: 0,
            }}
          />
        );
      })}
      <label
        title='Custom colour'
        style={{
          position: 'relative',
          aspectRatio: '1',
          border: custom ? `3px solid ${BB.chalk}` : `1px dashed ${BB.rule3}`,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: custom ? value : 'transparent',
          cursor: 'pointer',
          overflow: 'hidden',
        }}>
        {!custom ? (
          <span
            style={{
              fontFamily: bbMono,
              fontSize: 8,
              letterSpacing: '.1em',
              color: BB.chalk,
            }}>
            CUSTOM
          </span>
        ) : null}
        <input
          type='color'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer',
            padding: 0,
            border: 'none',
          }}
        />
      </label>
    </div>
  );
}

/** Labeled dropdown in the kit voice. */
export function BbSelect({
  label,
  value,
  onChange,
  children,
  height = 44,
  style,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        ...style,
      }}>
      {label ? (
        <Meta size={10} tracking={0.22}>
          {label}
        </Meta>
      ) : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='bb-input'
        style={{
          width: '100%',
          height,
          fontFamily: bbMono,
          fontSize: 12,
          letterSpacing: '.08em',
          color: BB.chalk,
          background: 'transparent',
          border: `1px solid ${BB.rule2}`,
          padding: '0 12px',
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}>
        {children}
      </select>
    </label>
  );
}

/* ------------------------------- teams ------------------------------- */

/** Team colour stripe (16 px in the HUD, 8–12 px in apps). */
export function TeamStripe({
  color,
  w = 12,
  h = 22,
  style,
}: {
  color: string;
  w?: number;
  h?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: w,
        height: h,
        background: color,
        outline: needsOutline(color) ? `1px solid ${BB.rule2}` : undefined,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/** Small square swatch (chips, rows). */
export function TeamSwatch({
  color,
  size = 12,
  style,
}: {
  color: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return <TeamStripe color={color} w={size} h={size} style={style} />;
}

/** Stripe + name. */
export function TeamBadge({
  name,
  color,
  size = 22,
  weight = 800,
  style,
}: {
  name: string;
  color: string;
  size?: number;
  weight?: 700 | 800;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.45),
        ...style,
      }}>
      <TeamStripe
        color={color}
        w={Math.max(4, Math.round(size * 0.36))}
        h={Math.round(size * 1.05)}
      />
      <Display size={size} weight={weight}>
        {name}
      </Display>
    </span>
  );
}

/** Legacy name — the setup screen's colour picker is the jersey grid now. */
export function ColorPicker({
  value,
  taken,
  onChange,
}: {
  value: string;
  taken?: string;
  onChange: (hex: string) => void;
}) {
  return <JerseyGrid value={value} taken={taken} onChange={onChange} />;
}

/** stripe · NAME · SCORE : SCORE · NAME · stripe — chalk on asphalt. */
export function ScoreRow({
  teams,
  nameSize = 22,
  scoreSize = 38,
  stripe,
  separator = ':',
  spread = true,
  style,
}: {
  teams: Record<BbTeamId, { name: string; color: string; score: number }>;
  nameSize?: number;
  scoreSize?: number;
  stripe?: { w: number; h: number };
  separator?: string;
  /** Scores pushed to the middle (`margin:auto`), names to the edges. */
  spread?: boolean;
  style?: React.CSSProperties;
}) {
  const st = stripe ?? {
    w: Math.round(nameSize * 0.36),
    h: Math.round(nameSize * 1.36),
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(nameSize * 0.45),
        minWidth: 0,
        ...style,
      }}>
      <TeamStripe color={teams.A.color} w={st.w} h={st.h} />
      <Display
        size={nameSize}
        weight={800}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {teams.A.name}
      </Display>
      <Display
        size={scoreSize}
        weight={900}
        style={{ marginLeft: spread ? 'auto' : undefined }}>
        {teams.A.score}
      </Display>
      <Display size={Math.round(scoreSize * 0.8)} weight={700} color={BB.dim2}>
        {separator}
      </Display>
      <Display
        size={scoreSize}
        weight={900}
        style={{ marginRight: spread ? 'auto' : undefined }}>
        {teams.B.score}
      </Display>
      <Display
        size={nameSize}
        weight={800}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {teams.B.name}
      </Display>
      <TeamStripe color={teams.B.color} w={st.w} h={st.h} />
    </div>
  );
}

/** Legacy name. */
export function ScoreLine({
  teams,
  size = 44,
}: {
  teams: Record<BbTeamId, BbTeamStats>;
  size?: number;
}) {
  return (
    <ScoreRow
      teams={teams}
      scoreSize={size}
      nameSize={Math.round(size * 0.58)}
    />
  );
}

/* ------------------------------ readouts ------------------------------ */

/** Mono clock, semi-bold, tabular. */
export function Clock({
  text,
  size = 34,
  tone = 'chalk',
  style,
}: {
  text: string;
  size?: number;
  tone?: 'chalk' | 'amber' | 'bad' | 'electric' | 'dim';
  style?: React.CSSProperties;
}) {
  const color =
    tone === 'amber'
      ? BB.amber
      : tone === 'bad'
        ? BB.bad
        : tone === 'electric'
          ? BB.electric
          : tone === 'dim'
            ? BB.dim
            : BB.chalk;
  return (
    <Mono
      size={size}
      weight={600}
      tracking={0}
      color={color}
      style={{ lineHeight: 1, ...style }}>
      {text}
    </Mono>
  );
}

export type PillTone =
  | 'live'
  | 'paused'
  | 'onair'
  | 'rec'
  | 'bad'
  | 'idle'
  | 'chalk'
  | 'electric';

/** Status pill: LIVE (good) / PAUSED (amber) / ON AIR (red) / REC (red border). */
export function StatusPill({
  tone,
  size = 10,
  height,
  dot = true,
  style,
  children,
}: {
  tone: PillTone;
  size?: number;
  height?: number;
  dot?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const h = height ?? Math.round(size * 2.6);
  const solidBg =
    tone === 'live'
      ? BB.good
      : tone === 'paused'
        ? BB.amber
        : tone === 'onair' || tone === 'bad'
          ? BB.bad
          : tone === 'chalk'
            ? BB.chalk
            : tone === 'electric'
              ? BB.electric
              : 'transparent';
  const fg =
    tone === 'live' ||
    tone === 'paused' ||
    tone === 'chalk' ||
    tone === 'electric'
      ? BB.dark
      : BB.chalk;
  const border =
    tone === 'rec'
      ? '1px solid rgba(255,46,61,.5)'
      : tone === 'idle'
        ? `1px solid ${BB.rule3}`
        : 'none';
  const dotColor = tone === 'rec' ? BB.bad : fg;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.6),
        height: h,
        padding: `0 ${Math.round(size)}px`,
        background: tone === 'rec' || tone === 'idle' ? BB.plate : solidBg,
        color: fg,
        border,
        boxSizing: 'border-box',
        fontFamily: bbMono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '.2em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        opacity: tone === 'idle' ? 0.8 : 1,
        ...style,
      }}>
      {dot ? (
        <span
          className={
            tone === 'live' || tone === 'onair' || tone === 'rec'
              ? 'bb-pulse'
              : undefined
          }
          style={{
            width: Math.round(size * 0.6),
            height: Math.round(size * 0.6),
            borderRadius: '50%',
            background: tone === 'idle' ? 'transparent' : dotColor,
            border: tone === 'idle' ? `1px solid ${BB.chalk}` : undefined,
            boxSizing: 'border-box',
            flexShrink: 0,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

export type TagTone =
  | 'electric'
  | 'amber'
  | 'bad'
  | 'chalk'
  | 'outline'
  | 'gold'
  | 'good';

/** Tiny mono tag: REG / PAUSED / FROZEN FRAME / WINNER. */
export function TagChip({
  tone = 'electric',
  size = 11,
  style,
  children,
}: {
  tone?: TagTone;
  size?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const bg =
    tone === 'electric'
      ? BB.electric
      : tone === 'amber'
        ? BB.amber
        : tone === 'bad'
          ? BB.bad
          : tone === 'chalk'
            ? BB.chalk
            : tone === 'gold'
              ? BB.goldGrad
              : tone === 'good'
                ? BB.good
                : 'transparent';
  const fg = tone === 'bad' || tone === 'outline' ? BB.chalk : BB.dark;
  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color: fg,
        border: tone === 'outline' ? `1px solid ${BB.rule2}` : 'none',
        padding: `${Math.round(size * 0.27)}px ${Math.round(size * 0.9)}px`,
        fontFamily: bbMono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '.24em',
        textTransform: 'uppercase',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {children}
    </span>
  );
}

/** Stat cell: dim label over a Big Shoulders value, top hairline. */
export function StatCell({
  label,
  value,
  size = 36,
  align = 'left',
}: {
  label: string;
  value: string;
  size?: number;
  align?: 'left' | 'right';
}) {
  return (
    <div
      style={{
        borderTop: `1px solid rgba(232,228,218,.2)`,
        paddingTop: Math.round(size * 0.25),
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(size * 0.12),
        alignItems: align === 'right' ? 'flex-end' : 'flex-start',
        minWidth: 0,
      }}>
      <Meta size={Math.max(9, Math.round(size * 0.33))} tracking={0.18}>
        {label}
      </Meta>
      <Display size={size} weight={800}>
        {value}
      </Display>
    </div>
  );
}

/** Flat progress bar; `indeterminate` sweeps. */
export function ProgressBar({
  value,
  max = 1,
  indeterminate = false,
  width = '100%',
  height = 6,
  color = BB.electric,
  style,
}: {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  width?: number | string;
  height?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  const pct =
    value != null && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: BB.fillStrong,
        overflow: 'hidden',
        ...style,
      }}>
      <div
        className={indeterminate ? 'bb-sweep-bar' : undefined}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: indeterminate ? '45%' : `${pct * 100}%`,
          background: color,
        }}
      />
    </div>
  );
}

/** Ten-segment mic meter: good, then amber, then dim. */
export function MicMeter({
  level,
  muted = false,
  segments = 10,
  height = 10,
  style,
}: {
  level: number;
  muted?: boolean;
  segments?: number;
  height?: number;
  style?: React.CSSProperties;
}) {
  const lit = muted
    ? 0
    : Math.round(Math.max(0, Math.min(1, level)) * segments);
  return (
    <div style={{ display: 'flex', gap: 2, height, ...style }}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            background:
              i < lit
                ? i >= segments - 3
                  ? BB.amber
                  : BB.good
                : BB.fillStrong,
          }}
        />
      ))}
    </div>
  );
}

/** QR on a chalk well (design: chalk square, padding 16 % of the size). */
export function QrBox({
  url,
  size,
  padding,
  style,
}: {
  url: string;
  size: number;
  padding?: number;
  style?: React.CSSProperties;
}) {
  const pad = padding ?? Math.round(size * 0.1);
  return (
    <div
      style={{ background: BB.chalk, padding: pad, lineHeight: 0, ...style }}>
      <QRCode value={url} size={size} fgColor='#141416' bgColor={BB.chalk} />
    </div>
  );
}

/* ------------------------------ warnings ------------------------------ */

/** Warning plate: 6 px tone bar, headline + copy. */
export function WarnPlate({
  tone = 'amber',
  title,
  cutPx = 14,
  style,
  children,
}: {
  tone?: 'amber' | 'bad';
  title?: string;
  cutPx?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const color = tone === 'bad' ? BB.bad : BB.amber;
  return (
    <BbPlate
      cutPx={cutPx}
      leftBar={title ? 6 : 4}
      leftBarColor={color}
      fill={
        title
          ? BB.plate2
          : tone === 'bad'
            ? 'rgba(255,46,61,.12)'
            : 'rgba(255,210,31,.12)'
      }
      style={{
        padding: title ? '16px 20px 16px 22px' : '10px 16px 10px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...style,
      }}>
      {title ? (
        <Display size={22} weight={800} tracking={0.06} color={color}>
          {title}
        </Display>
      ) : null}
      {children ? (
        title ? (
          <Copy size={12} color='rgba(232,228,218,.8)' lineHeight={1.6}>
            {children}
          </Copy>
        ) : (
          <Mono size={12} weight={600} tracking={0.18} color={color}>
            {children}
          </Mono>
        )
      ) : null}
    </BbPlate>
  );
}

/**
 * Slim hazard strip pinned to the top edge — the one honest voice while
 * something is being repaired ("FEED RECONNECTING…"). Tappable for a retry.
 */
export function HazardStrip({
  text,
  tone = 'amber',
  onTap,
  position = 'fixed',
}: {
  text: string;
  tone?: 'amber' | 'bad' | 'good';
  onTap?: () => void;
  position?: 'fixed' | 'absolute';
}) {
  const color = tone === 'bad' ? BB.bad : tone === 'good' ? BB.good : BB.amber;
  const fg = tone === 'bad' ? BB.chalk : BB.dark;
  const stripStyle: React.CSSProperties = {
    position,
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 40,
    padding: '0 16px',
    boxSizing: 'border-box',
    background: hazardStripe(color, 'rgba(20,20,22,.12)'),
    color: fg,
    fontFamily: bbMono,
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: '.22em',
    textTransform: 'uppercase',
    border: 'none',
  };
  const dot = (
    <span
      style={{
        width: 10,
        height: 10,
        border: `2px solid ${fg}`,
        borderRadius: '50%',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    />
  );
  if (onTap) {
    return (
      <button
        type='button'
        onClick={onTap}
        className='bb-btn bb-strip'
        style={stripStyle}>
        {dot}
        {text}
      </button>
    );
  }
  return (
    <div role='status' aria-live='polite' style={stripStyle}>
      {dot}
      {text}
    </div>
  );
}

/* --------------------------- confirm (2-press) --------------------------- */

export type ConfirmAction = {
  id: string;
  label: string;
  confirmLabel?: string;
  /** Card headline ("RESET THE MATCH?"). */
  prompt: string;
  /** Card copy. */
  sub?: string;
};

/** The armed state: headline, copy, KEEP PLAYING / confirm, amber drain. */
export function ConfirmCard({
  title,
  copy,
  confirmLabel,
  keepLabel = 'KEEP PLAYING',
  onConfirm,
  onKeep,
  timeoutMs = 5000,
  scale = 1,
  style,
}: {
  title: string;
  copy?: string;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: () => void;
  onKeep: () => void;
  timeoutMs?: number;
  scale?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: BB.plate2,
        border: '1px solid rgba(255,46,61,.4)',
        padding: Math.round(16 * scale),
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(10 * scale),
        ...style,
      }}>
      <Display size={Math.round(22 * scale)} weight={800} color={BB.bad}>
        {title}
      </Display>
      {copy ? (
        <Copy
          size={Math.max(10, Math.round(12 * scale))}
          color='rgba(232,228,218,.7)'
          lineHeight={1.6}>
          {copy}
        </Copy>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <BbButton
          variant='outline'
          size='sm'
          scale={scale}
          label={keepLabel}
          onClick={onKeep}
          style={{ flex: 1 }}
        />
        <BbButton
          variant='dangerSolid'
          size='sm'
          scale={scale}
          label={confirmLabel}
          active
          onClick={onConfirm}
          style={{ flex: 1 }}
        />
      </div>
      <div
        className='bb-disarm-bar'
        style={{ '--bb-disarm-ms': `${timeoutMs}ms` } as React.CSSProperties}
      />
    </div>
  );
}

/**
 * Destructive-action rail: red outline triggers; arming swaps the rail for a
 * ConfirmCard that disarms itself after `timeoutMs`.
 */
export function BbConfirmRail({
  actions,
  onConfirm,
  timeoutMs = 5000,
  control,
  scale = 1,
  size = 'md',
  buttonStyle,
  style,
}: {
  actions: ConfirmAction[];
  onConfirm: (id: string) => void;
  timeoutMs?: number;
  control?: ReturnType<typeof useArmed>;
  scale?: number;
  size?: BbButtonSize;
  buttonStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}) {
  const internal = useArmed(timeoutMs);
  const { armed, arm, disarm } = control ?? internal;
  const armedAction = actions.find((a) => a.id === armed) ?? null;
  if (armedAction) {
    return (
      <ConfirmCard
        key={armedAction.id}
        title={armedAction.prompt}
        copy={armedAction.sub}
        confirmLabel={armedAction.confirmLabel ?? armedAction.label}
        timeoutMs={timeoutMs}
        scale={scale}
        onKeep={disarm}
        onConfirm={() => {
          disarm();
          onConfirm(armedAction.id);
        }}
        style={style}
      />
    );
  }
  return (
    <div style={{ display: 'flex', gap: 8, ...style }}>
      {actions.map((a) => (
        <BbButton
          key={a.id}
          variant='danger'
          size={size}
          scale={scale}
          label={a.label}
          onClick={() => arm(a.id)}
          style={buttonStyle}
        />
      ))}
    </div>
  );
}

/* ------------------------------- ledger ------------------------------- */

type TeamsLite = Record<BbTeamId, { name: string; color: string }>;

/**
 * One ledger entry: stripe · +n · NAME · meta, with the moderator's
 * controls (assign A / B, 1↔2, VOID) when handlers are passed.
 */
export function LedgerRow({
  shot,
  teams,
  onAssign,
  onPoints,
  onVoid,
  dense = false,
  scale = 1,
  showIndex = true,
}: {
  shot: BbShotEvent;
  teams: TeamsLite;
  onAssign?: (team: BbTeamId) => void;
  onPoints?: (points: 1 | 2) => void;
  onVoid?: () => void;
  dense?: boolean;
  scale?: number;
  showIndex?: boolean;
}) {
  const pending = shot.status === 'pending';
  const voided = shot.status === 'voided';
  const stripeColor = shot.team
    ? teams[shot.team].color
    : pending
      ? BB.amber
      : BB.rule2;
  const pts = Math.round((dense ? 22 : 26) * scale);
  const nm = Math.round((dense ? 20 : 24) * scale);
  const meta = `${showIndex ? `#${shot.index} · ` : ''}${aiGuessLabel(shot)}${shot.period === 'ot' ? ' · OT' : ''}${voided ? ' · VOID' : pending ? ' · PENDING' : ''}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: Math.round((dense ? 10 : 14) * scale),
        padding: `${Math.round((dense ? 8 : 12) * scale)}px 0`,
        borderTop: `1px solid ${BB.rule}`,
        opacity: voided ? 0.5 : 1,
        flexWrap: 'wrap',
        minWidth: 0,
      }}>
      <TeamStripe
        color={stripeColor}
        w={Math.max(4, Math.round(6 * scale))}
        h={Math.round((dense ? 22 : 28) * scale)}
      />
      <Display
        size={pts}
        weight={900}
        color={voided ? BB.dim : BB.electric}
        style={{
          minWidth: Math.round(30 * scale),
          textDecoration: voided ? 'line-through' : undefined,
        }}>
        +{shot.points}
      </Display>
      <Display
        size={nm}
        weight={800}
        color={voided ? BB.dim : BB.chalk}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '40%',
        }}>
        {shot.team ? teams[shot.team].name : pending ? 'WHO?' : '—'}
      </Display>
      <Meta
        size={Math.max(9, Math.round(10 * scale))}
        tracking={0.1}
        color={BB.dim}
        style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        {meta}
      </Meta>
      {onAssign || onPoints || onVoid ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexBasis: dense ? '100%' : undefined,
            flexWrap: 'wrap',
          }}>
          {onAssign
            ? (['A', 'B'] as const).map((t) => {
                const on = shot.team === t && !voided;
                return (
                  <Chip
                    key={t}
                    dense
                    label={teams[t].name}
                    active={on}
                    leading={<TeamSwatch color={teams[t].color} size={8} />}
                    onClick={() => onAssign(t)}
                  />
                );
              })
            : null}
          {onPoints ? (
            <>
              <Chip
                dense
                label='1'
                active={shot.points === 1}
                onClick={() => onPoints(1)}
              />
              <Chip
                dense
                label='2'
                active={shot.points === 2}
                onClick={() => onPoints(2)}
              />
            </>
          ) : null}
          {onVoid && !voided ? (
            <Chip dense tone='danger' label='VOID' onClick={onVoid} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Legacy name — the ledger row. */
export function ShotRow(props: {
  shot: BbShotEvent;
  teams: TeamsLite;
  onAssign?: (team: BbTeamId) => void;
  onPoints?: (points: 1 | 2) => void;
  onVoid?: () => void;
  dense?: boolean;
}) {
  return <LedgerRow {...props} />;
}

/**
 * REF CALL card: the moderator's pending make. Team buttons keep the
 * text chalk on a plate with a 2 px team border + stripe (never text on
 * the team colour), NO BASKET in red outline, VALUE as a segment.
 */
export function RefCallCard({
  shot,
  teams,
  index = 0,
  total = 1,
  arcPoints = 2,
  onAssign,
  onPoints,
  onVoid,
  compact = false,
  clockLabel,
  keysHint,
  scale = 1,
  right,
  stillUrl,
}: {
  shot: BbShotEvent;
  teams: TeamsLite;
  index?: number;
  total?: number;
  arcPoints?: 1 | 2;
  onAssign: (team: BbTeamId) => void;
  onPoints: (points: 1 | 2) => void;
  onVoid: () => void;
  /** Tablet: A / B / NO BASKET in one row. */
  compact?: boolean;
  /** Match clock at the make ("06:31"), if known. */
  clockLabel?: string;
  keysHint?: string;
  scale?: number;
  right?: React.ReactNode;
  /** Resolved (absolute) still URL; defaults to the shot's own frame path. */
  stillUrl?: string | null;
}) {
  const still = stillUrl ?? shot.releaseFrameUrl ?? shot.frameUrl ?? null;
  const pctA =
    shot.aiTeam === 'A'
      ? shot.aiConfidence
      : shot.aiTeam === 'B'
        ? 1 - shot.aiConfidence
        : 0.5;
  const aiLine =
    shot.source !== 'ai'
      ? aiGuessLabel(shot)
      : `AI: A ${Math.round(pctA * 100)}% · B ${Math.round((1 - pctA) * 100)}%`;
  const leadTeam = shot.aiTeam;
  const teamBtn = (t: BbTeamId) => (
    <button
      key={t}
      type='button'
      className='bb-btn'
      onClick={() => onAssign(t)}
      style={{
        height: Math.round(56 * scale),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Math.round(10 * scale),
        background: BB.plate,
        border: `2px solid ${teams[t].color}`,
        color: BB.chalk,
        fontFamily: bbDisplay,
        fontWeight: 800,
        fontSize: Math.round(24 * scale),
        textTransform: 'uppercase',
        boxSizing: 'border-box',
        minWidth: 0,
        padding: '0 8px',
      }}>
      <TeamStripe
        color={teams[t].color}
        w={Math.round(8 * scale)}
        h={Math.round(28 * scale)}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {teams[t].name}
      </span>
      <Mono
        size={Math.max(8, Math.round(10 * scale))}
        tracking={0.1}
        color={BB.chalk}
        style={{ opacity: 0.5 }}>
        {t}
      </Mono>
    </button>
  );
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(12 * scale),
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(10 * scale),
        }}>
        <div
          style={{
            position: 'relative',
            width: Math.round(96 * scale),
            height: Math.round(54 * scale),
            background: still
              ? `#111 url(${still}) center/cover`
              : 'radial-gradient(ellipse at 50% 40%,#2c2c30,#161618 75%)',
            flexShrink: 0,
          }}>
          {!still ? (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: '50%',
                top: '30%',
                width: Math.round(34 * scale),
                height: Math.round(10 * scale),
                marginLeft: -Math.round(17 * scale),
                border: `2px solid ${BB.ballOrange}`,
                borderRadius: '50%',
              }}
            />
          ) : null}
          {total > 1 ? (
            <span
              style={{
                position: 'absolute',
                left: 4,
                top: 4,
                background: BB.plate,
                padding: '1px 4px',
                fontFamily: bbMono,
                fontSize: 8,
                letterSpacing: '.2em',
                color: BB.chalk,
              }}>
              {index + 1} / {total}
            </span>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 0,
          }}>
          <Mono size={Math.max(10, Math.round(12 * scale))} tracking={0.1}>
            {clockLabel ? `${clockLabel} · ` : ''}WHO SCORED?
          </Mono>
          <Mono
            size={Math.max(10, Math.round(12 * scale))}
            tracking={0.1}
            color={BB.chalk}
            style={{ opacity: 0.7 }}>
            {shot.source !== 'ai' ? (
              aiLine
            ) : (
              <>
                AI:{' '}
                <span
                  style={{
                    fontWeight: 600,
                    color: leadTeam ? teams[leadTeam].color : BB.chalk,
                    opacity: 1,
                  }}>
                  {leadTeam ?? '?'} {Math.round(shot.aiConfidence * 100)}%
                </span>
                {leadTeam
                  ? ` · ${leadTeam === 'A' ? 'B' : 'A'} ${Math.round((1 - shot.aiConfidence) * 100)}%`
                  : ''}
              </>
            )}
          </Mono>
        </div>
        {right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: 8,
        }}>
        {teamBtn('A')}
        {teamBtn('B')}
        <BbButton
          variant='danger'
          size='md'
          scale={scale}
          label='NO BASKET'
          onClick={onVoid}
          style={{
            gridColumn: compact ? undefined : '1 / -1',
            fontWeight: 800,
            letterSpacing: '.04em',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Meta size={Math.max(9, Math.round(11 * scale))} tracking={0.2}>
          VALUE
        </Meta>
        <Segment
          height={Math.round(36 * scale)}
          fontSize={Math.max(9, Math.round(11 * scale))}
          gap={6}
          style={{ flex: 'initial' }}
          options={[
            { value: 1, label: '1 PT' },
            { value: 2, label: arcPoints === 2 ? '2 PT · ARC' : '2 PT' },
          ]}
          value={shot.points}
          onChange={(v) => onPoints(v as 1 | 2)}
        />
        {keysHint ? (
          <Meta
            size={Math.max(9, Math.round(11 * scale))}
            tracking={0.2}
            color={BB.dim2}
            style={{ marginLeft: 'auto' }}>
            {keysHint}
          </Meta>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------ recording ------------------------------ */

/** Floating REC chip for the host arcade. */
export function BbRecChip({
  rec,
  scale = 1,
}: {
  rec: KbtRecording;
  scale?: number;
}) {
  const on = rec.effectiveIsRecording;
  const label = rec.isWaitingForDownload
    ? 'SAVING MP4…'
    : on
      ? 'REC · TAP TO STOP'
      : 'RECORD SHOW';
  return (
    <button
      type='button'
      className='bb-btn'
      disabled={rec.isToggling || rec.isWaitingForDownload}
      onClick={() => void rec.toggle()}
      title={
        on
          ? 'Stop recording — the mp4 downloads when it finalizes'
          : 'Record everything viewers see + hear as an mp4'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        height: Math.round(36 * scale),
        padding: `0 ${Math.round(16 * scale)}px`,
        background: BB.plate,
        border: on ? '1px solid rgba(255,46,61,.5)' : `1px solid ${BB.rule2}`,
        color: BB.chalk,
        fontFamily: bbMono,
        fontWeight: 600,
        fontSize: Math.max(9, Math.round(12 * scale)),
        letterSpacing: '.24em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
      <span
        className={on && !rec.isWaitingForDownload ? 'bb-pulse' : undefined}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: on ? BB.bad : 'transparent',
          border: on ? 'none' : `1px solid ${BB.chalk}`,
          boxSizing: 'border-box',
        }}
      />
      {label}
    </button>
  );
}

/** RECORDING controls for the moderator's CAMERAS plate. */
export function BbRecordingPlate({ rec }: { rec: KbtRecording }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        borderTop: `1px solid ${BB.rule}`,
        paddingTop: 10,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <Meta size={10} tracking={0.2}>
          RECORDING
        </Meta>
        {rec.effectiveIsRecording ? (
          <StatusPill tone='rec' size={9}>
            REC
          </StatusPill>
        ) : null}
      </div>
      {rec.isWaitingForDownload ? (
        <BbButton
          block
          disabled
          size='sm'
          variant='outline'
          label='SAVING MP4…'
        />
      ) : rec.effectiveIsRecording ? (
        <BbButton
          block
          size='sm'
          variant='dangerSolid'
          active
          locked={rec.isToggling}
          label='STOP + DOWNLOAD'
          onClick={() => void rec.toggle()}
        />
      ) : (
        <BbButton
          block
          size='sm'
          variant='outline'
          locked={rec.isToggling}
          label='START RECORDING'
          onClick={() => void rec.toggle()}
        />
      )}
      <Meta size={9} tracking={0.16}>
        records everything viewers see + hear
      </Meta>
    </div>
  );
}

/** Webcam / mic dropdowns for a laptop moderator (same logic as kettlebell's). */
export function BbDevicePickers({ rig }: { rig: CommentatorRig }) {
  if (!rig.camOn || rig.videoDevices.length + rig.audioDevices.length === 0)
    return null;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {rig.videoDevices.length > 0 ? (
        <BbSelect
          label='CAMERA'
          value={rig.videoDeviceId ?? ''}
          onChange={(id) => void rig.selectDevices({ videoId: id })}
          style={{ flex: 1 }}>
          {rig.videoDevices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `CAMERA ${i + 1}`}
            </option>
          ))}
        </BbSelect>
      ) : null}
      {rig.audioDevices.length > 0 ? (
        <BbSelect
          label='MICROPHONE'
          value={rig.audioDeviceId ?? ''}
          onChange={(id) => void rig.selectDevices({ audioId: id })}
          style={{ flex: 1 }}>
          {rig.audioDevices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `MICROPHONE ${i + 1}`}
            </option>
          ))}
        </BbSelect>
      ) : null}
    </div>
  );
}

/* ------------------------------- frame ------------------------------- */

/** Footer key hints: `ENTER · START`, keys in chalk 600. */
export function FooterHints({
  hints,
  right,
  size = 10,
  style,
}: {
  hints: { key: string; label: string }[];
  right?: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        minWidth: 0,
        ...style,
      }}>
      {hints.map((h) => (
        <Mono
          key={h.key + h.label}
          size={size}
          tracking={0.22}
          color={BB.chalk}
          style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600, opacity: 1 }}>{h.key}</span> ·{' '}
          {h.label}
        </Mono>
      ))}
      {right ? (
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minWidth: 0,
          }}>
          {right}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Host screen shell for the 1280×720 stage: wordmark + section title +
 * meta (top), content, an action row, and the footer hint rail. Scale is
 * 2/3 of the 1920×1080 design.
 */
export function HostFrame({
  title,
  meta,
  actions,
  hints,
  hintsRight,
  background,
  contentStyle,
  children,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  hints?: { key: string; label: string }[];
  hintsRight?: React.ReactNode;
  /** Extra background layers (textures) behind the content. */
  background?: React.ReactNode;
  contentStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className='bb-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: BB.page,
        overflow: 'hidden',
      }}>
      {background}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 16,
            padding: '26px 53px 0',
          }}>
          <Wordmark size={29} />
          {typeof title === 'string' ? (
            <Display
              size={29}
              weight={700}
              tracking={0.14}
              style={{ opacity: 0.9 }}>
              {title}
            </Display>
          ) : (
            title
          )}
          <div style={{ flex: 1 }} />
          {meta}
        </div>
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            padding: '20px 53px 0',
            display: 'flex',
            flexDirection: 'column',
            ...contentStyle,
          }}>
          {children}
        </div>
        {actions ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 53px 0',
            }}>
            {actions}
          </div>
        ) : null}
        <div
          style={{
            height: 37,
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            padding: '0 53px',
            borderTop: `1px solid ${BB.rule}`,
          }}>
          <FooterHints
            hints={hints ?? []}
            right={hintsRight}
            size={10}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  );
}
