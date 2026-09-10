'use client';

import React from 'react';
import { BB, Mono, Wordmark, useIsLandscape } from '../bb-kit';

/**
 * Blacktop phone shell: wordmark + "TITLE · 2 / 4" on one line, then the
 * step content. Portrait wizard steps get the tall header; `compact`
 * (courtside panel, live views) and landscape shrink it to a thin row.
 */
export function BbPhoneShell({
  title,
  stepIndex,
  stepCount,
  compact = false,
  hideHeader = false,
  gap,
  children,
}: {
  /** MODERATOR · CAMERA · HOOP CAM · COURT CAM · COMMENTARY */
  title: string;
  /** 0-based; negative hides the "n / m" counter. */
  stepIndex: number;
  stepCount: number;
  /** One-row header + non-scrolling content region. */
  compact?: boolean;
  /** No header at all (full-bleed steps draw their own wordmark). */
  hideHeader?: boolean;
  gap?: number;
  children: React.ReactNode;
}) {
  const landscape = useIsLandscape();
  const small = compact || landscape;
  const counter =
    stepIndex >= 0 ? `${title} · ${stepIndex + 1} / ${stepCount}` : title;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: BB.page,
        color: BB.chalk,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      {hideHeader ? null : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: small
              ? 'calc(env(safe-area-inset-top, 0px) + 10px) calc(env(safe-area-inset-right, 0px) + 16px) 6px calc(env(safe-area-inset-left, 0px) + 16px)'
              : 'calc(env(safe-area-inset-top, 0px) + 40px) calc(env(safe-area-inset-right, 0px) + 24px) 0 calc(env(safe-area-inset-left, 0px) + 24px)',
            flexShrink: 0,
          }}>
          <Wordmark size={small ? 28 : 36} />
          <Mono
            size={11}
            tracking={0.22}
            color={BB.chalk}
            style={{ marginLeft: 'auto', opacity: 0.6, whiteSpace: 'nowrap' }}>
            {counter}
          </Mono>
        </div>
      )}
      <div
        className={compact ? undefined : 'bb-scroll'}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflowY: compact ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: gap ?? (small ? 12 : 24),
          padding: small
            ? `8px calc(env(safe-area-inset-right, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 12px) calc(env(safe-area-inset-left, 0px) + 16px)`
            : `28px calc(env(safe-area-inset-right, 0px) + 24px) calc(env(safe-area-inset-bottom, 0px) + 32px) calc(env(safe-area-inset-left, 0px) + 24px)`,
        }}>
        {children}
      </div>
    </div>
  );
}
