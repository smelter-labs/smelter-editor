'use client';

import React, { useState } from 'react';
import {
  LedText,
  PixelPanel,
  R5,
  StarLine,
  chamfer,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { ActionButton, ChipButton, WarnPanel } from './phone-shell';
import {
  AXIS_OPTIONS,
  MAX_MOVE_SENS,
  MIN_MOVE_SENS,
  clampSens,
  type AxisCfg,
} from './axis';
import type { PracticeTarget } from './practice';
import { useElementSize, useIsLandscape } from './use-viewport';

/** Dark backdrop for controls/readouts overlaid on the range art. */
const OVERLAY_BG = 'rgba(4,8,15,0.72)';

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

/** One axis of the ADVANCED sheet: source select + invert + sensitivity. */
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
 * Strength of the translation ("parallax") term — how much physically moving
 * the phone nudges the crosshair on top of the rotation. Single slider, no
 * axis picker: it is one 2D effect, and 0 switches it off completely.
 */
function MoveControls({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const off = value <= MIN_MOVE_SENS;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 0',
        borderTop: `1px solid rgba(${R5.gridRgb},0.25)`,
      }}>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 9,
          letterSpacing: 1,
          color: R5.ink,
        }}>
        MOVEMENT ⇱ PARALLAX
      </span>
      <span style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
        Shoving the phone nudges the crosshair; it drifts back on its own.
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
          move
        </span>
        <input
          type='range'
          className='r5-range'
          min={MIN_MOVE_SENS}
          max={MAX_MOVE_SENS}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <LedText size={14}>{off ? 'OFF' : value.toFixed(1)}</LedText>
      </div>
    </div>
  );
}

/** The big red trigger — the main interaction on this screen. */
function FireButton({
  onClick,
  style,
}: {
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type='button'
      className='r5-btn'
      onClick={onClick}
      style={{
        clipPath: chamfer(8),
        background: R5.red,
        color: '#fff',
        fontFamily: pixelFont,
        fontSize: 12,
        letterSpacing: 2,
        padding: '16px 20px',
        textAlign: 'center',
        ...style,
      }}>
      FIRE
    </button>
  );
}

/**
 * Full per-axis mapping for power users, as a modal sheet so it never pushes
 * the no-scroll calibrate layout around. Scrolling inside the sheet is fine.
 */
function AdvancedSheet({
  horizCfg,
  vertCfg,
  onHoriz,
  onVert,
  moveSens,
  onMoveSens,
  onClose,
}: {
  horizCfg: AxisCfg;
  vertCfg: AxisCfg;
  onHoriz: (c: AxisCfg) => void;
  onVert: (c: AxisCfg) => void;
  moveSens: number;
  onMoveSens: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20,
        background: OVERLAY_BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(420px, 100%)' }}>
        <PixelPanel
          accent='cyan'
          cut={10}
          glow={0.4}
          innerStyle={{
            padding: '12px 14px',
            maxHeight: '78vh',
            overflowY: 'auto',
          }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              paddingBottom: 8,
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 10,
                letterSpacing: 2,
                color: R5.cyan,
              }}>
              ADVANCED AXIS SETUP
            </span>
            <ChipButton dense label='✕' onClick={onClose} />
          </div>
          <AxisControls
            title='HORIZONTAL ←→'
            cfg={horizCfg}
            onChange={onHoriz}
          />
          <AxisControls title='VERTICAL ↑↓' cfg={vertCfg} onChange={onVert} />
          <MoveControls value={moveSens} onChange={onMoveSens} />
          <ActionButton
            accent='green'
            dense
            label='DONE'
            active
            onClick={onClose}
            style={{ marginTop: 10 }}
          />
        </PixelPanel>
      </div>
    </div>
  );
}

/**
 * Step 4 — guided gyro calibration. The duck-shooting test range fills the
 * whole viewport budget (no scrolling — you aim with the gyro while touching
 * the controls), with the quick fixes overlaid on the range in portrait and
 * in a side rail in landscape. Per-axis mapping lives in a modal sheet.
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
  moveSens,
  onMoveSens,
  warn,
  returnToPlay,
  onContinue,
}: {
  previewAim: { x: number; y: number };
  targets: PracticeTarget[];
  /**
   * Fires the test shot. Without `at` it shoots at the preview crosshair
   * (FIRE button); a direct tap on the range passes the tapped point instead.
   */
  onTestFire: (at?: { x: number; y: number }) => void;
  onRecenter: () => void;
  horizCfg: AxisCfg;
  vertCfg: AxisCfg;
  onHoriz: (c: AxisCfg) => void;
  onVert: (c: AxisCfg) => void;
  /** Strength of the translation/parallax term; 0 disables it. */
  moveSens: number;
  onMoveSens: (v: number) => void;
  warn: string | null;
  /** true when opened from the play HUD (⚙️ AXES) — changes the exit label. */
  returnToPlay: boolean;
  onContinue: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const landscape = useIsLandscape();
  const [rangeRef, range] = useElementSize<HTMLDivElement>();
  const hits = targets.filter((t) => t.hit).length;
  const allDown = hits >= targets.length && targets.length > 0;

  const bumpSpeed = (delta: number) => {
    onHoriz({ ...horizCfg, sens: clampSens(horizCfg.sens + delta) });
    onVert({ ...vertCfg, sens: clampSens(vertCfg.sens + delta) });
  };

  // PixelPanel chrome eats 2px line + 3px gap per side; the play surface
  // needs an explicit pixel height (the nested clip layers are content-sized).
  const innerH = Math.max(0, range.h - 10);
  const fire = () => onTestFire();

  const speedReadout = (
    <span
      style={{
        fontFamily: monoFont,
        fontSize: 10,
        color: R5.ink,
        alignSelf: 'center',
        whiteSpace: 'nowrap',
      }}>
      {horizCfg.sens.toFixed(1)}
    </span>
  );

  const continueButton = (
    <ActionButton
      accent='green'
      dense
      label={
        returnToPlay
          ? 'BACK TO THE HUNT'
          : allDown
            ? 'READY — CONTINUE'
            : 'CONTINUE'
      }
      active={allDown || returnToPlay}
      onClick={onContinue}
      style={landscape ? undefined : { flex: 1, width: 'auto' }}
    />
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: landscape ? 'row' : 'column',
        gap: 8,
      }}>
      {/* Test range: move the crosshair with the phone, bag the ducks. */}
      <div
        ref={rangeRef}
        style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
        {range.h > 60 ? (
          <PixelPanel
            accent='cyan'
            cut={10}
            glow={0.25}
            style={{ position: 'absolute', inset: 0 }}
            innerStyle={{ padding: 0 }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: innerH,
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
              {/* Tap-to-shoot: the ducks are directly tappable (decorations
                  above are pointer-transparent, controls sit higher and keep
                  their own handlers). Also the no-gyro fallback. */}
              <div
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onTestFire({
                    x: (e.clientX - r.left) / r.width,
                    y: (e.clientY - r.top) / r.height,
                  });
                }}
                style={{ position: 'absolute', inset: 0, zIndex: 1 }}
              />
              {/* hint caption */}
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  clipPath: chamfer(5),
                  background: OVERLAY_BG,
                  padding: '5px 8px',
                  fontFamily: monoFont,
                  fontSize: 8,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: R5.inkMuted,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}>
                point & fire · or tap the ducks
              </div>
              {/* ducks counter */}
              <div
                style={{
                  position: 'absolute',
                  top: 30,
                  left: 6,
                  clipPath: chamfer(5),
                  background: OVERLAY_BG,
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  pointerEvents: 'none',
                  zIndex: 4,
                }}>
                <span
                  style={{
                    fontFamily: pixelFont,
                    fontSize: 8,
                    letterSpacing: 1,
                    color: R5.inkMuted,
                  }}>
                  DUCKS
                </span>
                <LedText size={16} color={allDown ? R5.green : R5.yellow}>
                  {hits}/{targets.length}
                </LedText>
              </div>
              {!landscape ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 30,
                    right: 6,
                    zIndex: 4,
                  }}>
                  <ChipButton
                    dense
                    label='⌖ CENTER'
                    onClick={onRecenter}
                    style={{ background: OVERLAY_BG }}
                  />
                </div>
              ) : null}
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
                    // Taps land on the shoot layer underneath.
                    pointerEvents: 'none',
                  }}>
                  {t.hit ? '💥' : '🦆'}
                </span>
              ))}
              <RangeCrosshair aim={previewAim} />
              {warn ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: landscape ? 8 : 64,
                    zIndex: 5,
                  }}>
                  <WarnPanel>{warn}</WarnPanel>
                </div>
              ) : null}
              {!landscape ? (
                <>
                  {/* quick fixes, thumb-reach corners */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 6,
                      bottom: 6,
                      right: 98,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 4,
                      zIndex: 4,
                    }}>
                    <ChipButton
                      dense
                      label='⇄ L/R'
                      active={horizCfg.invert}
                      onClick={() =>
                        onHoriz({ ...horizCfg, invert: !horizCfg.invert })
                      }
                      style={
                        horizCfg.invert ? undefined : { background: OVERLAY_BG }
                      }
                    />
                    <ChipButton
                      dense
                      label='⇅ U/D'
                      active={vertCfg.invert}
                      onClick={() =>
                        onVert({ ...vertCfg, invert: !vertCfg.invert })
                      }
                      style={
                        vertCfg.invert ? undefined : { background: OVERLAY_BG }
                      }
                    />
                    <ChipButton
                      dense
                      label='SPD −'
                      onClick={() => bumpSpeed(-0.2)}
                      style={{ background: OVERLAY_BG }}
                    />
                    {speedReadout}
                    <ChipButton
                      dense
                      label='SPD +'
                      onClick={() => bumpSpeed(0.2)}
                      style={{ background: OVERLAY_BG }}
                    />
                  </div>
                  <FireButton
                    onClick={fire}
                    style={{
                      position: 'absolute',
                      right: 6,
                      bottom: 6,
                      zIndex: 4,
                    }}
                  />
                </>
              ) : null}
            </div>
          </PixelPanel>
        ) : null}
      </div>

      {landscape ? (
        /* Side rail: the header is hidden in compact landscape, so the step
         * label lives here. */
        <div
          style={{
            width: 168,
            flexShrink: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
          <StarLine size={8}>CALIBRATION</StarLine>
          <ChipButton
            dense
            label='⌖ CENTER'
            onClick={onRecenter}
            style={{ width: '100%', textAlign: 'center' }}
          />
          <ChipButton
            dense
            label='⇄ L/R FLIPPED'
            active={horizCfg.invert}
            onClick={() => onHoriz({ ...horizCfg, invert: !horizCfg.invert })}
            style={{ width: '100%', textAlign: 'center' }}
          />
          <ChipButton
            dense
            label='⇅ U/D FLIPPED'
            active={vertCfg.invert}
            onClick={() => onVert({ ...vertCfg, invert: !vertCfg.invert })}
            style={{ width: '100%', textAlign: 'center' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ChipButton
              dense
              label='SPD −'
              onClick={() => bumpSpeed(-0.2)}
              style={{ flex: 1, textAlign: 'center' }}
            />
            {speedReadout}
            <ChipButton
              dense
              label='SPD +'
              onClick={() => bumpSpeed(0.2)}
              style={{ flex: 1, textAlign: 'center' }}
            />
          </div>
          <ChipButton
            dense
            label='⚙ ADVANCED'
            onClick={() => setAdvanced(true)}
            style={{ width: '100%', textAlign: 'center' }}
          />
          <div style={{ flex: 1 }} />
          <FireButton onClick={fire} style={{ width: '100%' }} />
          {continueButton}
        </div>
      ) : (
        /* Portrait footer: advanced + continue in one row. */
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <ChipButton
            dense
            label='⚙ ADVANCED'
            onClick={() => setAdvanced(true)}
          />
          {continueButton}
        </div>
      )}

      {advanced ? (
        <AdvancedSheet
          horizCfg={horizCfg}
          vertCfg={vertCfg}
          onHoriz={onHoriz}
          onVert={onVert}
          moveSens={moveSens}
          onMoveSens={onMoveSens}
          onClose={() => setAdvanced(false)}
        />
      ) : null}
    </div>
  );
}
