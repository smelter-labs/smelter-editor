'use client';

import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ *
 * kbt kit — the kb_design language ("Smelter Overlays") for the KBT
 * web screens, matching the broadcast HUD port in server/src/inputs/
 * KbtHud.tsx: near-black plates with one cut corner (zero border-radius
 * anywhere), hairline borders, ember-orange tab chips with dark text,
 * cream Big Shoulders Display headlines and wide-tracked uppercase
 * IBM Plex Mono labels. Host screens lay out in a fixed 1280×720 design
 * space scaled by <Stage>; phone screens use <KbtPhoneShell>.
 * ------------------------------------------------------------------ */

/** kb_design tokens — keep in sync with server/src/inputs/KbtHud.tsx. */
export const KBT = {
  accent: '#FF5A1F',
  accentRgb: '255, 90, 31',
  cream: '#E8E4DA',
  dim: 'rgba(232,228,218,.5)',
  dark: '#0D0E10',
  plate: 'rgba(13,14,16,.94)',
  plate2: 'rgba(24,26,30,.94)',
  page: '#101114',
  border: 'rgba(255,255,255,.09)',
  borderStrong: 'rgba(255,255,255,.12)',
  fill: 'rgba(255,255,255,.04)',
  fillStrong: 'rgba(255,255,255,.08)',
  good: '#38E08A',
  amber: '#FFB800',
  bad: '#FF4030',
  silver: '#C9CED6',
  bronze: '#A9743F',
} as const;

/** Medal colors by 0-based rank; everyone below bronze reads cream. */
export const RANK_COLORS = [KBT.accent, KBT.silver, KBT.bronze] as const;
export const rankColor = (rank0: number): string =>
  RANK_COLORS[rank0] ?? KBT.cream;

/** Font stacks wired up by the pages via next/font CSS variables. */
export const displayFont =
  "var(--font-kbt-display), 'Big Shoulders Display', sans-serif";
export const kbtMonoFont = "var(--font-kbt-mono), 'IBM Plex Mono', monospace";

/** Plate shape: single cut top-right corner (the kb_design plate). */
export const cut = (px = 22): string =>
  `polygon(0 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% 100%, 0 100%)`;

/** Tab chip: slanted right edge — HEAT n / FINAL / ON AIR. */
export const tabCut = (px = 15): string =>
  `polygon(0 0, calc(100% - ${px}px) 0, 100% 100%, 0 100%)`;

/** Skewed accent bar (title marker). */
export const skewBar = (px = 7): string =>
  `polygon(0 0, 100% ${px}px, 100% 100%, 0 calc(100% - ${px}px))`;

/* ------------------------------- stage ------------------------------- */

export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * Fullscreen wrapper that letterboxes and scales a fixed 1280×720 design
 * space to the viewport (same contract as the duck-hunter ArcadeStage, so
 * fullscreen video and overlays keep lining up).
 */
export function Stage({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () =>
      setScale(
        Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H),
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: KBT.page,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'relative',
          flexShrink: 0,
        }}>
        {children}
      </div>
    </div>
  );
}

/** Faint 1px grid + one big skewed ember bar + vignette — the backdrop. */
export function Backdrop() {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            `repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 48px)`,
            `repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 48px)`,
          ].join(', '),
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: '14%',
          width: 120,
          height: '130%',
          background: `rgba(${KBT.accentRgb}, .05)`,
          transform: 'skewX(-18deg)',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.5))',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

/* ------------------------------- plates ------------------------------- */

/**
 * The kb_design plate: near-black fill, hairline border, one cut corner.
 * Optional 4px ember bar down the left edge (status/emphasis plates).
 */
export function Plate({
  cutPx = 22,
  accentBar = false,
  accentColor = KBT.accent,
  fill = KBT.plate,
  style,
  innerStyle,
  children,
}: {
  cutPx?: number;
  accentBar?: boolean;
  accentColor?: string;
  fill?: string;
  style?: React.CSSProperties;
  innerStyle?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        clipPath: cut(cutPx),
        background: KBT.border,
        padding: 1,
        ...style,
      }}>
      <div
        style={{
          clipPath: cut(Math.max(1, cutPx - 1)),
          background: fill,
          position: 'relative',
          borderLeft: accentBar ? `4px solid ${accentColor}` : undefined,
          ...innerStyle,
        }}>
        {children}
      </div>
    </div>
  );
}

/** Plate section header: 8px ember square + tracked Big Shoulders title. */
export function PlateTitle({
  color = KBT.accent,
  right,
  children,
}: {
  color?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{ width: 8, height: 8, background: color, flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: KBT.cream,
          whiteSpace: 'nowrap',
        }}>
        {children}
      </span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

/** Ember tab chip with a slanted right edge and dark text. */
export function Tab({
  color = KBT.accent,
  textColor = KBT.dark,
  size = 12,
  style,
  children,
}: {
  color?: string;
  textColor?: string;
  size?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        clipPath: tabCut(Math.round(size * 1.1)),
        background: color,
        color: textColor,
        fontFamily: kbtMonoFont,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: 2,
        textTransform: 'uppercase',
        padding: `${Math.round(size * 0.45)}px ${Math.round(size * 1.8)}px ${Math.round(size * 0.45)}px ${Math.round(size * 0.9)}px`,
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {children}
    </span>
  );
}

/* ------------------------------- text ------------------------------- */

/** Condensed display headline — Big Shoulders, uppercase, tight leading. */
export function DisplayText({
  size,
  weight = 800,
  color = KBT.cream,
  tracking = 1,
  style,
  children,
}: {
  size: number;
  weight?: 500 | 700 | 800;
  color?: string;
  tracking?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: displayFont,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 0.85,
        letterSpacing: tracking,
        textTransform: 'uppercase',
        color,
        whiteSpace: 'pre-line',
        ...style,
      }}>
      {children}
    </span>
  );
}

/** Wide-tracked uppercase mono label — the design's caption voice. */
export function Label({
  size = 12,
  color = KBT.dim,
  tracking = 3,
  weight = 500,
  style,
  children,
}: {
  size?: number;
  color?: string;
  tracking?: number;
  weight?: 400 | 500 | 600;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: kbtMonoFont,
        fontWeight: weight,
        fontSize: size,
        letterSpacing: tracking,
        textTransform: 'uppercase',
        color,
        ...style,
      }}>
      {children}
    </span>
  );
}

/** Mono numeric readout (clock, scores) — tabular by Plex Mono's nature. */
export function Num({
  size,
  color = KBT.cream,
  weight = 600,
  style,
  children,
}: {
  size: number;
  color?: string;
  weight?: 400 | 500 | 600;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: kbtMonoFont,
        fontWeight: weight,
        fontSize: size,
        letterSpacing: 1,
        color,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}>
      {children}
    </span>
  );
}

/* ------------------------------ buttons ------------------------------ */

export type KbtButtonVariant = 'solid' | 'outline' | 'danger';

/**
 * The kit's action button: cut-corner, mono uppercase. `solid` = ember bg
 * with dark text (the primary), `outline` = hairline + cream, `danger` =
 * red. `active` pulses the primary affordance.
 */
export function KbtButton({
  label,
  sub,
  variant = 'solid',
  block = false,
  active = false,
  disabled = false,
  dense = false,
  onClick,
  style,
}: {
  label: string;
  sub?: string;
  variant?: KbtButtonVariant;
  /** Full-width (phone wizard primary). */
  block?: boolean;
  /** Pulse — the "press me" affordance. */
  active?: boolean;
  disabled?: boolean;
  dense?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const bg =
    variant === 'solid'
      ? KBT.accent
      : variant === 'danger'
        ? 'rgba(255,64,48,.14)'
        : KBT.fill;
  const fg =
    variant === 'solid' ? KBT.dark : variant === 'danger' ? KBT.bad : KBT.cream;
  const borderColor =
    variant === 'solid'
      ? 'transparent'
      : variant === 'danger'
        ? 'rgba(255,64,48,.5)'
        : KBT.borderStrong;
  return (
    <button
      type='button'
      className={`kbt-btn${active && !disabled ? ' kbt-pulse' : ''}`}
      disabled={disabled}
      onClick={onClick}
      style={{ display: block ? 'block' : undefined, width: block ? '100%' : undefined, ...style }}>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          clipPath: cut(12),
          background: bg,
          border: `1px solid ${borderColor}`,
          padding: dense ? '9px 16px' : '13px 22px',
        }}>
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontWeight: 600,
            fontSize: dense ? 12 : 14,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: fg,
            whiteSpace: 'nowrap',
          }}>
          {label}
        </span>
        {sub ? (
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: variant === 'solid' ? 'rgba(13,14,16,.65)' : KBT.dim,
              textAlign: 'center',
            }}>
            {sub}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Small square-cornered mono chip (flip cam, +/- steppers, toggles). */
export function ChipButton({
  label,
  active = false,
  dense = false,
  onClick,
  style,
}: {
  label: string;
  active?: boolean;
  dense?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type='button'
      className='kbt-btn'
      onClick={onClick}
      style={{
        background: active ? KBT.accent : KBT.fillStrong,
        border: `1px solid ${active ? KBT.accent : KBT.border}`,
        color: active ? KBT.dark : KBT.cream,
        fontFamily: kbtMonoFont,
        fontWeight: 600,
        fontSize: dense ? 10 : 11,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        padding: dense ? '6px 9px' : '9px 12px',
        whiteSpace: 'nowrap',
        ...style,
      }}>
      {label}
    </button>
  );
}

/* ------------------------------ widgets ------------------------------ */

export type StatusDotState = 'good' | 'warn' | 'bad' | 'idle';

const DOT_COLORS: Record<StatusDotState, string> = {
  good: KBT.good,
  warn: KBT.amber,
  bad: KBT.bad,
  idle: KBT.fillStrong,
};

/** Square status dot — pulsing when live-ish, never round. */
export function StatusDot({
  state,
  pulse = false,
  size = 8,
  style,
}: {
  state: StatusDotState;
  pulse?: boolean;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={pulse ? 'kbt-pulse' : undefined}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        background: DOT_COLORS[state],
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/** Flat progress bar — hairline track, solid fill, zero radius. */
export function Bar({
  value,
  max,
  color = KBT.accent,
  height = 6,
  style,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
  style?: React.CSSProperties;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      style={{
        height,
        background: 'rgba(255,255,255,.07)',
        ...style,
      }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: color }} />
    </div>
  );
}

/* ------------------------------- frame ------------------------------- */

/**
 * Host screen shell filling the 1280×720 stage: backdrop, trapezoid-flavored
 * header strip (skewed accent bar + Big Shoulders title left, tab right),
 * content region and a footer rail for key hints.
 */
export function Frame({
  title,
  tab,
  footer,
  children,
}: {
  title: string;
  tab?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className='kbt-enter' style={{ position: 'absolute', inset: 0 }}>
      <Backdrop />
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
            alignItems: 'center',
            gap: 16,
            padding: '22px 32px 14px',
            borderBottom: `1px solid ${KBT.border}`,
          }}>
          <span
            style={{
              width: 14,
              height: 34,
              clipPath: skewBar(5),
              background: KBT.accent,
              flexShrink: 0,
            }}
          />
          <DisplayText size={34} weight={800} tracking={2}>
            {title}
          </DisplayText>
          <div style={{ flex: 1 }} />
          {tab}
        </div>
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            padding: '20px 32px',
            display: 'flex',
            flexDirection: 'column',
          }}>
          {children}
        </div>
        {footer ? (
          <div
            style={{
              padding: '10px 32px 16px',
              borderTop: `1px solid ${KBT.border}`,
            }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Footer rail: dim mono key hints — `[A] BEGIN · [B] BACK`. */
export function FooterHint({
  hints,
  right,
}: {
  hints: { key: string; label: string }[];
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {hints.map((h) => (
          <span
            key={h.key + h.label}
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: KBT.dim,
            }}>
            <span style={{ color: KBT.accent }}>[{h.key}]</span> {h.label}
          </span>
        ))}
      </div>
      {right}
    </div>
  );
}

/** Amber warning strip (camera problems etc.) in the design voice. */
export function WarnPlate({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        clipPath: cut(10),
        background: 'rgba(255,184,0,.1)',
        border: '1px solid rgba(255,184,0,.45)',
        borderLeft: `4px solid ${KBT.amber}`,
        padding: '10px 14px',
        fontFamily: kbtMonoFont,
        fontSize: 11,
        letterSpacing: 0.5,
        color: KBT.amber,
      }}>
      {children}
    </div>
  );
}

/** Podium block: dark gradient, thick rank-colored top border. */
export function PodiumBlock({
  rank,
  height,
  children,
  style,
}: {
  /** 1-based rank — drives the top-border medal color. */
  rank: number;
  height?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        height,
        background:
          'linear-gradient(180deg, rgba(38,40,45,.97), rgba(20,21,24,.97))',
        border: `1px solid ${KBT.borderStrong}`,
        borderTop: `6px solid ${rankColor(rank - 1)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...style,
      }}>
      {children}
    </div>
  );
}

/* ---------------------------- phone shell ---------------------------- */

/**
 * Whether the viewport is landscape. SSR-safe: false until mounted.
 * (Local copy — the kit stays free of duck-hunter imports.)
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return landscape;
}

/**
 * kb_design shell for the phone wizard — same prop contract as the
 * duck-hunter PhoneShell so pages swap a single import: marque, step label,
 * square progress dots, scrolling content region (compact pins it).
 */
export function KbtPhoneShell({
  stepIndex,
  stepCount,
  stepLabel,
  compact = false,
  title = 'KETTLEBELL',
  children,
}: {
  /** 0-based; negative hides the progress row (live stage). */
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  /** One-row header + non-scrolling content region. */
  compact?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const landscape = useIsLandscape();
  const small = compact || landscape;

  const dots =
    stepIndex >= 0 ? (
      <div style={{ display: 'flex', gap: small ? 5 : 7 }}>
        {Array.from({ length: stepCount }, (_, i) => (
          <div
            key={i}
            className={i === stepIndex ? 'kbt-pulse' : undefined}
            style={{
              width: small ? 6 : 8,
              height: small ? 6 : 8,
              background:
                i < stepIndex
                  ? KBT.good
                  : i === stepIndex
                    ? KBT.accent
                    : KBT.fillStrong,
            }}
          />
        ))}
      </div>
    ) : null;

  const marque = (size: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: Math.round(size * 0.4),
          height: size,
          clipPath: skewBar(3),
          background: KBT.accent,
          flexShrink: 0,
        }}
      />
      <DisplayText size={size} weight={800} tracking={2}>
        {title}
      </DisplayText>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: KBT.page,
        color: KBT.cream,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <Backdrop />
      {compact && landscape ? null : (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: small ? 6 : 9,
            padding: small
              ? 'calc(env(safe-area-inset-top, 0px) + 8px) calc(env(safe-area-inset-right, 0px) + 12px) 6px calc(env(safe-area-inset-left, 0px) + 12px)'
              : 'calc(env(safe-area-inset-top, 0px) + 14px) calc(env(safe-area-inset-right, 0px) + 16px) 10px calc(env(safe-area-inset-left, 0px) + 16px)',
          }}>
          {small ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}>
              {marque(16)}
              <Label size={9} tracking={2}>
                {stepLabel}
              </Label>
              {dots}
            </div>
          ) : (
            <>
              {marque(26)}
              <Label size={10} tracking={3}>
                {stepLabel}
              </Label>
              {dots ? <div style={{ marginTop: 2 }}>{dots}</div> : null}
            </>
          )}
          <div
            style={{
              alignSelf: 'stretch',
              height: 1,
              background: KBT.border,
            }}
          />
        </div>
      )}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          minHeight: 0,
          overflowY: compact ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 8 : 14,
          padding: compact
            ? `${
                landscape ? 'calc(env(safe-area-inset-top, 0px) + 6px)' : '4px'
              } calc(env(safe-area-inset-right, 0px) + 12px) calc(env(safe-area-inset-bottom, 0px) + 8px) calc(env(safe-area-inset-left, 0px) + 12px)`
            : '6px calc(env(safe-area-inset-right, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 16px) calc(env(safe-area-inset-left, 0px) + 16px)',
        }}>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------- connect step ---------------------------- */

type RowState = 'pending' | 'ok' | 'fail';

function BootRow({ label, state }: { label: string; state: RowState }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: kbtMonoFont,
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: state === 'ok' ? KBT.good : state === 'fail' ? KBT.bad : KBT.cream,
      }}>
      <StatusDot
        state={state === 'ok' ? 'good' : state === 'fail' ? 'bad' : 'warn'}
        pulse={state === 'pending'}
      />
      {label}
      {state === 'pending' ? (
        <span className='kbt-blink' style={{ color: KBT.dim }}>
          …
        </span>
      ) : null}
    </div>
  );
}

/**
 * Step 1 — connection sequence after scanning the QR: room lookup and
 * WebSocket uplink, with failure states. Auto-advances from the page once
 * both rows check.
 */
export function KbtConnectStep({
  roomStatus,
  wsConnected,
  wsError,
  onRetry,
}: {
  roomStatus: 'loading' | 'ok' | 'not-found';
  wsConnected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
  onRetry: () => void;
}) {
  const roomRow: RowState =
    roomStatus === 'ok' ? 'ok' : roomStatus === 'not-found' ? 'fail' : 'pending';
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
        gap: 16,
      }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '20px 18px',
        }}>
        <Label size={10}>CONNECTING</Label>
        <BootRow label='LINKING ROOM' state={roomRow} />
        <BootRow label='LIVE UPLINK' state={wsRow} />
      </Plate>

      {roomStatus === 'not-found' ? (
        <WarnPlate>ROOM NOT FOUND — scan the QR on the screen again.</WarnPlate>
      ) : null}

      {wsRow === 'fail' ? (
        <>
          <WarnPlate>
            <span style={{ wordBreak: 'break-all' }}>{wsError}</span>
          </WarnPlate>
          <KbtButton block active label='RETRY UPLINK' onClick={onRetry} />
        </>
      ) : null}

      <p
        style={{
          fontFamily: kbtMonoFont,
          fontSize: 10,
          letterSpacing: 1.5,
          color: KBT.dim,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}>
        keep this phone on the same network as the screen
      </p>
    </div>
  );
}
