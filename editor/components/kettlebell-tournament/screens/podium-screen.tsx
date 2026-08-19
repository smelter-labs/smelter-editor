'use client';

import React, { useMemo } from 'react';
import type { KbtPlayer } from '@smelter-editor/types';
import {
  ArcadeText,
  BlueprintBackdrop,
  LedText,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  StarLine,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import type { KbtFeed } from '../use-kbt-feed';

const CONFETTI_COLORS = ['#FFEB3B', '#00E5FF', '#FF4081', '#76FF03', '#FF9100'];

/** Deterministic pixel confetti — pure CSS fall animation, no Math.random in render. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: (i * 137.5) % 100,
        delay: (i * 0.37) % 3,
        duration: 2.6 + ((i * 0.83) % 2),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + (i % 3) * 3,
      })),
    [],
  );
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}>
      {pieces.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: -12,
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            animation: `kbt-confetti ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes kbt-confetti {
          0% { transform: translateY(-16px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(740px) rotate(540deg); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

function PodiumBlock({
  p,
  place,
  height,
}: {
  p: KbtPlayer | null;
  place: 1 | 2 | 3;
  height: number;
}) {
  const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
  const accent = place === 1 ? 'yellow' : place === 2 ? 'cyan' : 'orange';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        width: 220,
      }}>
      {p ? (
        <>
          <div style={{ fontSize: place === 1 ? 52 : 40 }}>{medal}</div>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: place === 1 ? 16 : 13,
              letterSpacing: 1.5,
              color: p.color,
              textAlign: 'center',
            }}>
            {p.name}
          </span>
          <LedText size={place === 1 ? 40 : 30}>
            {`${p.finalScore ?? p.bestScore}`}
          </LedText>
        </>
      ) : (
        <div style={{ height: 110 }} />
      )}
      <PixelPanel
        accent={accent}
        cut={10}
        glow={place === 1 ? 0.6 : 0.25}
        innerStyle={{
          width: 180,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 26,
            color: R5.inkMuted,
          }}>
          {place}
        </span>
      </PixelPanel>
    </div>
  );
}

/** The podium: top three by final-then-best score, confetti, rematch. */
export function PodiumScreen({
  feed,
  onPlayAgain,
  onExit,
}: {
  feed: KbtFeed;
  onPlayAgain: () => void;
  onExit: () => void;
}) {
  const ranked = [...(feed.state?.players ?? [])]
    .filter((p) => p.bestScore > 0 || p.finalScore != null)
    .sort(
      (a, b) =>
        (b.finalScore ?? -1) - (a.finalScore ?? -1) ||
        b.bestScore - a.bestScore,
    );
  const [first, second, third] = [
    ranked[0] ?? null,
    ranked[1] ?? null,
    ranked[2] ?? null,
  ];

  useArcadeKeys({ confirm: onPlayAgain, back: onExit });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: R5.bgDeep,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <BlueprintBackdrop />
      <Confetti />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}>
        <ArcadeText size={30}>CHAMPIONS</ArcadeText>
        <StarLine size={10}>
          {first
            ? `${first.name} — TOURNAMENT CHAMPION`
            : 'NO SCORES ON RECORD'}
        </StarLine>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 18,
            marginTop: 8,
          }}>
          <PodiumBlock p={second} place={2} height={110} />
          <PodiumBlock p={first} place={1} height={160} />
          <PodiumBlock p={third} place={3} height={80} />
        </div>
        {ranked.length > 3 ? (
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 12,
              color: R5.inkMuted,
            }}>
            {ranked
              .slice(3, 8)
              .map(
                (p, i) => `${i + 4}. ${p.name} ${p.finalScore ?? p.bestScore}`,
              )
              .join('   ·   ')}
          </div>
        ) : null}
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <RetroFooter
          tip='enter to run it back · esc to power down'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='EXIT TO TITLE'
                onClick={onExit}
              />
              <PixelButton
                accent='green'
                glyph='A'
                label='REMATCH'
                active
                onClick={onPlayAgain}
              />
            </div>
          }
        />
      </div>
      <div className='r5-scanlines' />
    </div>
  );
}
