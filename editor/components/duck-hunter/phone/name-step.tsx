'use client';

import React from 'react';
import { PixelPanel, R5, chamfer, monoFont, pixelFont } from '../retro-kit';
import { ActionButton, WarnPanel } from './phone-shell';

/**
 * Step 2 — call sign: one big name input plus the optional "face on TV"
 * camera card. Camera logic (getUserMedia + WHIP later) lives in the page.
 */
export function NameStep({
  name,
  onName,
  camOn,
  camErr,
  onToggleCamera,
  attachCamVideo,
  onContinue,
}: {
  name: string;
  onName: (v: string) => void;
  camOn: boolean;
  camErr: string | null;
  onToggleCamera: () => void;
  attachCamVideo: (el: HTMLVideoElement | null) => void;
  onContinue: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 16,
      }}>
      <label style={{ display: 'block' }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 2,
            color: R5.cyan,
          }}>
          CALL SIGN
        </span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder='HUNTER'
          maxLength={24}
          autoCapitalize='characters'
          style={{
            marginTop: 8,
            width: '100%',
            clipPath: chamfer(8),
            background: R5.panelDark,
            border: `2px solid rgba(${R5.gridRgb},0.6)`,
            color: R5.yellow,
            fontFamily: pixelFont,
            fontSize: 16,
            letterSpacing: 2,
            padding: '14px 14px',
            textTransform: 'uppercase',
            outline: 'none',
          }}
        />
      </label>

      <PixelPanel
        cut={10}
        innerStyle={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
        }}>
        <button
          type='button'
          className='r5-btn'
          onClick={onToggleCamera}
          style={{
            clipPath: chamfer(6),
            background: camOn ? R5.cyan : 'rgba(120,150,200,0.14)',
            color: camOn ? R5.bgDeep : R5.ink,
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 1,
            padding: '10px 12px',
            flexShrink: 0,
          }}>
          {camOn ? 'CAM ON' : 'CAM OFF'}
        </button>
        {camOn ? (
          <video
            ref={attachCamVideo}
            autoPlay
            playsInline
            muted
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `2px solid ${R5.cyan}`,
              transform: 'scaleX(-1)',
              flexShrink: 0,
            }}
          />
        ) : null}
        <span
          style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
          Show your face next to your name on the big screen.
        </span>
      </PixelPanel>
      {camErr ? <WarnPanel>{camErr}</WarnPanel> : null}

      <ActionButton
        accent='green'
        label='CONTINUE'
        active
        disabled={false}
        onClick={onContinue}
      />
    </div>
  );
}
