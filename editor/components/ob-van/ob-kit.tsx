'use client';

import React from 'react';
import QRCode from 'react-qr-code';
import type { ObCam, ObSignalSummary, ObTally } from '@smelter-editor/types';
import { ArcadeStage } from '@/lib/arcade/stage';
import { useArmed } from '@/lib/arcade/use-armed';
import { useIsLandscape } from '@/lib/arcade/use-viewport';
import type { KbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import { roleLabel } from '@/lib/ob-van/roles';
import { TALLY_LABEL } from '@/lib/ob-van/tally';

/* ------------------------------------------------------------------ *
 * OB Van kit — the design language of the AI-director module: a
 * broadcast control room. Charcoal desk, hairline plates with a 3 px
 * radius, lit keys. Red is ONLY program / on air, green is ONLY preview,
 * sky blue is ONLY the AI (auto pilot, LLM). Barlow Condensed for labels
 * and numbers, IBM Plex Mono for time, status and signals. Host screens
 * lay out in the shared 1280×720 arcade stage; phones use <ObPhoneShell>.
 * A pruned port of the Touchline kit (fb-kit.tsx) — never mix the two on
 * one page.
 * ------------------------------------------------------------------ */

export { useArmed, useIsLandscape };
export { STAGE_W, STAGE_H } from '@/lib/arcade/stage';

export const OB = {
  page: '#0A0C10',
  plate: '#12151B',
  plate2: '#171B23',
  well: '#0D1015',
  chalk: '#E6E9EF',
  dark: '#0A0C10',
  program: '#FF2D2D',
  programDim: 'rgba(255,45,45,.16)',
  preview: '#22C55E',
  previewDim: 'rgba(34,197,94,.16)',
  accent: '#38BDF8',
  accentDim: 'rgba(56,189,248,.14)',
  amber: '#F5B301',
  amberDim: 'rgba(245,179,1,.14)',
  good: '#22C55E',
  bad: '#FF2D2D',
  scrim: 'rgba(10,12,16,.86)',
  rule: 'rgba(230,233,239,.08)',
  rule2: 'rgba(230,233,239,.16)',
  rule3: 'rgba(230,233,239,.28)',
  dim: 'rgba(230,233,239,.62)',
  dim2: 'rgba(230,233,239,.4)',
  fill: 'rgba(230,233,239,.05)',
  fillStrong: 'rgba(230,233,239,.11)',
} as const;

export const obDisplay =
  "var(--font-ob-display), 'Barlow Condensed', 'Arial Narrow', sans-serif";
export const obMono = "var(--font-ob-mono), 'IBM Plex Mono', monospace";

export const RADIUS = 3;

/** Signal meter tones map to the three meanings of the desk. */
export type ObTone =
  | 'chalk'
  | 'program'
  | 'preview'
  | 'accent'
  | 'amber'
  | 'dim';

export function toneColor(tone: ObTone): string {
  switch (tone) {
    case 'program':
      return OB.program;
    case 'preview':
      return OB.preview;
    case 'accent':
      return OB.accent;
    case 'amber':
      return OB.amber;
    case 'dim':
      return OB.dim2;
    default:
      return OB.chalk;
  }
}

export function tallyColor(tally: ObTally): string {
  return tally === 'program'
    ? OB.program
    : tally === 'preview'
      ? OB.preview
      : OB.rule2;
}

/** Faint scan-line texture for monitors and the title backdrop. */
export const scanLines = (alpha = 0.04, pitch = 3): string =>
  `repeating-linear-gradient(0deg, rgba(230,233,239,${alpha}) 0 1px, transparent 1px ${pitch}px)`;

/** Desk grid (title / connect backdrops). */
export const deskGrid = (alpha = 0.035, pitch = 40): string =>
  `linear-gradient(rgba(230,233,239,${alpha}) 1px, transparent 1px), linear-gradient(90deg, rgba(230,233,239,${alpha}) 1px, transparent 1px)`;

/* ------------------------------- stage ------------------------------- */

/** The 1280×720 arcade stage on the desk colour. */
export function ObStage({ children }: { children: React.ReactNode }) {
  return <ArcadeStage background={OB.page}>{children}</ArcadeStage>;
}

/* -------------------------------- type -------------------------------- */

/** Barlow Condensed display text. `tracking` is in em. */
export function Display({
  size,
  weight = 700,
  color = OB.chalk,
  tracking = 0.02,
  lineHeight = 1,
  uppercase = true,
  style,
  children,
}: {
  size: number;
  weight?: 500 | 600 | 700 | 800;
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
        fontFamily: obDisplay,
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

/** IBM Plex Mono: time, counts, status, signals. `tracking` in em. */
export function Mono({
  size = 12,
  weight = 400,
  color = OB.chalk,
  tracking = 0.14,
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
        fontFamily: obMono,
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
  size = 10,
  tracking = 0.18,
  color = OB.dim,
  weight = 500,
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

/** Mono body copy (sentence case). */
export function Copy({
  size = 12,
  color = OB.dim,
  lineHeight = 1.6,
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
        fontFamily: obMono,
        fontSize: size,
        lineHeight,
        color,
        ...style,
      }}>
      {children}
    </span>
  );
}

/** OB ● VAN — the wordmark; the dot is a tally lamp (lit = on air). */
export function Wordmark({
  size,
  lit = true,
  style,
}: {
  size: number;
  /** Red lamp; unlit it is an outline. */
  lit?: boolean;
  style?: React.CSSProperties;
}) {
  const dot = Math.round(size * 0.34);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.16),
        fontFamily: obDisplay,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 0.9,
        letterSpacing: '0.04em',
        color: OB.chalk,
        whiteSpace: 'nowrap',
        ...style,
      }}>
      <span>OB</span>
      <span
        aria-hidden
        className={lit ? 'ob-pulse' : undefined}
        style={{
          width: dot,
          height: dot,
          borderRadius: '50%',
          background: lit ? OB.program : 'transparent',
          border: lit ? 'none' : `2px solid ${OB.rule3}`,
          boxShadow: lit
            ? `0 0 ${Math.round(size * 0.4)}px rgba(255,45,45,.55)`
            : 'none',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      />
      <span>VAN</span>
    </span>
  );
}

/* ------------------------------- plates ------------------------------- */

/**
 * The desk plate: plate fill, 1 px hairline, 3 px radius. A plate with a
 * `title` gets a label strip (mono caps) and an optional right slot; `bar`
 * draws a 3 px tone stripe on the left edge (AI plates use the accent).
 */
export function ObPlate({
  title,
  right,
  bar,
  fill = OB.plate,
  border = OB.rule,
  padding = 14,
  gap = 10,
  scroll = false,
  className,
  style,
  bodyStyle,
  children,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  bar?: string;
  fill?: string;
  border?: string;
  padding?: number | string;
  gap?: number;
  /** The body scrolls (the plate must get a bounded height). */
  scroll?: boolean;
  className?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={className}
      style={{
        position: 'relative',
        background: fill,
        border: `1px solid ${border}`,
        borderRadius: RADIUS,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // A plate keeps its content height inside a scrolling column; only
        // a scrolling plate may be squeezed by its parent.
        flexShrink: scroll ? 1 : 0,
        overflow: 'hidden',
        ...style,
      }}>
      {bar ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: bar,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {title != null ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            minHeight: 30,
            padding: '0 12px',
            borderBottom: `1px solid ${OB.rule}`,
            background: 'rgba(230,233,239,.025)',
            flexShrink: 0,
          }}>
          {typeof title === 'string' ? (
            <Mono size={10} weight={600} tracking={0.2} color={OB.dim}>
              {title}
            </Mono>
          ) : (
            title
          )}
          {right ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
              }}>
              {right}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={scroll ? 'ob-scroll' : undefined}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap,
          padding,
          overflowY: scroll ? 'auto' : undefined,
          ...bodyStyle,
        }}>
        {children}
      </div>
    </section>
  );
}

/** Section head: condensed title left, mono meta right. */
export function PlateHead({
  size = 20,
  color = OB.chalk,
  right,
  style,
  children,
}: {
  size?: number;
  color?: string;
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
      <Display size={size} weight={700} tracking={0.04} color={color}>
        {children}
      </Display>
      {right}
    </div>
  );
}

/* ------------------------------ buttons ------------------------------ */

export type ObButtonVariant =
  | 'primary'
  | 'program'
  | 'preview'
  | 'ai'
  | 'outline'
  | 'danger'
  | 'dangerSolid'
  | 'ghost';
export type ObButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const BTN_SIZE: Record<ObButtonSize, { h: number; fs: number; px: number }> = {
  lg: { h: 56, fs: 26, px: 28 },
  md: { h: 44, fs: 20, px: 20 },
  sm: { h: 34, fs: 16, px: 14 },
  xs: { h: 26, fs: 13, px: 10 },
};

function solidColors(variant: ObButtonVariant): {
  bg: string;
  fg: string;
} | null {
  switch (variant) {
    case 'primary':
      return { bg: OB.chalk, fg: OB.dark };
    case 'program':
    case 'dangerSolid':
      return { bg: OB.program, fg: '#fff' };
    case 'preview':
      return { bg: OB.preview, fg: OB.dark };
    case 'ai':
      return { bg: OB.accent, fg: OB.dark };
    default:
      return null;
  }
}

/**
 * The kit's action button. `primary` = chalk (the one thing to press),
 * `program` = red (goes on air), `preview` = green, `ai` = accent,
 * `outline` = hairline, `danger` = red outline, `ghost` = text only.
 * `keyBadge` prints the keyboard key; `pending` runs the echo bar.
 */
export function ObButton({
  label,
  keyBadge,
  sub,
  variant = 'outline',
  size = 'md',
  block = false,
  active = false,
  disabled = false,
  locked = false,
  pending = false,
  onClick,
  title,
  style,
}: {
  label: React.ReactNode;
  keyBadge?: string;
  sub?: string;
  variant?: ObButtonVariant;
  size?: ObButtonSize;
  block?: boolean;
  /** Breathe — "press me". */
  active?: boolean;
  disabled?: boolean;
  /** Momentarily unresponsive without the disabled dim. */
  locked?: boolean;
  /** Sent, waiting for the server to echo it. */
  pending?: boolean;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const s = BTN_SIZE[size];
  const solid = solidColors(variant);
  const fg = solid ? solid.fg : variant === 'danger' ? OB.program : OB.chalk;
  const border = solid
    ? '1px solid transparent'
    : variant === 'danger'
      ? '1px solid rgba(255,45,45,.55)'
      : variant === 'ghost'
        ? '1px solid transparent'
        : `1px solid ${OB.rule3}`;
  return (
    <button
      type='button'
      className={`ob-btn${active && !disabled ? ' ob-breathe' : ''}`}
      data-variant={solid ? 'solid' : variant}
      data-locked={locked && !disabled ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-busy={pending || undefined}
      style={{
        display: block ? 'flex' : 'inline-flex',
        width: block ? '100%' : undefined,
        height: s.h,
        padding: `0 ${s.px}px`,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        boxSizing: 'border-box',
        background: solid ? solid.bg : 'transparent',
        color: fg,
        border,
        borderRadius: RADIUS,
        overflow: 'hidden',
        fontFamily: obDisplay,
        fontWeight: 700,
        fontSize: s.fs,
        letterSpacing: '.06em',
        lineHeight: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          minWidth: 0,
        }}>
        <span>{label}</span>
        {sub ? (
          <span
            style={{
              fontFamily: obMono,
              fontWeight: 500,
              fontSize: Math.max(8, Math.round(s.fs * 0.42)),
              letterSpacing: '.12em',
              opacity: 0.72,
            }}>
            {sub}
          </span>
        ) : null}
      </span>
      {keyBadge ? <KeyBadge color={fg}>{keyBadge}</KeyBadge> : null}
      {pending ? <span className='ob-pending-bar' aria-hidden /> : null}
    </button>
  );
}

/** A keyboard key printed on a button / hint. */
export function KeyBadge({
  color = OB.chalk,
  size = 10,
  children,
}: {
  color?: string;
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: obMono,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '.12em',
        border: `1px solid ${color}`,
        borderRadius: 2,
        padding: '2px 5px',
        lineHeight: 1,
        opacity: 0.75,
        color,
        whiteSpace: 'nowrap',
      }}>
      {children}
    </span>
  );
}

export type ChipTone =
  | 'default'
  | 'active'
  | 'accent'
  | 'program'
  | 'preview'
  | 'amber'
  | 'danger';

/** Small mono chip (COPY, KICK, L3…). `active` = chalk solid. */
export function Chip({
  label,
  tone = 'default',
  active = false,
  dense = false,
  disabled = false,
  pending = false,
  leading,
  onClick,
  title,
  style,
}: {
  label: React.ReactNode;
  tone?: ChipTone;
  active?: boolean;
  dense?: boolean;
  disabled?: boolean;
  pending?: boolean;
  leading?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const t = active && tone === 'default' ? 'active' : tone;
  const solid = active || t === 'active';
  const color =
    t === 'program' || t === 'danger'
      ? OB.program
      : t === 'preview'
        ? OB.preview
        : t === 'accent'
          ? OB.accent
          : t === 'amber'
            ? OB.amber
            : OB.chalk;
  const bg = solid ? color : 'transparent';
  const fg = solid
    ? t === 'program' || t === 'danger'
      ? '#fff'
      : OB.dark
    : t === 'default'
      ? OB.chalk
      : color;
  const border = solid
    ? `1px solid ${color}`
    : t === 'default'
      ? `1px solid ${OB.rule3}`
      : `1px solid ${color}88`;
  return (
    <button
      type='button'
      className='ob-btn'
      data-variant={solid ? 'solid' : 'chip'}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={active || undefined}
      aria-busy={pending || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: dense ? 24 : 30,
        padding: dense ? '0 8px' : '0 12px',
        boxSizing: 'border-box',
        background: bg,
        color: fg,
        border,
        borderRadius: 2,
        overflow: 'hidden',
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: dense ? 9.5 : 10.5,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}>
      {leading}
      {label}
      {pending ? <span className='ob-pending-bar' aria-hidden /> : null}
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
      className='ob-btn'
      data-variant='chip'
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: dense ? 24 : 30,
        padding: dense ? '0 8px' : '0 12px',
        boxSizing: 'border-box',
        border: `1px solid ${OB.rule3}`,
        borderRadius: 2,
        color: OB.chalk,
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: dense ? 9.5 : 10.5,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {label}
    </a>
  );
}

/* --------------------------- form controls --------------------------- */

/** Segmented toggle: active = chalk solid, rest = hairline. */
export function Segment<T extends string | number>({
  options,
  value,
  onChange,
  height = 34,
  fontSize = 11,
  gap = 4,
  tone = 'chalk',
  style,
}: {
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  height?: number;
  fontSize?: number;
  gap?: number;
  /** Active fill: chalk (settings) or accent (AI settings). */
  tone?: 'chalk' | 'accent';
  style?: React.CSSProperties;
}) {
  const on = tone === 'accent' ? OB.accent : OB.chalk;
  return (
    <div role='radiogroup' style={{ display: 'flex', gap, ...style }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type='button'
            role='radio'
            aria-checked={active}
            className='ob-btn'
            data-variant={active ? 'solid' : 'segment'}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              height,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 8px',
              boxSizing: 'border-box',
              background: active ? on : 'transparent',
              color: active ? OB.dark : OB.chalk,
              border: active ? `1px solid ${on}` : `1px solid ${OB.rule2}`,
              borderRadius: 2,
              fontFamily: obMono,
              fontWeight: active ? 600 : 500,
              fontSize,
              letterSpacing: '.12em',
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

/** − value + inside one hairline box. */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  render,
  height = 30,
  fontSize,
  disabled = false,
  label,
  style,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  render?: (v: number) => string;
  height?: number;
  fontSize?: number;
  disabled?: boolean;
  /** Accessible name for the − / + buttons. */
  label?: string;
  style?: React.CSSProperties;
}) {
  const bump = (delta: number) =>
    onChange(
      Math.round(Math.min(max, Math.max(min, value + delta)) * 1000) / 1000,
    );
  const glyph = (g: string, delta: number, off: boolean, aria: string) => (
    <button
      type='button'
      className='ob-btn'
      disabled={off || disabled}
      aria-label={aria}
      onClick={() => bump(delta)}
      style={{
        width: height,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: OB.chalk,
        opacity: off ? 0.25 : 0.6,
        fontFamily: obMono,
        fontSize: Math.round(height * 0.5),
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
        border: `1px solid ${OB.rule2}`,
        borderRadius: 2,
        boxSizing: 'border-box',
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}>
      {glyph('−', -step, value <= min, `${label ?? 'value'} down`)}
      <span
        style={{
          fontFamily: obMono,
          fontWeight: 600,
          fontSize: fontSize ?? Math.round(height * 0.4),
          color: OB.chalk,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          textAlign: 'center',
          flex: 1,
          whiteSpace: 'nowrap',
        }}>
        {render ? render(value) : String(value)}
      </span>
      {glyph('+', step, value >= max, `${label ?? 'value'} up`)}
    </div>
  );
}

/** On / off switch with a mono label. */
export function Toggle({
  on,
  onChange,
  label,
  tone = 'preview',
  disabled = false,
  pending = false,
  style,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  tone?: 'preview' | 'accent' | 'program' | 'amber';
  disabled?: boolean;
  pending?: boolean;
  style?: React.CSSProperties;
}) {
  const color =
    tone === 'accent'
      ? OB.accent
      : tone === 'program'
        ? OB.program
        : tone === 'amber'
          ? OB.amber
          : OB.preview;
  return (
    <button
      type='button'
      role='switch'
      aria-checked={on}
      aria-busy={pending || undefined}
      className='ob-btn'
      data-variant='toggle'
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        height: 30,
        color: OB.chalk,
        ...style,
      }}>
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 38,
          height: 20,
          borderRadius: 10,
          background: on ? color : OB.fillStrong,
          border: `1px solid ${on ? color : OB.rule3}`,
          boxSizing: 'border-box',
          transition: 'background-color .12s ease',
          flexShrink: 0,
        }}>
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 20 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: on ? OB.dark : OB.chalk,
            transition: 'left .12s ease',
          }}
        />
      </span>
      {label ? (
        <Mono
          size={10.5}
          weight={600}
          tracking={0.14}
          color={on ? OB.chalk : OB.dim}>
          {label}
        </Mono>
      ) : null}
      {pending ? (
        <span className='ob-blink'>
          <Mono size={9} tracking={0.14} color={OB.dim2}>
            …
          </Mono>
        </span>
      ) : null}
    </button>
  );
}

/** One-line text field (event name, camera name, talent). */
export function TextField({
  value,
  onChange,
  placeholder,
  maxLength,
  height = 36,
  fontSize = 14,
  display = false,
  autoFocus,
  onEnter,
  onBlur,
  label,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  height?: number;
  fontSize?: number;
  /** Condensed display face (names), else mono. */
  display?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  onBlur?: () => void;
  /** Accessible name when there is no visible label. */
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
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
      aria-label={label ?? placeholder}
      autoComplete='off'
      autoFocus={autoFocus}
      spellCheck={false}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      className='ob-input'
      style={{
        width: '100%',
        height,
        boxSizing: 'border-box',
        padding: '0 10px',
        background: OB.well,
        border: `1px solid ${OB.rule2}`,
        color: OB.chalk,
        fontFamily: display ? obDisplay : obMono,
        fontWeight: display ? 700 : 500,
        fontSize,
        letterSpacing: display ? '.03em' : '.02em',
        minWidth: 0,
        ...style,
      }}
    />
  );
}

/** Multi-line field (the AI brief, the RAW JSON drawer). */
export function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 5,
  fontSize = 12,
  label,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  fontSize?: number;
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) =>
        onChange(
          maxLength != null
            ? e.target.value.slice(0, maxLength)
            : e.target.value,
        )
      }
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      rows={rows}
      spellCheck={false}
      className='ob-input ob-scroll'
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        background: OB.well,
        border: `1px solid ${OB.rule2}`,
        color: OB.chalk,
        fontFamily: obMono,
        fontSize,
        lineHeight: 1.55,
        resize: 'none',
        ...style,
      }}
    />
  );
}

export function ObSelect({
  label,
  value,
  onChange,
  children,
  height = 30,
  disabled = false,
  title,
  style,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  height?: number;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 0,
        ...style,
      }}>
      {label ? <Meta size={9}>{label}</Meta> : null}
      <select
        value={value}
        title={title}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className='ob-input'
        style={{
          width: '100%',
          height,
          fontFamily: obMono,
          fontSize: 11,
          letterSpacing: '.06em',
          color: OB.chalk,
          background: OB.well,
          border: `1px solid ${OB.rule2}`,
          padding: '0 8px',
          cursor: disabled ? 'default' : 'pointer',
          textTransform: 'uppercase',
          opacity: disabled ? 0.5 : 1,
        }}>
        {children}
      </select>
    </label>
  );
}

/** Label over a control. */
export function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        ...style,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}>
        <Meta size={9.5}>{label}</Meta>
        {hint ? (
          <Meta size={9} tracking={0.08} color={OB.dim2}>
            {hint}
          </Meta>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------ status ------------------------------ */

export type PillTone =
  | 'onair'
  | 'preview'
  | 'ai'
  | 'amber'
  | 'idle'
  | 'rec'
  | 'chalk';

/** Status pill: ON AIR (red) / PREVIEW (green) / AUTO (accent) / REC. */
export function StatusPill({
  tone,
  size = 10,
  dot = true,
  pulse,
  style,
  children,
}: {
  tone: PillTone;
  size?: number;
  dot?: boolean;
  pulse?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const solid =
    tone === 'onair'
      ? OB.program
      : tone === 'preview'
        ? OB.preview
        : tone === 'ai'
          ? OB.accent
          : tone === 'amber'
            ? OB.amber
            : tone === 'chalk'
              ? OB.chalk
              : null;
  const fg = solid ? (tone === 'onair' ? '#fff' : OB.dark) : OB.chalk;
  const border =
    tone === 'rec'
      ? '1px solid rgba(255,45,45,.6)'
      : tone === 'idle'
        ? `1px solid ${OB.rule3}`
        : '1px solid transparent';
  const dotColor = tone === 'rec' ? OB.program : fg;
  const doPulse = pulse ?? (tone === 'onair' || tone === 'rec');
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.6),
        height: Math.round(size * 2.4),
        padding: `0 ${Math.round(size * 0.9)}px`,
        background: solid ?? OB.plate,
        color: fg,
        border,
        borderRadius: 2,
        boxSizing: 'border-box',
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}>
      {dot ? (
        <span
          className={doPulse ? 'ob-pulse' : undefined}
          style={{
            width: Math.round(size * 0.6),
            height: Math.round(size * 0.6),
            borderRadius: '50%',
            background: tone === 'idle' ? 'transparent' : dotColor,
            border: tone === 'idle' ? `1px solid ${OB.chalk}` : undefined,
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
  | 'program'
  | 'preview'
  | 'accent'
  | 'amber'
  | 'chalk'
  | 'outline'
  | 'dim';

/** Tiny mono tag: OP / AUTO / LLM / FILE / WHIP… */
export function TagChip({
  tone = 'outline',
  size = 9,
  style,
  title,
  children,
}: {
  tone?: TagTone;
  size?: number;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const bg =
    tone === 'program'
      ? OB.program
      : tone === 'preview'
        ? OB.preview
        : tone === 'accent'
          ? OB.accent
          : tone === 'amber'
            ? OB.amber
            : tone === 'chalk'
              ? OB.chalk
              : 'transparent';
  const fg =
    tone === 'program'
      ? '#fff'
      : tone === 'outline'
        ? OB.chalk
        : tone === 'dim'
          ? OB.dim
          : OB.dark;
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        background: bg,
        color: fg,
        border:
          tone === 'outline' || tone === 'dim'
            ? `1px solid ${OB.rule2}`
            : '1px solid transparent',
        borderRadius: 2,
        padding: `${Math.round(size * 0.25)}px ${Math.round(size * 0.6)}px`,
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}>
      {children}
    </span>
  );
}

/** Stat cell: dim label over a condensed value, top hairline. */
export function StatCell({
  label,
  value,
  sub,
  size = 34,
  color = OB.chalk,
}: {
  label: string;
  value: string;
  sub?: string;
  size?: number;
  color?: string;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${OB.rule2}`,
        paddingTop: Math.round(size * 0.25),
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(size * 0.12),
        minWidth: 0,
      }}>
      <Meta size={9.5}>{label}</Meta>
      <Display size={size} weight={700} color={color}>
        {value}
      </Display>
      {sub ? (
        <Meta size={9} tracking={0.1} color={OB.dim2}>
          {sub}
        </Meta>
      ) : null}
    </div>
  );
}

/** Flat progress bar; `indeterminate` sweeps. */
export function ProgressBar({
  value,
  max = 1,
  indeterminate = false,
  width = '100%',
  height = 4,
  color = OB.accent,
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
        background: OB.fillStrong,
        borderRadius: height / 2,
        overflow: 'hidden',
        ...style,
      }}>
      <div
        className={indeterminate ? 'ob-sweep-bar' : 'ob-meter-fill'}
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

/** Ten-segment mic meter: green, then amber, then dim. */
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
    <div
      role='meter'
      aria-label='microphone level'
      aria-valuemin={0}
      aria-valuemax={segments}
      aria-valuenow={lit}
      style={{ display: 'flex', gap: 2, height, ...style }}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            borderRadius: 1,
            background:
              i < lit
                ? i >= segments - 3
                  ? OB.amber
                  : OB.preview
                : OB.fillStrong,
          }}
        />
      ))}
    </div>
  );
}

/**
 * One live signal as a labelled bar: SPEECH / LEVEL / MOTION. `value` is
 * 0..1; `active` lights the label (speech detected, onset).
 */
export function SignalMeter({
  label,
  value,
  tone = 'chalk',
  active = false,
  stale = false,
  text,
  compact = false,
  style,
}: {
  label: string;
  value: number;
  tone?: ObTone;
  active?: boolean;
  stale?: boolean;
  /** Replaces the percentage on the right (e.g. `2` people). */
  text?: string;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  const color = stale ? OB.dim2 : toneColor(tone);
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        opacity: stale ? 0.55 : 1,
        ...style,
      }}>
      <Mono
        size={compact ? 8 : 9}
        weight={600}
        tracking={0.1}
        color={active && !stale ? color : OB.dim}
        style={{ width: compact ? 34 : 44, flexShrink: 0 }}>
        {label}
      </Mono>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: compact ? 4 : 5,
          background: OB.fillStrong,
          borderRadius: 3,
          overflow: 'hidden',
          minWidth: 20,
        }}>
        <div
          className='ob-meter-fill'
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct * 100}%`,
            background: color,
            opacity: active || pct > 0 ? 1 : 0.4,
          }}
        />
      </div>
      {text != null ? (
        <Mono
          size={compact ? 8 : 9}
          weight={600}
          tracking={0.04}
          color={OB.dim}
          style={{ width: 16, textAlign: 'right', flexShrink: 0 }}>
          {text}
        </Mono>
      ) : null}
    </div>
  );
}

/** Tally lamp + label: ON AIR (red) / PREVIEW (green) / STANDBY. */
export function TallyBadge({
  tally,
  size = 10,
  label,
  style,
}: {
  tally: ObTally;
  size?: number;
  /** Override the word (e.g. `PGM`). */
  label?: string;
  style?: React.CSSProperties;
}) {
  const color = tally === 'off' ? OB.dim2 : tallyColor(tally);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.5),
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '.14em',
        color: tally === 'off' ? OB.dim : color,
        whiteSpace: 'nowrap',
        ...style,
      }}>
      <span
        aria-hidden
        style={{
          width: Math.round(size * 0.8),
          height: Math.round(size * 0.8),
          borderRadius: '50%',
          background: tally === 'off' ? 'transparent' : color,
          border: tally === 'off' ? `1px solid ${OB.dim2}` : 'none',
          boxShadow:
            tally === 'program'
              ? `0 0 ${size}px rgba(255,45,45,.7)`
              : tally === 'preview'
                ? `0 0 ${size}px rgba(34,197,94,.55)`
                : 'none',
          boxSizing: 'border-box',
        }}
      />
      {label ?? TALLY_LABEL[tally]}
    </span>
  );
}

/** Where a camera's picture comes from, as a tag. */
export function SourceTag({ cam }: { cam: Pick<ObCam, 'kind' | 'fileName'> }) {
  const label =
    cam.kind === 'whip' ? 'PHONE' : cam.kind === 'file' ? 'FILE' : 'INPUT';
  return (
    <TagChip tone='dim' title={cam.fileName}>
      {label}
    </TagChip>
  );
}

/** Speech / level / motion / people bars for one camera. */
export function CamSignals({
  signals,
  compact = false,
}: {
  signals: ObSignalSummary | undefined;
  compact?: boolean;
}) {
  const s = signals;
  const level = s ? Math.max(0, Math.min(1, (s.rmsDb + 60) / 60)) : 0;
  const stale = !s || s.stale;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 3 : 4,
        minWidth: 0,
      }}>
      <SignalMeter
        label='SPEECH'
        value={s?.speechProb ?? 0}
        active={s?.speech ?? false}
        tone='preview'
        stale={stale}
        compact={compact}
      />
      <SignalMeter
        label='LEVEL'
        value={level}
        active={s?.onset ?? false}
        tone='amber'
        stale={stale}
        compact={compact}
      />
      <SignalMeter
        label='MOTION'
        value={s?.motion ?? 0}
        tone='accent'
        stale={stale}
        compact={compact}
        text={s ? `${s.people}` : '–'}
      />
    </div>
  );
}

/**
 * A camera on the desk: number, name, role, talent, tally frame, source,
 * live meters. Program = red frame + red number plate, preview = green.
 * A disconnected / dark camera is dimmed. Clicking previews it.
 */
export function CamTile({
  cam,
  signals,
  tally,
  pending = false,
  onClick,
  compact = false,
  footer,
  style,
}: {
  cam: ObCam;
  signals?: ObSignalSummary;
  /** Defaults to the server's `cam.tally`. */
  tally?: ObTally;
  pending?: boolean;
  onClick?: () => void;
  compact?: boolean;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = tally ?? cam.tally;
  const frame = tallyColor(t);
  const dark = !cam.connected || !cam.live;
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: compact ? 26 : 32,
            height: compact ? 26 : 32,
            borderRadius: 2,
            background:
              t === 'program'
                ? OB.program
                : t === 'preview'
                  ? OB.preview
                  : OB.fillStrong,
            color: t === 'off' ? OB.chalk : t === 'program' ? '#fff' : OB.dark,
            fontFamily: obDisplay,
            fontWeight: 800,
            fontSize: compact ? 18 : 22,
            lineHeight: 1,
            flexShrink: 0,
          }}>
          {cam.number}
        </span>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2,
            minWidth: 0,
            flex: 1,
            textAlign: 'left',
          }}>
          <Display
            size={compact ? 14 : 16}
            weight={700}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {cam.name || `CAM ${cam.number}`}
          </Display>
          <Mono
            size={8.5}
            weight={500}
            tracking={0.12}
            color={OB.dim}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {roleLabel(cam.role)}
            {cam.talent ? ` · ${cam.talent}` : ''}
          </Mono>
        </div>
      </div>
      {dark ? (
        <Mono
          size={9}
          weight={600}
          tracking={0.14}
          color={cam.connected ? OB.amber : OB.dim2}
          style={{ padding: compact ? '2px 0' : '6px 0' }}>
          {cam.connected ? 'NO SIGNAL' : 'DISCONNECTED'}
        </Mono>
      ) : (
        <CamSignals signals={signals} compact={compact} />
      )}
      {signals?.host ? (
        <span
          aria-label='host on this camera'
          style={{
            position: 'absolute',
            top: compact ? 5 : 8,
            right: compact ? 5 : 8,
            padding: '2px 5px',
            borderRadius: 2,
            background: OB.amber,
            color: OB.dark,
            fontFamily: obMono,
            fontWeight: 800,
            fontSize: 8,
            letterSpacing: '0.12em',
          }}>
          HOST
        </span>
      ) : null}
      {footer}
    </>
  );
  const boxStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? 5 : 8,
    padding: compact ? 7 : 10,
    boxSizing: 'border-box',
    background:
      t === 'program'
        ? OB.programDim
        : t === 'preview'
          ? OB.previewDim
          : OB.plate2,
    border: `${t === 'off' ? 1 : 2}px solid ${frame}`,
    borderRadius: RADIUS,
    color: OB.chalk,
    opacity: dark ? 0.6 : 1,
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'left',
    ...style,
  };
  if (!onClick)
    return (
      <div style={boxStyle} aria-label={`camera ${cam.number}`}>
        {body}
      </div>
    );
  return (
    <button
      type='button'
      className='ob-btn'
      data-variant='tile'
      onClick={onClick}
      aria-busy={pending || undefined}
      title={`Preview CAM ${cam.number}`}
      style={boxStyle}>
      {body}
      {pending ? <span className='ob-pending-bar' aria-hidden /> : null}
    </button>
  );
}

/**
 * The big desk key: TAKE (red) / CUT / AUTO. Lit when `armed` (there is
 * something to take), a pending bar while the echo is on its way.
 */
export function BigKey({
  label,
  sub,
  keyBadge,
  tone = 'neutral',
  lit = false,
  pending = false,
  disabled = false,
  onClick,
  height = 72,
  title,
  style,
}: {
  label: string;
  sub?: string;
  keyBadge?: string;
  tone?: 'program' | 'preview' | 'accent' | 'neutral';
  /** The key is live (glows in its tone). */
  lit?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  height?: number;
  title?: string;
  style?: React.CSSProperties;
}) {
  const color =
    tone === 'program'
      ? OB.program
      : tone === 'preview'
        ? OB.preview
        : tone === 'accent'
          ? OB.accent
          : OB.chalk;
  const bg = lit ? color : OB.plate2;
  const fg = lit
    ? tone === 'program'
      ? '#fff'
      : OB.dark
    : tone === 'neutral'
      ? OB.chalk
      : color;
  return (
    <button
      type='button'
      className='ob-btn'
      data-variant={lit ? 'solid' : 'key'}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-busy={pending || undefined}
      style={{
        position: 'relative',
        height,
        minWidth: 90,
        padding: '0 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: bg,
        color: fg,
        border: `1px solid ${lit ? color : `${color}66`}`,
        borderRadius: 4,
        boxShadow: lit
          ? `0 0 18px ${color}55, inset 0 1px 0 rgba(255,255,255,.25)`
          : 'inset 0 1px 0 rgba(255,255,255,.04)',
        overflow: 'hidden',
        ...style,
      }}>
      <span
        style={{
          fontFamily: obDisplay,
          fontWeight: 800,
          fontSize: Math.round(height * 0.38),
          letterSpacing: '.08em',
          lineHeight: 1,
        }}>
        {label}
      </span>
      {sub || keyBadge ? (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: obMono,
            fontWeight: 600,
            fontSize: 9,
            letterSpacing: '.14em',
            opacity: 0.8,
            textTransform: 'uppercase',
          }}>
          {sub}
          {keyBadge ? (
            <KeyBadge color={fg} size={8.5}>
              {keyBadge}
            </KeyBadge>
          ) : null}
        </span>
      ) : null}
      {pending ? <span className='ob-pending-bar' aria-hidden /> : null}
    </button>
  );
}

/** QR on a chalk well. */
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
  const pad = padding ?? Math.round(size * 0.08);
  return (
    <div
      style={{
        background: OB.chalk,
        padding: pad,
        lineHeight: 0,
        borderRadius: RADIUS,
        ...style,
      }}>
      <QRCode value={url} size={size} fgColor='#0A0C10' bgColor={OB.chalk} />
    </div>
  );
}

/* ------------------------------ warnings ------------------------------ */

/** Warning plate: tone bar, headline + copy. */
export function WarnPlate({
  tone = 'amber',
  title,
  style,
  children,
}: {
  tone?: 'amber' | 'bad' | 'accent';
  title?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const color =
    tone === 'bad' ? OB.program : tone === 'accent' ? OB.accent : OB.amber;
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      style={{
        position: 'relative',
        padding: title ? '12px 14px 12px 16px' : '8px 12px 8px 14px',
        background:
          tone === 'bad'
            ? 'rgba(255,45,45,.1)'
            : tone === 'accent'
              ? OB.accentDim
              : OB.amberDim,
        border: `1px solid ${color}55`,
        borderLeft: `3px solid ${color}`,
        borderRadius: RADIUS,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...style,
      }}>
      {title ? (
        <Display size={18} weight={700} tracking={0.05} color={color}>
          {title}
        </Display>
      ) : null}
      {children ? (
        <Copy size={11} color='rgba(230,233,239,.85)' lineHeight={1.5}>
          {children}
        </Copy>
      ) : null}
    </div>
  );
}

/** Slim status strip pinned to the top edge ("FEED RECONNECTING…"). */
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
  const color =
    tone === 'bad' ? OB.program : tone === 'good' ? OB.preview : OB.amber;
  const fg = tone === 'bad' ? '#fff' : OB.dark;
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
    gap: 10,
    height: 30,
    padding: '0 16px',
    boxSizing: 'border-box',
    background: `repeating-linear-gradient(135deg, transparent 0 10px, rgba(10,12,16,.12) 10px 20px), ${color}`,
    color: fg,
    fontFamily: obMono,
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '.2em',
    textTransform: 'uppercase',
    border: 'none',
  };
  const dot = (
    <span
      className='ob-pulse'
      style={{
        width: 8,
        height: 8,
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
        className='ob-btn'
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

/** The armed state: headline, copy, KEEP / confirm, amber drain. */
export function ConfirmCard({
  title,
  copy,
  confirmLabel,
  keepLabel = 'KEEP GOING',
  onConfirm,
  onKeep,
  timeoutMs = 5000,
  style,
}: {
  title: string;
  copy?: string;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: () => void;
  onKeep: () => void;
  timeoutMs?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role='alertdialog'
      aria-label={title}
      style={{
        background: OB.plate2,
        border: '1px solid rgba(255,45,45,.45)',
        borderRadius: RADIUS,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...style,
      }}>
      <Display size={18} weight={700} color={OB.program}>
        {title}
      </Display>
      {copy ? (
        <Copy size={11} color='rgba(230,233,239,.75)' lineHeight={1.5}>
          {copy}
        </Copy>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <ObButton
          variant='outline'
          size='sm'
          label={keepLabel}
          onClick={onKeep}
          style={{ flex: 1 }}
        />
        <ObButton
          variant='dangerSolid'
          size='sm'
          label={confirmLabel}
          active
          onClick={onConfirm}
          style={{ flex: 1 }}
        />
      </div>
      <div
        style={{
          height: 2,
          background: OB.amber,
          transformOrigin: 'left',
          animation: `ob-pending ${timeoutMs}ms linear reverse forwards`,
        }}
      />
    </div>
  );
}

/* ------------------------------- frame ------------------------------- */

/** Footer key hints: `ENTER · TAKE`. */
export function FooterHints({
  hints,
  right,
  style,
}: {
  hints: { key: string; label: string }[];
  right?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        minWidth: 0,
        ...style,
      }}>
      {hints.map((h) => (
        <span
          key={h.key + h.label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <KeyBadge size={9}>{h.key}</KeyBadge>
          <Mono size={9.5} tracking={0.16} color={OB.dim}>
            {h.label}
          </Mono>
        </span>
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
 * Host screen shell for the 1280×720 stage: wordmark + screen title +
 * meta (top bar), content, and the footer hint rail.
 */
export function HostFrame({
  title,
  meta,
  hints,
  hintsRight,
  contentStyle,
  children,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  hints?: { key: string; label: string }[];
  hintsRight?: React.ReactNode;
  contentStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className='ob-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: OB.page,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 20px',
          borderBottom: `1px solid ${OB.rule}`,
          flexShrink: 0,
        }}>
        <Wordmark size={24} />
        <span style={{ width: 1, height: 20, background: OB.rule2 }} />
        {typeof title === 'string' ? (
          <Display size={20} weight={600} tracking={0.12} color={OB.dim}>
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
          padding: '14px 20px',
          display: 'flex',
          flexDirection: 'column',
          ...contentStyle,
        }}>
        {children}
      </div>
      <div
        style={{
          height: 30,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderTop: `1px solid ${OB.rule}`,
          flexShrink: 0,
        }}>
        <FooterHints
          hints={hints ?? []}
          right={hintsRight}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ recording ------------------------------ */

/** Floating REC chip for the host arcade. */
export function ObRecChip({ rec }: { rec: KbtRecording }) {
  const on = rec.effectiveIsRecording;
  const label = rec.isWaitingForDownload
    ? 'SAVING MP4…'
    : on
      ? 'REC · STOP'
      : 'RECORD';
  return (
    <button
      type='button'
      className='ob-btn'
      disabled={rec.isToggling || rec.isWaitingForDownload}
      onClick={() => void rec.toggle()}
      title={
        on
          ? 'Stop recording — the mp4 downloads when it finalizes'
          : 'Record the program (what viewers see + hear) as an mp4'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 10px',
        background: on ? 'rgba(255,45,45,.14)' : 'transparent',
        border: on ? '1px solid rgba(255,45,45,.6)' : `1px solid ${OB.rule2}`,
        borderRadius: 2,
        color: OB.chalk,
        fontFamily: obMono,
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
      <span
        className={on && !rec.isWaitingForDownload ? 'ob-pulse' : undefined}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: on ? OB.program : 'transparent',
          border: on ? 'none' : `1px solid ${OB.chalk}`,
          boxSizing: 'border-box',
        }}
      />
      {label}
    </button>
  );
}

/** RECORDING controls (WRAP, SETUP output). */
export function ObRecordingPlate({
  rec,
  saved = false,
}: {
  rec: KbtRecording;
  /** A recording finished and downloaded this session. */
  saved?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <Meta size={9.5}>RECORDING</Meta>
        {rec.effectiveIsRecording ? (
          <StatusPill tone='rec' size={9}>
            REC
          </StatusPill>
        ) : saved ? (
          <TagChip tone='preview'>SAVED</TagChip>
        ) : null}
      </div>
      {rec.isWaitingForDownload ? (
        <ObButton block disabled size='sm' label='SAVING MP4…' />
      ) : rec.effectiveIsRecording ? (
        <ObButton
          block
          size='sm'
          variant='dangerSolid'
          locked={rec.isToggling}
          label='STOP + DOWNLOAD'
          onClick={() => void rec.toggle()}
        />
      ) : (
        <ObButton
          block
          size='sm'
          locked={rec.isToggling}
          label='START RECORDING'
          onClick={() => void rec.toggle()}
        />
      )}
      <Meta size={9} tracking={0.1} color={OB.dim2}>
        records the program — everything viewers see + hear
      </Meta>
    </div>
  );
}

/* ---------------------------- phone shell ---------------------------- */

/**
 * The phone wizard shell: wordmark, step label, progress dots, scrolling
 * content (compact pins it). Same prop contract as KbtPhoneShell.
 */
export function ObPhoneShell({
  stepIndex,
  stepCount,
  stepLabel,
  compact = false,
  title = 'CAMERA',
  children,
}: {
  /** 0-based; negative hides the progress row. */
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  compact?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const landscape = useIsLandscape();
  const small = compact || landscape;
  const dots =
    stepIndex >= 0 ? (
      <div style={{ display: 'flex', gap: 5 }}>
        {Array.from({ length: stepCount }, (_, i) => (
          <span
            key={i}
            style={{
              width: i === stepIndex ? 16 : 6,
              height: 6,
              borderRadius: 3,
              background:
                i < stepIndex
                  ? OB.preview
                  : i === stepIndex
                    ? OB.chalk
                    : OB.fillStrong,
              transition: 'width .2s ease',
            }}
          />
        ))}
      </div>
    ) : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: OB.page,
        backgroundImage: deskGrid(0.03),
        backgroundSize: '32px 32px',
        color: OB.chalk,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      {compact && landscape ? null : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: small
              ? 'calc(env(safe-area-inset-top, 0px) + 8px) calc(env(safe-area-inset-right, 0px) + 14px) 8px calc(env(safe-area-inset-left, 0px) + 14px)'
              : 'calc(env(safe-area-inset-top, 0px) + 14px) calc(env(safe-area-inset-right, 0px) + 16px) 12px calc(env(safe-area-inset-left, 0px) + 16px)',
            borderBottom: `1px solid ${OB.rule}`,
            background: OB.page,
          }}>
          <Wordmark size={small ? 18 : 22} lit={false} />
          <Mono size={9.5} weight={600} tracking={0.18} color={OB.dim}>
            {title}
          </Mono>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 5,
            }}>
            <Mono size={9} weight={600} tracking={0.16} color={OB.chalk}>
              {stepLabel}
            </Mono>
            {dots}
          </div>
        </div>
      )}
      <div
        className='ob-scroll'
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflowY: compact ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 8 : 14,
          padding: compact
            ? '8px calc(env(safe-area-inset-right, 0px) + 12px) calc(env(safe-area-inset-bottom, 0px) + 8px) calc(env(safe-area-inset-left, 0px) + 12px)'
            : '16px calc(env(safe-area-inset-right, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 16px) calc(env(safe-area-inset-left, 0px) + 16px)',
        }}>
        {children}
      </div>
    </div>
  );
}

/** Round status lamp. */
export function StatusDot({
  state,
  pulse = false,
  size = 9,
}: {
  state: 'good' | 'warn' | 'bad' | 'idle';
  pulse?: boolean;
  size?: number;
}) {
  const color =
    state === 'good'
      ? OB.preview
      : state === 'warn'
        ? OB.amber
        : state === 'bad'
          ? OB.program
          : 'transparent';
  return (
    <span
      className={pulse ? 'ob-pulse' : undefined}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        border: state === 'idle' ? `1px solid ${OB.dim2}` : 'none',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    />
  );
}

type RowState = 'pending' | 'ok' | 'fail';

function BootRow({ label, state }: { label: string; state: RowState }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <StatusDot
        state={state === 'ok' ? 'good' : state === 'fail' ? 'bad' : 'warn'}
        pulse={state === 'pending'}
      />
      <Mono
        size={11}
        weight={600}
        tracking={0.16}
        color={
          state === 'ok' ? OB.preview : state === 'fail' ? OB.program : OB.chalk
        }>
        {label}
        {state === 'pending' ? (
          <span className='ob-blink' style={{ color: OB.dim }}>
            {' '}
            …
          </span>
        ) : null}
      </Mono>
    </div>
  );
}

/**
 * Step 1 on a phone or a panel — room lookup and the WebSocket uplink,
 * with failure states. The page advances once both rows check.
 */
export function ObConnectStep({
  roomStatus,
  wsConnected,
  wsError,
  onRetry,
  hint = 'keep this device on the same network as the control room',
}: {
  /** `unreachable` = the API did not answer (server down / wrong ?server=). */
  roomStatus: 'loading' | 'ok' | 'not-found' | 'unreachable';
  wsConnected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
  onRetry: () => void;
  hint?: string;
}) {
  const roomRow: RowState =
    roomStatus === 'ok' ? 'ok' : roomStatus === 'loading' ? 'pending' : 'fail';
  const wsRow: RowState = wsConnected
    ? 'ok'
    : wsError && !wsError.startsWith('connecting')
      ? 'fail'
      : 'pending';
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 14,
      }}>
      <ObPlate title='CONNECTING' padding='16px 14px' gap={14}>
        <BootRow label='LINKING ROOM' state={roomRow} />
        <BootRow label='CONTROL ROOM UPLINK' state={wsRow} />
      </ObPlate>
      {roomStatus === 'not-found' ? (
        <WarnPlate tone='bad' title='ROOM NOT FOUND'>
          Scan the QR on the control-room screen again.
        </WarnPlate>
      ) : roomStatus === 'unreachable' ? (
        <WarnPlate tone='bad' title='CONTROL ROOM UNREACHABLE'>
          The server did not answer. Check the network (same Wi-Fi as the
          control room) and retry.
        </WarnPlate>
      ) : null}
      {wsRow === 'fail' || roomRow === 'fail' ? (
        <>
          {wsRow === 'fail' ? (
            <WarnPlate>
              <span style={{ wordBreak: 'break-all' }}>{wsError}</span>
            </WarnPlate>
          ) : null}
          <ObButton block variant='primary' label='RETRY' onClick={onRetry} />
        </>
      ) : null}
      <Meta
        size={9.5}
        tracking={0.12}
        color={OB.dim2}
        style={{ textAlign: 'center' }}>
        {hint}
      </Meta>
    </div>
  );
}
