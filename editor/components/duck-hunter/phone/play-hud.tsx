'use client';

import React, { useEffect, useState } from 'react';
import type { ShooterMatchEvent } from '@smelter-editor/types';
import {
  DogTally,
  LedText,
  PixelPanel,
  R5,
  chamfer,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { ChipButton } from './phone-shell';

type ScoreRow = {
  clientId: string;
  name: string;
  color: string;
  score: number;
  dogScore?: number;
};

/**
 * 4 Hz re-render for the match clock (anchored on server wall-clock). Exported
 * for the gun panel, which shows the same clock with the feed switched off.
 */
export function useClockTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [active]);
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Top strip over the video: connection dot, the match chip (clock / target /
 * open range) and your score in your crosshair color.
 */
export function PlayTopBar({
  connected,
  match,
  score,
  dogScore,
  myColor,
  scores,
}: {
  connected: boolean;
  match: ShooterMatchEvent | null;
  score: number;
  /** Dogs bagged, drawn as icons beside the score. */
  dogScore: number;
  myColor: string;
  scores: ScoreRow[];
}) {
  const phase = match?.phase ?? 'idle';
  useClockTick(phase === 'countdown' || phase === 'playing');
  const now = Date.now();

  let chip: React.ReactNode = null;
  if (phase === 'playing' && match?.mode === 'time' && match.endsAtMs != null) {
    const left = Math.max(0, match.endsAtMs - now);
    chip = (
      <span className={left <= 10_000 ? 'r5-blink-fast' : undefined}>
        <LedText
          size={20}
          color={left <= 10_000 ? R5.red : R5.yellow}
          glowRgb={left <= 10_000 ? R5.redRgb : R5.yellowRgb}>
          {fmtClock(left)}
        </LedText>
      </span>
    );
  } else if (phase === 'playing' && match?.mode === 'points') {
    chip = (
      <LedText size={18}>{`FIRST TO ${match.targetScore ?? '?'}`}</LedText>
    );
  } else if (phase === 'countdown') {
    chip = (
      <LedText size={18} color={R5.green} glowRgb={R5.greenRgb}>
        GET READY
      </LedText>
    );
  } else if (phase === 'idle') {
    chip = (
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 9,
          letterSpacing: 1,
          color: R5.inkMuted,
        }}>
        OPEN RANGE
      </span>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 6,
        pointerEvents: 'none',
        padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 10px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
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
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: connected ? R5.green : R5.red,
            boxShadow: `0 0 6px ${connected ? R5.green : R5.red}`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            clipPath: chamfer(6),
            background: 'rgba(4,8,15,0.8)',
            padding: '4px 12px',
          }}>
          {chip}
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              background: myColor,
              boxShadow: `0 0 6px ${myColor}`,
              alignSelf: 'center',
            }}
          />
          <LedText size={20} color={myColor} glowRgb='255,255,255'>
            {score}
          </LedText>
          <DogTally count={dogScore} />
        </span>
      </div>
      {scores.length > 1 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
          }}>
          {scores.map((s) => (
            <span
              key={s.clientId}
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: s.color,
                textShadow: '0 1px 3px #000',
              }}>
              {s.name}:{s.score}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fullscreen match overlays: the 3-2-1-GO countdown (with a haptic tick per
 * second) and the GAME OVER card with the winner, your placement and the
 * final scoreboard. Renders nothing in free play / while playing.
 */
export function MatchOverlay({
  match,
  myClientId,
}: {
  match: ShooterMatchEvent | null;
  myClientId: string | null;
}) {
  const phase = match?.phase ?? 'idle';
  useClockTick(phase === 'countdown');
  const now = Date.now();
  const countdownN =
    phase === 'countdown' && match?.startsAtMs != null
      ? Math.max(1, Math.ceil((match.startsAtMs - now) / 1000))
      : null;

  // Haptic tick on every countdown second + a long buzz on GO.
  const [lastTick, setLastTick] = useState<number | null>(null);
  useEffect(() => {
    if (countdownN == null) {
      if (lastTick != null) {
        setLastTick(null);
        if (phase === 'playing' && navigator.vibrate) navigator.vibrate(120);
      }
      return;
    }
    if (countdownN !== lastTick) {
      setLastTick(countdownN);
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, [countdownN, lastTick, phase]);

  if (phase === 'countdown' && countdownN != null) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 7,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'rgba(4,8,15,0.55)',
          pointerEvents: 'none',
        }}>
        <LedText size={120} color={R5.yellow} glowRgb={R5.yellowRgb}>
          {countdownN}
        </LedText>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 12,
            letterSpacing: 2,
            color: R5.ink,
          }}>
          {match?.mode === 'time'
            ? 'TIME ATTACK'
            : `FIRST TO ${match?.targetScore ?? '?'}`}
        </span>
      </div>
    );
  }

  if (phase === 'ended' && match) {
    const rows = match.finalScores ?? [];
    const myIdx = myClientId
      ? rows.findIndex((r) => r.clientId === myClientId)
      : -1;
    const me = myIdx >= 0 ? rows[myIdx] : null;
    const winner = match.winner ?? null;
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(4,8,15,0.75)',
          padding: 20,
        }}>
        <PixelPanel
          accent='yellow'
          cut={12}
          glow={0.5}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '20px 22px',
            minWidth: 260,
          }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 18,
              letterSpacing: 2,
              color: R5.red,
              textShadow: `0 0 10px rgba(${R5.redRgb},0.6)`,
            }}>
            GAME OVER
          </span>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 11,
              color: winner ? winner.color : R5.inkMuted,
            }}>
            {winner ? `${winner.name} WINS` : 'DRAW'}
          </span>
          {me ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontFamily: pixelFont,
                  fontSize: 10,
                  color: R5.inkMuted,
                }}>
                YOUR HUNT
              </span>
              <LedText size={26} color={me.color} glowRgb='255,255,255'>
                #{myIdx + 1} · {me.score}
              </LedText>
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              alignSelf: 'stretch',
            }}>
            {rows.slice(0, 5).map((r, i) => (
              <div
                key={r.clientId}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  fontFamily: monoFont,
                  fontSize: 11,
                  color: r.clientId === myClientId ? R5.yellow : R5.ink,
                }}>
                <span style={{ width: 14, color: R5.inkMuted }}>{i + 1}</span>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    background: r.color,
                    alignSelf: 'center',
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                  {r.name}
                </span>
                <LedText size={14}>{r.score}</LedText>
              </div>
            ))}
          </div>
          <span
            className='r5-blink'
            style={{
              fontFamily: pixelFont,
              fontSize: 9,
              letterSpacing: 1,
              color: R5.inkMuted,
            }}>
            WAITING FOR THE NEXT ROUND
          </span>
        </PixelPanel>
      </div>
    );
  }

  return null;
}

/** Ammo shells + reload countdown, retro-styled. */
export function AmmoRow({
  ammo,
  maxAmmo,
  reloadLeftMs,
  right,
}: {
  ammo: number;
  maxAmmo: number;
  reloadLeftMs: number;
  /**
   * Corner utility slot, floated so the shells stay centered on the row. This
   * strip is the only always-present play chrome with room to spare: the chip
   * grid below is deliberately kept 2×2, and GunPanel runs a fixed pixel
   * budget that silently drops standings rows if anything is added to it.
   */
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '8px 12px 0',
        background: R5.bgDeep,
      }}>
      {Array.from({ length: maxAmmo }, (_, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 16,
            clipPath: chamfer(3),
            background: i < ammo ? R5.yellow : 'rgba(120,150,200,0.18)',
            boxShadow:
              i < ammo
                ? `inset 0 2px 0 rgba(255,255,255,0.4), 0 0 5px rgba(${R5.yellowRgb},0.5)`
                : 'inset 0 0 0 1px rgba(120,150,200,0.25)',
          }}
        />
      ))}
      <span
        style={{
          marginLeft: 8,
          width: 88,
          textAlign: 'left',
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
        }}>
        {ammo < maxAmmo && reloadLeftMs > 0 ? (
          <LedText size={13} color={R5.orange} glowRgb={R5.orangeRgb}>
            +1 in {(reloadLeftMs / 1000).toFixed(1)}s
          </LedText>
        ) : ammo >= maxAmmo ? (
          'FULL'
        ) : (
          ''
        )}
      </span>
      {right ? (
        <span
          style={{
            position: 'absolute',
            right: 12,
            // Spans the row and centers within it, so the chip can't hang below
            // and get repainted by ControlsRow's opaque background.
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
          {right}
        </span>
      ) : null}
    </div>
  );
}

/** Bottom control row: utilities + the big FIRE button. */
export function ControlsRow({
  gyroMode,
  showModeToggle,
  onToggleMode,
  onRecenter,
  onAxes,
  camOn,
  onToggleCamera,
  streamOn,
  onToggleStream,
  ammo,
  blocked,
  onFire,
}: {
  gyroMode: boolean;
  /**
   * Offer the aim-mode chip at all. Finger aiming is hidden while the gyro is
   * healthy — with the feed off there is nothing on screen to tap at — and
   * comes back the moment the sensor lets the player down.
   */
  showModeToggle: boolean;
  onToggleMode: () => void;
  onRecenter: () => void;
  onAxes: () => void;
  camOn: boolean;
  onToggleCamera: () => void;
  /** The output feed is being pulled to this phone (off by default). */
  streamOn: boolean;
  onToggleStream: () => void;
  ammo: number;
  /**
   * The match phase has the trigger locked (countdown / game over). The button
   * goes dead-gray and reads HOLD, but still calls onFire — the refusal answers
   * with a flash, a buzz and a banner, which is the only feedback iOS gets. A
   * real `disabled` here would just feel like a broken app.
   */
  blocked?: boolean;
  onFire: () => void;
}) {
  const live = !blocked && ammo > 0;
  const label = blocked ? 'HOLD' : ammo > 0 ? 'FIRE' : 'RELOADING';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 8,
        padding: '10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)',
        background: R5.bgDeep,
      }}>
      {/* Two-column chip grid. The 📺 toggle takes the slot the aim-mode chip
          vacates while the gyro is healthy, so the usual cluster stays exactly
          2×2 and the FIRE button keeps its geometry. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, auto)',
          gap: 6,
          alignContent: 'center',
        }}>
        <ChipButton label='📺' active={streamOn} onClick={onToggleStream} />
        {showModeToggle ? (
          <ChipButton
            label={gyroMode ? '🎯' : '👆'}
            active={gyroMode}
            onClick={onToggleMode}
          />
        ) : null}
        {gyroMode ? <ChipButton label='⌖' onClick={onRecenter} /> : null}
        {gyroMode ? <ChipButton label='⚙' onClick={onAxes} /> : null}
        <ChipButton label='📷' active={camOn} onClick={onToggleCamera} />
      </div>
      {/* `r5-btn` for its `touch-action: manipulation`, exactly as the
          calibration trigger has it: without it iOS keeps the tap in play as a
          possible double-tap-zoom and can cancel the pointer on rapid fire.
          The class also sets `text-align: left`, hence the explicit centering
          below (the rest of its rules are overridden by this inline style). */}
      <button
        type='button'
        className='r5-btn'
        onPointerDown={onFire}
        style={{
          flex: 1,
          clipPath: chamfer(12),
          border: 'none',
          background: live ? R5.red : 'rgba(120,150,200,0.15)',
          color: live ? '#fff' : R5.inkMuted,
          fontFamily: pixelFont,
          fontSize: 18,
          letterSpacing: 3,
          textAlign: 'center',
          padding: '20px 10px',
          boxShadow: live
            ? `inset 0 3px 0 rgba(255,255,255,0.3), 0 0 14px rgba(${R5.redRgb},0.5)`
            : 'none',
          transition: 'transform 0.05s',
        }}>
        {label}
      </button>
    </div>
  );
}
