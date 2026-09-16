'use client';

import React from 'react';
import type { MatchSetup } from '../arcade';
import type { DuckHunterSliderConfig } from '../use-duck-hunter-room';
import {
  AmmoPips,
  Arrow,
  Aura,
  Crosshair,
  LedBadge,
  Phone,
  QrGlyph,
  Sprite,
} from '../illustrations';
import {
  LedText,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
  type RetroAccent,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

/**
 * Why the screen is open: 'start' = the host pressed START on the lobby and
 * LET'S HUNT here is the real start; 'browse' = opened from the RULES button,
 * confirm just returns to the lobby.
 */
export type RulesIntent = 'start' | 'browse';

/**
 * HOW TO PLAY — the illustrated briefing. The host page is what the room
 * sees before a round (the lobby is on the projector), so this is where a
 * newcomer learns the game: six cards, in the order they need them.
 */
export function RulesScreen({
  intent,
  setup,
  sliders,
  canStart,
  starting,
  onConfirm,
  onBack,
}: {
  intent: RulesIntent;
  setup: MatchSetup;
  sliders: DuckHunterSliderConfig;
  /** Lobby readiness, live — LET'S HUNT is disabled without it. */
  canStart: boolean;
  /** The 'start' command is in flight. */
  starting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  useArcadeKeys({ confirm: onConfirm, back: onBack });

  const roundLine =
    setup.mode === 'time'
      ? `TIME ATTACK · ${setup.durationMs / 1000}S`
      : `SCORE RUSH · FIRST TO ${setup.targetScore}`;

  const startLabel = starting
    ? 'STARTING…'
    : canStart
      ? "LET'S HUNT"
      : 'LOBBY NOT READY';

  return (
    <RetroFrame
      title='HOW TO PLAY'
      eyebrow='DUCK HUNTER'
      subtitle={roundLine}
      titleSize={26}
      footer={
        <RetroFooter
          tip={
            intent === 'start'
              ? "enter to let's hunt · esc back to the lobby"
              : 'enter or esc back to the lobby'
          }
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='BACK'
                onClick={onBack}
              />
              {intent === 'start' ? (
                <PixelButton
                  accent='green'
                  glyph='A'
                  label={startLabel}
                  active={canStart && !starting}
                  disabled={!canStart || starting}
                  onClick={onConfirm}
                />
              ) : (
                <PixelButton
                  accent='green'
                  glyph='A'
                  label='GOT IT'
                  active
                  onClick={onConfirm}
                />
              )}
            </div>
          }
        />
      }>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(2, 1fr)',
          gap: 16,
        }}>
        <Card
          n={1}
          accent='cyan'
          title='SCAN TO JOIN'
          lines={[
            'POINT YOUR PHONE AT THE QR ON THE LOBBY SCREEN.',
            'NO APP — THE PAGE IS THE GUN.',
          ]}>
          <Row>
            <PixelPanel
              accent='blue'
              cut={4}
              fill='#fff'
              innerStyle={{ padding: 4 }}>
              <svg width={52} height={52} viewBox='0 0 26 26'>
                <QrGlyph x={1} y={1} cell={2} color={R5.edge} />
              </svg>
            </PixelPanel>
            <Arrow size={20} />
            <Phone size={84}>
              <QrGlyph x={8} y={20} cell={2} color={R5.cyan} />
            </Phone>
          </Row>
        </Card>

        <Card
          n={2}
          accent='orange'
          title='PICK YOUR HUNTER'
          lines={[
            'CALL SIGN + CHARACTER — EACH HUNTER ONLY ONCE.',
            'CALIBRATE: HOLD THE PHONE AT THE SCREEN CENTER, TAP.',
          ]}>
          <Row>
            <Phone size={84} accent={R5.orange}>
              <rect x='7' y='14' width='8' height='10' fill={R5.orange} />
              <rect x='16' y='14' width='8' height='10' fill={R5.line} />
              <rect x='25' y='14' width='8' height='10' fill={R5.line} />
              <rect
                x='6'
                y='13'
                width='10'
                height='12'
                fill='none'
                stroke={R5.yellow}
                strokeWidth='1'
              />
              <rect x='9' y='30' width='22' height='3' fill={R5.inkMuted} />
              <rect x='9' y='36' width='14' height='3' fill={R5.inkMuted} />
            </Phone>
            <Arrow size={20} />
            <Crosshair size={40} color={R5.orange} />
          </Row>
        </Card>

        <Card
          n={3}
          accent='yellow'
          title='TILT TO AIM'
          lines={[
            'TILT THE PHONE — YOUR CROSSHAIR FOLLOWS ON THE BIG SCREEN.',
            'DRIFTED? TAP CENTER WHILE POINTING AT THE SCREEN CENTER.',
          ]}>
          <Row>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Arrow size={16} dir='left' color={R5.yellow} />
              <Phone size={84} tilt={-14} accent={R5.yellow}>
                <rect x='18' y='32' width='4' height='4' fill={R5.yellow} />
              </Phone>
              <Arrow size={16} dir='right' color={R5.yellow} />
            </div>
            <Arrow size={20} />
            <Crosshair size={40} tag='ACE' />
          </Row>
        </Card>

        <Card
          n={4}
          accent='green'
          title='TAP TO SHOOT'
          lines={[
            'A REAL BIRD GETS AN AURA, THEN A DUCK HATCHES ON IT, HOLDS, AND FLIES OFF AT 45°.',
            'HIT IT WHILE IT IS ON SCREEN. +1 A DUCK.',
          ]}>
          <Row>
            <Aura size={40} />
            <Arrow size={16} />
            <Sprite name='duck-fly' size={56} />
            <Arrow size={16} dir='up-right' color={R5.green} />
            <div style={{ position: 'relative' }}>
              <Sprite name='duck-shot' size={56} />
              <LedText
                size={16}
                color={R5.green}
                glowRgb={R5.greenRgb}
                style={{ position: 'absolute', top: -10, right: -18 }}>
                +1
              </LedText>
            </div>
          </Row>
        </Card>

        <Card
          n={5}
          accent='red'
          title='WATCH YOUR PIPS'
          lines={[
            `${sliders.maxAmmo} SHOTS A MAGAZINE, RELOAD IS AUTOMATIC (${sliders.reloadSec}S A SHELL).`,
            'QUICK FOLLOW-UP KILLS CHAIN INTO ×COMBO, UP TO ×3. THE LAUGHING DOG IS FAIR GAME — BUT SCORES NOTHING.',
          ]}>
          <Row>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}>
              <AmmoPips
                max={sliders.maxAmmo}
                loaded={Math.max(1, Math.ceil(sliders.maxAmmo / 2))}
                size={18}
              />
              <LedText size={14} color={R5.orange} glowRgb={R5.orangeRgb}>
                ×3 COMBO
              </LedText>
            </div>
            <Sprite name='dog-laugh' size={64} />
          </Row>
        </Card>

        <Card
          n={6}
          accent='pink'
          title='WIN THE ROUND'
          lines={
            setup.mode === 'time'
              ? [
                  'TIME ATTACK: MOST POINTS WHEN THE CLOCK HITS ZERO WINS.',
                  'TOP SCORES GO ON THE BOARD.',
                ]
              : [
                  `SCORE RUSH: THE FIRST HUNTER TO ${setup.targetScore} POINTS WINS.`,
                  'TOP SCORES GO ON THE BOARD.',
                ]
          }>
          <Row>
            {setup.mode === 'time' ? (
              <LedBadge
                value={formatClock(setup.durationMs)}
                caption='ON THE CLOCK'
              />
            ) : (
              <LedBadge
                value={String(setup.targetScore)}
                caption='POINTS TO WIN'
              />
            )}
            <Arrow size={20} />
            <LedBadge
              value='1ST'
              caption='TAKES THE ROUND'
              color={R5.green}
              glowRgb={R5.greenRgb}
            />
          </Row>
        </Card>
      </div>
    </RetroFrame>
  );
}

/** `M:SS` from ms — the same shape as the broadcast's match chip. */
function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Illustration strip: centered, evenly spaced parts. */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}>
      {children}
    </div>
  );
}

/** One briefing card: illustration on top, numbered title, two mono lines. */
function Card({
  n,
  accent,
  title,
  lines,
  children,
}: {
  n: number;
  accent: RetroAccent;
  title: string;
  lines: string[];
  children: React.ReactNode;
}) {
  return (
    <PixelPanel
      accent={accent}
      cut={10}
      glow={0.2}
      stretch
      innerStyle={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
      {children}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <LedText size={18}>{n}</LedText>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 1.5,
            color: R5.ink,
          }}>
          {title}
        </span>
      </div>
      {lines.map((l, i) => (
        <span
          key={i}
          style={{
            fontFamily: monoFont,
            fontSize: 10,
            lineHeight: 1.4,
            letterSpacing: 0.5,
            color: i === 0 ? R5.ink : R5.inkMuted,
          }}>
          {l}
        </span>
      ))}
    </PixelPanel>
  );
}
