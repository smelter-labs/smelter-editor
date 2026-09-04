'use client';

import React, { useEffect, useState } from 'react';
import type { ShooterMatchEvent } from '@smelter-editor/types';
import {
  BlueprintBackdrop,
  DogTally,
  LedText,
  PanelTitle,
  PixelPanel,
  R5,
  StatBar,
  chamfer,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useElementSize, useIsLandscape } from './use-viewport';
import { fmtClock, useClockTick } from './play-hud';
import {
  STREAK_WINDOW_MS,
  myStanding,
  rankRows,
  reloadProgress,
  streakAt,
  type RankRow,
  type StreakState,
} from './gun-stats';

/* ------------------------------------------------------------------ *
 * The gun panel: what the phone shows instead of the output feed.
 *
 * With the stream off (the default) the phone is a controller, not a
 * second screen — nobody is watching a 4-inch copy of the projector.
 * So the stage turns into a gun-mounted control surface: magazine,
 * reload, score, placement, combo and status LEDs, all read straight
 * off the events the phone already receives.
 * ------------------------------------------------------------------ */

/** Section heights (px) the portrait budget is built from. */
const H_LEDS = 24;
const H_CLOCK = 46;
const H_AMMO = 62;
const H_SCORE = 62;
const H_COMBO = 30;
/** One hunter row in the standings table. */
const ROW_H = 15;
/** The footer hint pointing at the 📺 chip. */
const H_HINT = 14;
const GAP = 6;
const PAD = 8;
/** Below this the combo strip is dropped — see the layout comment in render. */
const COMBO_MIN_H = 240;

/**
 * 10 Hz re-render while a combo is decaying, then stops on its own. Each new
 * hit re-arms it (the effect keys on `lastHitAt`), so a cold panel does no
 * work at all — the combo is the only readout with no event behind its decay.
 */
function useDecayTick(lastHitAt: number | null): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (lastHitAt == null) return;
    const t = window.setInterval(() => {
      force((n) => n + 1);
      if (performance.now() - lastHitAt >= STREAK_WINDOW_MS) {
        window.clearInterval(t);
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [lastHitAt]);
}

/** One status LED: an 8×8 square plus its label. */
function Led({
  label,
  color,
  blink = false,
}: {
  label: string;
  /** null = dark (the condition is simply not met). */
  color: string | null;
  blink?: boolean;
}) {
  return (
    <span
      className={blink ? 'r5-blink-fast' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 8,
          height: 8,
          background: color ?? 'rgba(120,150,200,0.18)',
          boxShadow: color
            ? `0 0 6px ${color}`
            : 'inset 0 0 0 1px rgba(120,150,200,0.3)',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 7,
          letterSpacing: 1,
          color: color ?? R5.inkMuted,
        }}>
        {label}
      </span>
    </span>
  );
}

/** Section label: rails in portrait, a bare caption in the tight landscape. */
function SectionLabel({
  compact,
  color = R5.cyan,
  children,
}: {
  compact: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  if (!compact) return <PanelTitle color={color}>{children}</PanelTitle>;
  return (
    <div
      style={{
        fontFamily: pixelFont,
        fontSize: 8,
        letterSpacing: 1.5,
        color,
      }}>
      {children}
    </div>
  );
}

export type GunPanelProps = {
  connected: boolean;
  match: ShooterMatchEvent | null;
  /** A duck-enabled input is up — the RANGE lamp. */
  targetActive: boolean;
  /** The match phase has the trigger locked (countdown / game over). */
  triggerBlocked: boolean;
  ammo: number;
  maxAmmo: number;
  reloadLeftMs: number;
  /** Server-configured reload interval, for the progress bar. */
  reloadMs: number;
  score: number;
  dogScore: number;
  myColor: string;
  myClientId: string | null;
  scores: RankRow[];
  streak: StreakState;
  gyroMode: boolean;
  /** The gyro is in trouble (no samples / permission denied). */
  gyroWarn: boolean;
  camOn: boolean;
  camLive: boolean;
  /**
   * The self-view <video>. In feed mode it floats over the video; here it would
   * land on the standings table, so the panel hosts it in the LED row instead.
   */
  camVideo?: React.ReactNode;
};

export function GunPanel(props: GunPanelProps) {
  const landscape = useIsLandscape();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  // PixelPanel chrome eats 2px line + 3px gap per side, and its nested clip
  // layers are content-sized — so the body needs an explicit pixel height.
  const innerH = Math.max(0, size.h - 10);

  const phase = props.match?.phase ?? 'idle';
  useClockTick(phase === 'countdown' || phase === 'playing');
  useDecayTick(props.streak.lastHitAt);

  const compact = landscape;
  // Portrait budget: the fixed sections plus their gaps and the panel padding.
  // Whatever is left goes to the standings table, which measures itself and
  // drops rows to fit (the stage is overflow-hidden AND touch-none — nothing
  // scrolls, so anything that doesn't fit is simply gone).
  const showCombo = compact || innerH >= COMBO_MIN_H;
  const fixedH =
    PAD * 2 +
    H_LEDS +
    H_CLOCK +
    H_AMMO +
    H_SCORE +
    GAP * 3 +
    (showCombo ? H_COMBO + GAP : 0) +
    H_HINT +
    GAP;
  const tableH = compact ? innerH : innerH - fixedH - GAP;

  const leds = (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: H_LEDS,
        flexWrap: 'wrap',
      }}>
      <Led
        label='LINK'
        color={props.connected ? R5.green : R5.red}
        blink={!props.connected}
      />
      <Led label='RANGE' color={props.targetActive ? R5.cyan : null} />
      <Led
        label='GYRO'
        color={!props.gyroMode ? null : props.gyroWarn ? R5.orange : R5.green}
        blink={props.gyroMode && props.gyroWarn}
      />
      <Led
        label='CAM'
        color={!props.camOn ? null : props.camLive ? R5.green : R5.orange}
      />
      {props.camVideo ? (
        <span style={{ marginLeft: 'auto', display: 'flex' }}>
          {props.camVideo}
        </span>
      ) : null}
    </div>
  );

  const clock = <ClockReadout match={props.match} compact={compact} />;

  const magazine = (
    <Magazine
      ammo={props.ammo}
      maxAmmo={props.maxAmmo}
      reloadLeftMs={props.reloadLeftMs}
      reloadMs={props.reloadMs}
      blocked={props.triggerBlocked}
      compact={compact}
    />
  );

  const scoreBlock = (
    <ScoreBlock
      score={props.score}
      dogScore={props.dogScore}
      myColor={props.myColor}
      myClientId={props.myClientId}
      scores={props.scores}
      compact={compact}
    />
  );

  const combo = showCombo ? (
    <ComboStrip streak={props.streak} compact={compact} />
  ) : null;

  // Solo play has no table to draw; a plain spacer keeps the sections above
  // anchored to the top instead of drifting into the freed space.
  const showHunters = props.scores.length >= 2 && tableH >= 30;
  const hunters = showHunters ? (
    <Hunters
      scores={props.scores}
      myClientId={props.myClientId}
      compact={compact}
      maxHeight={tableH}
    />
  ) : (
    <div style={{ flex: 1, minHeight: 0 }} />
  );

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      {size.h > 60 ? (
        <PixelPanel
          accent='blue'
          cut={10}
          fill={R5.bgDeep}
          style={{ position: 'absolute', inset: 0 }}
          innerStyle={{ padding: 0 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: innerH,
              overflow: 'hidden',
              padding: PAD,
              display: 'flex',
              flexDirection: compact ? 'row' : 'column',
              gap: compact ? 12 : GAP,
            }}>
            <BlueprintBackdrop />
            {compact ? (
              <>
                <div style={COLUMN}>
                  {leds}
                  {magazine}
                  <div style={{ flex: 1, minHeight: 0 }} />
                  {combo}
                </div>
                <div style={COLUMN}>
                  {clock}
                  {scoreBlock}
                  {hunters}
                </div>
              </>
            ) : (
              <>
                {leds}
                {clock}
                {magazine}
                {scoreBlock}
                {combo}
                {hunters}
                {/* The feed is off by default, so say where it lives — in the
                    RetroFooter voice used across the wizard screens. */}
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    height: H_HINT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontFamily: monoFont,
                    fontSize: 9,
                    letterSpacing: 1,
                    color: R5.inkMuted,
                  }}>
                  <span className='r5-blink' style={{ color: R5.orange }}>
                    ▸
                  </span>
                  📺 TAP TO OPEN THE FEED
                </div>
              </>
            )}
            <div className='r5-scanlines' />
          </div>
        </PixelPanel>
      ) : null}
    </div>
  );
}

const COLUMN: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: GAP,
};

/** Match clock / target / phase, in the same words as the feed-mode top bar. */
function ClockReadout({
  match,
  compact,
}: {
  match: ShooterMatchEvent | null;
  compact: boolean;
}) {
  const phase = match?.phase ?? 'idle';
  const now = Date.now();
  const size = compact ? 26 : 30;

  let body: React.ReactNode;
  let caption = 'MATCH';
  if (phase === 'playing' && match?.mode === 'time' && match.endsAtMs != null) {
    const left = Math.max(0, match.endsAtMs - now);
    const hot = left <= 10_000;
    caption = 'TIME LEFT';
    body = (
      <span className={hot ? 'r5-blink-fast' : undefined}>
        <LedText
          size={size}
          color={hot ? R5.red : R5.yellow}
          glowRgb={hot ? R5.redRgb : R5.yellowRgb}>
          {fmtClock(left)}
        </LedText>
      </span>
    );
  } else if (phase === 'playing' && match?.mode === 'points') {
    caption = 'TARGET';
    body = (
      <LedText size={size}>{`FIRST TO ${match.targetScore ?? '?'}`}</LedText>
    );
  } else if (phase === 'countdown') {
    caption = 'MATCH';
    body = (
      <LedText size={size} color={R5.green} glowRgb={R5.greenRgb}>
        GET READY
      </LedText>
    );
  } else if (phase === 'ended') {
    caption = 'MATCH';
    body = (
      <LedText size={size} color={R5.red} glowRgb={R5.redRgb}>
        ROUND OVER
      </LedText>
    );
  } else if (phase === 'lobby') {
    caption = 'MATCH';
    body = (
      <LedText size={size} color={R5.inkMuted} glowRgb={R5.lineRgb}>
        STAND BY
      </LedText>
    );
  } else {
    caption = 'MATCH';
    body = (
      <LedText size={size} color={R5.cyan} glowRgb={R5.cyanRgb}>
        OPEN RANGE
      </LedText>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        minHeight: compact ? undefined : H_CLOCK,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 7,
          letterSpacing: 2,
          color: R5.inkMuted,
        }}>
        {caption}
      </span>
      {body}
    </div>
  );
}

/** Shells, reload bar and the countdown to the next round in the magazine. */
function Magazine({
  ammo,
  maxAmmo,
  reloadLeftMs,
  reloadMs,
  blocked,
  compact,
}: {
  ammo: number;
  maxAmmo: number;
  reloadLeftMs: number;
  reloadMs: number;
  blocked: boolean;
  compact: boolean;
}) {
  const total = compact ? 10 : 12;
  const lit = Math.round(reloadProgress(reloadLeftMs, reloadMs) * total);
  const reloading = ammo < maxAmmo && reloadLeftMs > 0;
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        minHeight: compact ? undefined : H_AMMO,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
      <SectionLabel compact={compact} color={blocked ? R5.red : R5.cyan}>
        {/* Never "OUT OF AMMO" when the real reason is the match phase — the
            magazine may well be full while the trigger is locked. */}
        <span className={blocked ? 'r5-blink' : undefined}>
          {blocked ? 'HOLD FIRE' : 'MAGAZINE'}
        </span>
      </SectionLabel>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // MAX_AMMO_CAP is 12 — a full magazine still fits a narrow phone.
          gap: maxAmmo > 8 ? 3 : 4,
        }}>
        {Array.from({ length: maxAmmo }, (_, i) => (
          <div
            key={i}
            style={{
              width: 12,
              height: 16,
              clipPath: chamfer(3),
              background:
                i < ammo && !blocked
                  ? R5.yellow
                  : i < ammo
                    ? 'rgba(120,150,200,0.45)'
                    : 'rgba(120,150,200,0.18)',
              boxShadow:
                i < ammo && !blocked
                  ? `inset 0 2px 0 rgba(255,255,255,0.4), 0 0 5px rgba(${R5.yellowRgb},0.5)`
                  : 'inset 0 0 0 1px rgba(120,150,200,0.25)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: compact ? 'flex-start' : 'center',
        }}>
        <StatBar
          label='RELOAD'
          color={R5.orange}
          colorRgb={R5.orangeRgb}
          value={lit}
          total={total}
          cell={compact ? 6 : 7}
          labelWidth={44}
        />
        <span style={{ minWidth: 62 }}>
          {reloading ? (
            <LedText size={13} color={R5.orange} glowRgb={R5.orangeRgb}>
              +1 IN {(reloadLeftMs / 1000).toFixed(1)}s
            </LedText>
          ) : ammo >= maxAmmo ? (
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
              }}>
              FULL
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** Your score, dogs bagged, placement badge and the gap to the leader. */
function ScoreBlock({
  score,
  dogScore,
  myColor,
  myClientId,
  scores,
  compact,
}: {
  score: number;
  dogScore: number;
  myColor: string;
  myClientId: string | null;
  scores: RankRow[];
  compact: boolean;
}) {
  const standing = myStanding(scores, myClientId);
  let line = 'SOLO RANGE';
  if (standing && standing.of > 1) {
    if (standing.rank === 1 && standing.tied) line = 'TIED FOR #1';
    else if (standing.rank === 1) line = `LEADING BY ${standing.gapToNext}`;
    else
      line = `${standing.gapToLead} BEHIND ${standing.leader?.name ?? '???'}`;
  }
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        minHeight: compact ? undefined : H_SCORE,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LedText
            size={compact ? 28 : 34}
            color={myColor}
            glowRgb='255,255,255'>
            {score}
          </LedText>
          <DogTally count={dogScore} size={14} />
        </span>
        {standing && standing.of > 1 ? (
          <span
            style={{
              width: 44,
              height: 44,
              clipPath: chamfer(6),
              background: 'rgba(120,150,200,0.14)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
            <LedText size={22}>#{standing.rank}</LedText>
            <span
              style={{ fontFamily: monoFont, fontSize: 8, color: R5.inkMuted }}>
              OF {standing.of}
            </span>
          </span>
        ) : null}
      </div>
      {compact ? null : (
        <span
          style={{
            fontFamily: monoFont,
            fontSize: 10,
            letterSpacing: 1,
            color: R5.inkMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {line}
        </span>
      )}
    </div>
  );
}

/**
 * Combo readout, deliberately quiet: a small ×N while the chain is hot and a
 * dash otherwise. The loud treatment (decay bar, BEST) moved to the broadcast
 * HUD — on the phone it pulled eyes off the screen the player aims at.
 */
function ComboStrip({
  streak,
  compact,
}: {
  streak: StreakState;
  compact: boolean;
}) {
  const { leftMs, combo } = streakAt(
    streak,
    typeof performance !== 'undefined' ? performance.now() : 0,
  );
  const comboN = Math.round(combo);
  const hot = leftMs > 0 && comboN >= 2;
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        minHeight: compact ? undefined : H_COMBO,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 8,
          letterSpacing: 1,
          color: R5.inkMuted,
        }}>
        COMBO
      </span>
      {hot ? (
        <span style={{ fontFamily: monoFont, fontSize: 12, color: R5.orange }}>
          ×{comboN}
        </span>
      ) : (
        <span
          style={{ fontFamily: monoFont, fontSize: 12, color: R5.inkMuted }}>
          —
        </span>
      )}
    </div>
  );
}

/** The other hunters, ranked — your own row picked out in yellow. */
function Hunters({
  scores,
  myClientId,
  compact,
  maxHeight,
}: {
  scores: RankRow[];
  myClientId: string | null;
  compact: boolean;
  /** Space the layout has left over; rows are dropped to fit it. */
  maxHeight: number;
}) {
  if (scores.length < 2 || maxHeight < 30) return null;
  const ranked = rankRows(scores);
  // The title rails plus the "+N MORE" line have to come out of the budget
  // before rows do, or the last row would be clipped mid-glyph.
  const rows = Math.max(
    1,
    Math.floor((maxHeight - (compact ? 12 : 14) - ROW_H) / ROW_H),
  );
  const limit = compact ? Math.min(3, rows) : rows;
  const shown = ranked.slice(0, limit);
  const hidden = ranked.length - shown.length;

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
      }}>
      <SectionLabel compact={compact}>HUNTERS</SectionLabel>
      {shown.map((r) => {
        const me = r.clientId === myClientId;
        return (
          <div
            key={r.clientId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: ROW_H,
              fontFamily: monoFont,
              fontSize: 10,
              color: me ? R5.yellow : R5.ink,
            }}>
            <span style={{ width: 12, color: R5.inkMuted }}>{r.rank}</span>
            <span
              style={{
                width: 8,
                height: 8,
                background: r.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {r.name}
            </span>
            <LedText
              size={12}
              color={me ? R5.yellow : R5.ink}
              glowRgb='255,255,255'>
              {r.score}
            </LedText>
            {me ? <span style={{ color: R5.yellow }}>◀</span> : null}
          </div>
        );
      })}
      {hidden > 0 ? (
        <span
          style={{
            fontFamily: monoFont,
            fontSize: 9,
            color: R5.inkMuted,
            height: ROW_H,
          }}>
          +{hidden} MORE
        </span>
      ) : null}
    </div>
  );
}

/**
 * Shown over the video while the feed is being established (or after it
 * failed). zIndex 5 keeps it under the match overlays (7) and the warning
 * stack (20) — a refused shot still has to be readable on top of everything.
 */
export function FeedLinkingCard({ state }: { state: 'linking' | 'failed' }) {
  const failed = state === 'failed';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        padding: 20,
      }}>
      <PixelPanel
        accent={failed ? 'red' : 'cyan'}
        cut={10}
        glow={0.4}
        innerStyle={{ padding: '14px 18px' }}>
        <span className={failed ? undefined : 'r5-blink'}>
          <LedText
            size={16}
            color={failed ? R5.red : R5.cyan}
            glowRgb={failed ? R5.redRgb : R5.cyanRgb}>
            {failed ? 'NO FEED — TAP 📺 TO RETRY' : 'LINKING FEED…'}
          </LedText>
        </span>
      </PixelPanel>
    </div>
  );
}
