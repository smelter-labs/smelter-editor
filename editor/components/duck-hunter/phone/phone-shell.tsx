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

/**
 * Portrait arcade shell for the phone-controller wizard: navy blueprint
 * backdrop, CRT scanlines, DUCK HUNTER mini-logo, the current step label
 * between stars, and pixel progress dots. Content scrolls on its own.
 */
export function PhoneShell({
  stepIndex,
  stepCount,
  stepLabel,
  children,
}: {
  /** 0-based; negative hides the progress row (play stage). */
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  children: React.ReactNode;
}) {
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
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px',
        }}>
        <ArcadeText size={20}>DUCK HUNTER</ArcadeText>
        <StarLine size={9}>{stepLabel}</StarLine>
        {stepIndex >= 0 ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            {Array.from({ length: stepCount }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
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
        ) : null}
        <div
          style={{
            alignSelf: 'stretch',
            height: 2,
            background: `linear-gradient(90deg, transparent, rgba(${R5.gridRgb},0.6) 20%, rgba(${R5.gridRgb},0.6) 80%, transparent)`,
          }}
        />
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '6px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
        }}>
        {children}
      </div>
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
  onClick,
  style,
}: {
  accent: RetroAccent;
  label: string;
  sub?: string;
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
          padding: '14px 16px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 13,
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
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type='button'
      className='r5-btn'
      onClick={onClick}
      style={{
        clipPath: chamfer(6),
        background: active ? R5.cyan : 'rgba(120,150,200,0.14)',
        color: active ? R5.bgDeep : R5.ink,
        fontFamily: pixelFont,
        fontSize: 9,
        letterSpacing: 1,
        padding: '10px 12px',
        whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  );
}

/** Amber warning strip (gyro/camera problems) in the retro voice. */
export function WarnPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        clipPath: chamfer(8),
        background: `rgba(${R5.orangeRgb},0.16)`,
        border: `1px solid rgba(${R5.orangeRgb},0.5)`,
        padding: '10px 12px',
        fontFamily: monoFont,
        fontSize: 11,
        color: R5.orangeBright,
      }}>
      {children}
    </div>
  );
}
