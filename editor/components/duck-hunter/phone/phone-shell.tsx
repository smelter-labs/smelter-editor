'use client';

import React from 'react';
import {
  ACCENT_LINE,
  ACCENT_RGB,
  ArcadeText,
  BlueprintBackdrop,
  PixelPanel,
  R5,
  StarLine,
  chamfer,
  monoFont,
  pixelFont,
  type RetroAccent,
} from '../retro-kit';
import { useIsLandscape } from './use-viewport';

/**
 * Arcade shell for the phone-controller wizard: navy blueprint backdrop, CRT
 * scanlines, DUCK HUNTER mini-logo, the current step label between stars, and
 * pixel progress dots. Content scrolls on its own — except in compact mode,
 * which is for steps that must fit the viewport whole (calibration: you aim
 * with the gyro while touching the controls, so nothing may sit below the
 * fold). Landscape shrinks the header (or drops it entirely in compact mode —
 * the step relocates its own label).
 */
export function PhoneShell({
  stepIndex,
  stepCount,
  stepLabel,
  compact = false,
  title = 'DUCK HUNTER',
  topRight,
  children,
}: {
  /** 0-based; negative hides the progress row (play stage). */
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  /** One-row header + non-scrolling content region (calibrate step). */
  compact?: boolean;
  /** Mini-logo text — other games reuse the shell with their own marque. */
  title?: string;
  /**
   * Corner utility slot (a chip or two). Floated over the shell rather than
   * placed in the header row: the header is a centered column, so anything in
   * it would shove the logo off-center — and in compact landscape the header
   * isn't rendered at all, which would take the slot down with it.
   */
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const landscape = useIsLandscape();
  // Both compact mode and landscape get the space-saving header.
  const small = compact || landscape;

  const dots =
    stepIndex >= 0 ? (
      <div style={{ display: 'flex', gap: small ? 5 : 8 }}>
        {Array.from({ length: stepCount }, (_, i) => (
          <div
            key={i}
            style={{
              width: small ? 7 : 10,
              height: small ? 7 : 10,
              background:
                i < stepIndex
                  ? R5.green
                  : i === stepIndex
                    ? R5.yellow
                    : 'rgba(120,150,200,0.18)',
              boxShadow:
                i === stepIndex
                  ? `0 0 8px rgba(${R5.yellowRgb},0.7)`
                  : i < stepIndex
                    ? `0 0 4px rgba(${R5.greenRgb},0.5)`
                    : 'inset 0 0 0 1px rgba(120,150,200,0.25)',
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
        background: R5.bgDeep,
        color: R5.ink,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <BlueprintBackdrop />
      {compact && landscape ? null : (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: small ? 6 : 8,
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
              <ArcadeText size={compact ? 12 : 13}>{title}</ArcadeText>
              <StarLine size={8}>{stepLabel}</StarLine>
              {dots}
            </div>
          ) : (
            <>
              <ArcadeText size={20}>{title}</ArcadeText>
              <StarLine size={9}>{stepLabel}</StarLine>
              {dots ? <div style={{ marginTop: 2 }}>{dots}</div> : null}
            </>
          )}
          <div
            style={{
              alignSelf: 'stretch',
              height: 2,
              background: `linear-gradient(90deg, transparent, rgba(${R5.gridRgb},0.6) 20%, rgba(${R5.gridRgb},0.6) 80%, transparent)`,
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
      {topRight ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
            right: 'calc(env(safe-area-inset-right, 0px) + 8px)',
            // Over the content region (z 1), under the scanlines (z 30) so it
            // keeps the CRT tint — they're pointer-events:none, so it still taps.
            zIndex: 3,
            display: 'flex',
            gap: 6,
          }}>
          {topRight}
        </div>
      ) : null}
      <div className='r5-scanlines' />
    </div>
  );
}

/** Big full-width chamfered arcade action button for the phone wizard. */
export function ActionButton({
  accent,
  label,
  sub,
  active = false,
  disabled = false,
  dense = false,
  onClick,
  style,
}: {
  accent: RetroAccent;
  label: string;
  sub?: string;
  active?: boolean;
  disabled?: boolean;
  /** Tighter padding + smaller label (calibrate landscape rail). */
  dense?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const color = ACCENT_LINE[accent];
  const rgb = ACCENT_RGB[accent];
  return (
    <button
      type='button'
      className='r5-btn'
      disabled={disabled}
      onClick={onClick}
      style={{ display: 'block', width: '100%', ...style }}>
      <PixelPanel
        accent={accent}
        cut={10}
        glow={active && !disabled ? 0.8 : 0.2}
        fill={`rgba(${rgb},0.16)`}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: dense ? '10px 10px' : '14px 16px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: dense ? 11 : 13,
            letterSpacing: 1.5,
            color,
            textShadow: `0 0 10px rgba(${rgb},0.6)`,
            textAlign: 'center',
          }}>
          {label}
        </span>
        {sub ? (
          <span
            style={{
              fontFamily: monoFont,
              fontSize: 10,
              color: R5.inkMuted,
              textAlign: 'center',
            }}>
            {sub}
          </span>
        ) : null}
      </PixelPanel>
    </button>
  );
}

/** Small square utility button (⌖ / ⚙️ / 📷 row in the play HUD). */
export function ChipButton({
  label,
  active = false,
  dense = false,
  href,
  title,
  onClick,
  style,
}: {
  label: string;
  active?: boolean;
  /** Smaller padding + font (overlays on the calibration range). */
  dense?: boolean;
  /**
   * Turns the chip into a real link opening a new tab. A genuine anchor beats
   * `window.open()` here: mobile browsers block popups that aren't a direct
   * gesture, and nothing can unmount the panel out from under the player.
   */
  href?: string;
  /** Tooltip + accessible name — icon-only chips have no readable label. */
  title?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const chrome: React.CSSProperties = {
    clipPath: chamfer(6),
    background: active ? R5.cyan : 'rgba(120,150,200,0.14)',
    color: active ? R5.bgDeep : R5.ink,
    fontFamily: pixelFont,
    fontSize: dense ? 8 : 9,
    letterSpacing: 1,
    padding: dense ? '7px 9px' : '10px 12px',
    whiteSpace: 'nowrap',
    ...style,
  };

  if (href) {
    return (
      <a
        className='r5-btn'
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
          ...chrome,
        }}>
        {label}
      </a>
    );
  }

  return (
    <button
      type='button'
      className='r5-btn'
      onClick={onClick}
      title={title}
      aria-label={title}
      style={chrome}>
      {label}
    </button>
  );
}

/**
 * Amber warning strip (gyro/camera problems) in the retro voice. `bad` turns
 * it red for a refusal — a blocked trigger or an empty magazine.
 */
export function WarnPanel({
  children,
  tone = 'warn',
}: {
  children: React.ReactNode;
  tone?: 'warn' | 'bad';
}) {
  const rgb = tone === 'bad' ? R5.redRgb : R5.orangeRgb;
  return (
    <div
      style={{
        clipPath: chamfer(8),
        background: `rgba(${rgb},0.16)`,
        border: `1px solid rgba(${rgb},0.5)`,
        padding: '10px 12px',
        fontFamily: monoFont,
        fontSize: 11,
        color: tone === 'bad' ? R5.red : R5.orangeBright,
      }}>
      {children}
    </div>
  );
}
