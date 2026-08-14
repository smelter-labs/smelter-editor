'use client';

import React from 'react';
import {
  ACCENT_LINE,
  ACCENT_RGB,
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
  type RetroAccent,
} from '../retro-kit';
import { WarnPanel } from './phone-shell';

function WeaponCard({
  accent,
  icon,
  title,
  tag,
  desc,
  onPick,
}: {
  accent: RetroAccent;
  icon: string;
  title: string;
  tag?: string;
  desc: string;
  onPick: () => void;
}) {
  const color = ACCENT_LINE[accent];
  const rgb = ACCENT_RGB[accent];
  return (
    <button
      type='button'
      className='r5-btn'
      onClick={onPick}
      style={{ display: 'block', width: '100%' }}>
      <PixelPanel
        accent={accent}
        cut={12}
        glow={0.35}
        fill={`rgba(${rgb},0.10)`}
        innerStyle={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '16px 16px',
        }}>
        <span style={{ fontSize: 30, flexShrink: 0 }}>{icon}</span>
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            textAlign: 'left',
            minWidth: 0,
          }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 12,
                letterSpacing: 1,
                color,
                textShadow: `0 0 8px rgba(${rgb},0.6)`,
              }}>
              {title}
            </span>
            {tag ? (
              <span
                style={{
                  fontFamily: pixelFont,
                  fontSize: 7,
                  letterSpacing: 1,
                  color: R5.bgDeep,
                  background: color,
                  padding: '3px 6px',
                }}>
                {tag}
              </span>
            ) : null}
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
            {desc}
          </span>
        </span>
      </PixelPanel>
    </button>
  );
}

/**
 * Step 3 — weapon select. Tapping GYRO CANNON is the user gesture that
 * requests iOS motion permission (handled in the page); FINGER BLASTER
 * skips calibration entirely.
 */
export function WeaponStep({
  onGyro,
  onFinger,
  warn,
}: {
  onGyro: () => void;
  onFinger: () => void;
  /** Sensor problem text after a failed gyro attempt (HTTPS / permission). */
  warn: string | null;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 14,
      }}>
      <WeaponCard
        accent='cyan'
        icon='🎯'
        title='GYRO CANNON'
        tag='RECOMMENDED'
        desc='Wave the phone like a TV remote — the crosshair follows. Needs the motion sensor (HTTPS).'
        onPick={onGyro}
      />
      {warn ? (
        <WarnPanel>
          {warn} — grab the FINGER BLASTER instead.
        </WarnPanel>
      ) : null}
      <WeaponCard
        accent='orange'
        icon='👆'
        title='FINGER BLASTER'
        desc='Tap the duck on your phone screen to aim and shoot. Works everywhere.'
        onPick={onFinger}
      />
      <p
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        you can switch weapons any time during the hunt
      </p>
    </div>
  );
}
