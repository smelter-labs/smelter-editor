'use client';

import React, { useState } from 'react';
import {
  LedText,
  PixelPanel,
  R5,
  chamfer,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { ActionButton, ChipButton, WarnPanel } from './phone-shell';
import {
  AXIS_OPTIONS,
  clampSens,
  type AxisCfg,
} from './axis';

export type PracticeTarget = { id: number; x: number; y: number; hit: boolean };

/** Crosshair used in the test range (accent cyan, like the game one). */
function RangeCrosshair({ aim }: { aim: { x: number; y: number } }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: 30,
        height: 30,
        left: `${aim.x * 100}%`,
        top: `${aim.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 3,
      }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2px solid ${R5.cyan}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          height: '100%',
          width: 2,
          transform: 'translateX(-50%)',
          background: R5.cyan,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          width: '100%',
          height: 2,
          transform: 'translateY(-50%)',
          background: R5.cyan,
        }}
      />
    </div>
  );
}

/** One axis of the ADVANCED panel: source select + invert + sensitivity. */
function AxisControls({
  title,
  cfg,
  onChange,
}: {
  title: string;
  cfg: AxisCfg;
  onChange: (c: AxisCfg) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 0',
        borderTop: `1px solid rgba(${R5.gridRgb},0.25)`,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 1,
            color: R5.ink,
          }}>
          {title}
        </span>
        <ChipButton
          label={cfg.invert ? '⇄ INVERTED' : '⇄ INVERT'}
          active={cfg.invert}
          onClick={() => onChange({ ...cfg, invert: !cfg.invert })}
        />
      </div>
      <select
        value={cfg.source}
        onChange={(e) =>
          onChange({ ...cfg, source: e.target.value as AxisCfg['source'] })
        }
        style={{
          width: '100%',
          background: R5.panelDark,
          border: `1px solid rgba(${R5.gridRgb},0.5)`,
          color: R5.ink,
          fontFamily: monoFont,
          fontSize: 12,
          padding: '8px 8px',
        }}>
        {AXIS_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
          sens
        </span>
        <input
          type='range'
          className='r5-range'
          min={0.3}
          max={4}
          step={0.1}
          value={cfg.sens}
          onChange={(e) => onChange({ ...cfg, sens: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <LedText size={14}>{cfg.sens.toFixed(1)}</LedText>
      </div>
    </div>
  );
}

/**
 * Step 4 — guided gyro calibration: a duck-shooting test range driven by the
 * live preview crosshair, plain-words quick fixes (flip L/R, flip U/D, speed)
 * and the full per-axis mapping tucked behind ADVANCED.
 */
export function CalibrateStep({
  previewAim,
  targets,
  onTestFire,
  onRecenter,
  horizCfg,
  vertCfg,
  onHoriz,
  onVert,
  warn,
  returnToPlay,
  onContinue,
}: {
  previewAim: { x: number; y: number };
  targets: PracticeTarget[];
  onTestFire: () => void;
  onRecenter: () => void;
  horizCfg: AxisCfg;
  vertCfg: AxisCfg;
  onHoriz: (c: AxisCfg) => void;
  onVert: (c: AxisCfg) => void;
  warn: string | null;
  /** true when opened from the play HUD (⚙️ AXES) — changes the exit label. */
  returnToPlay: boolean;
  onContinue: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const hits = targets.filter((t) => t.hit).length;
  const allDown = hits >= targets.length && targets.length > 0;

  const bumpSpeed = (delta: number) => {
    onHoriz({ ...horizCfg, sens: clampSens(horizCfg.sens + delta) });
    onVert({ ...vertCfg, sens: clampSens(vertCfg.sens + delta) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 1,
          margin: 0,
        }}>
        hold the phone like a remote · point at the TV · tap ⌖ to center
      </p>

      {/* Test range: move the crosshair with the phone, bag the ducks. */}
      <PixelPanel accent='cyan' cut={10} glow={0.25} innerStyle={{ padding: 0 }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            background: `linear-gradient(180deg, ${R5.panelDark} 0%, #0d2036 70%, #123049 100%)`,
            overflow: 'hidden',
          }}>
          {/* reeds along the bottom, like the select-screen art */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 18,
              background: `repeating-linear-gradient(90deg, rgba(${R5.greenRgb},0.35) 0 3px, transparent 3px 14px)`,
            }}
          />
          {targets.map((t) => (
            <span
              key={t.id}
              style={{
                position: 'absolute',
                left: `${t.x * 100}%`,
                top: `${t.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 30,
                filter: t.hit ? 'grayscale(1)' : 'none',
                opacity: t.hit ? 0.35 : 1,
                transition: 'opacity 0.2s',
                zIndex: 2,
              }}>
              {t.hit ? '💥' : '🦆'}
            </span>
          ))}
          <RangeCrosshair aim={previewAim} />
        </div>
      </PixelPanel>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 9,
              letterSpacing: 1,
              color: R5.inkMuted,
            }}>
            DUCKS
          </span>
          <LedText size={22} color={allDown ? R5.green : R5.yellow}>
            {hits}/{targets.length}
          </LedText>
        </div>
        <button
          type='button'
          className='r5-btn'
          onClick={onTestFire}
          style={{
            clipPath: chamfer(8),
            background: R5.red,
            color: '#fff',
            fontFamily: pixelFont,
            fontSize: 12,
            letterSpacing: 2,
            padding: '12px 26px',
          }}>
          FIRE
        </button>
      </div>

      {/* Plain-words quick fixes. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <ChipButton label='⌖ CENTER' onClick={onRecenter} />
        <ChipButton
          label='⇄ L/R FLIPPED'
          active={horizCfg.invert}
          onClick={() => onHoriz({ ...horizCfg, invert: !horizCfg.invert })}
        />
        <ChipButton
          label='⇅ U/D FLIPPED'
          active={vertCfg.invert}
          onClick={() => onVert({ ...vertCfg, invert: !vertCfg.invert })}
        />
        <ChipButton label='SPEED −' onClick={() => bumpSpeed(-0.2)} />
        <ChipButton label='SPEED +' onClick={() => bumpSpeed(0.2)} />
        <span
          style={{
            alignSelf: 'center',
            fontFamily: monoFont,
            fontSize: 10,
            color: R5.inkMuted,
          }}>
          speed {horizCfg.sens.toFixed(1)}
        </span>
      </div>

      {warn ? <WarnPanel>{warn}</WarnPanel> : null}

      {/* Full per-axis mapping for power users. */}
      <div>
        <button
          type='button'
          className='r5-btn'
          onClick={() => setAdvanced((a) => !a)}
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 1,
            color: R5.inkMuted,
            padding: '6px 0',
          }}>
          {advanced ? '▼ ADVANCED AXIS SETUP' : '▶ ADVANCED AXIS SETUP'}
        </button>
        {advanced ? (
          <div>
            <AxisControls title='HORIZONTAL ←→' cfg={horizCfg} onChange={onHoriz} />
            <AxisControls title='VERTICAL ↑↓' cfg={vertCfg} onChange={onVert} />
          </div>
        ) : null}
      </div>

      <ActionButton
        accent='green'
        label={
          returnToPlay
            ? 'BACK TO THE HUNT'
            : allDown
              ? 'READY — CONTINUE'
              : 'CONTINUE'
        }
        sub={
          allDown || returnToPlay
            ? undefined
            : 'bag all 3 ducks to test your aim (optional)'
        }
        active={allDown || returnToPlay}
        onClick={onContinue}
      />
    </div>
  );
}
