'use client';

import React, { useMemo } from 'react';
import type { KbtPlayer } from '@smelter-editor/types';
import {
  Backdrop,
  DisplayText,
  FooterHint,
  KBT,
  KbtButton,
  Label,
  Num,
  PodiumBlock,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import { KbtAvatar } from '../avatar';
import { RepShotStrip } from '../rep-shots';
import type { KbtFeed } from '../use-kbt-feed';

const CONFETTI_COLORS = [
  KBT.accent,
  KBT.cream,
  KBT.good,
  KBT.amber,
  KBT.silver,
];

/** Deterministic square confetti — pure CSS fall animation, no Math.random in render. */
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
          className='kbt-confetti'
          style={{
            position: 'absolute',
            top: -12,
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function PodiumSpot({
  p,
  place,
  height,
}: {
  p: KbtPlayer | null;
  place: 1 | 2 | 3;
  height: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        width: 220,
      }}>
      {p ? (
        <>
          {p.photoUrl ? (
            <KbtAvatar
              name={p.name}
              color={p.color}
              photoUrl={p.photoUrl}
              size={place === 1 ? 96 : 72}
            />
          ) : null}
          <DisplayText
            size={place === 1 ? 34 : 26}
            weight={800}
            tracking={1.5}
            style={{ textAlign: 'center' }}>
            {p.name}
          </DisplayText>
          <Num size={place === 1 ? 34 : 26}>
            {`${p.finalScore ?? p.bestScore}`}
          </Num>
          {place === 1 && p.repShots?.length ? (
            <RepShotStrip
              shots={p.repShots}
              height={32}
              max={4}
              style={{ justifyContent: 'center' }}
            />
          ) : null}
        </>
      ) : (
        <div style={{ height: 72 }} />
      )}
      <PodiumBlock
        rank={place}
        height={height}
        style={{ width: 180, justifyContent: 'center' }}>
        <Label size={13} tracking={3} color={KBT.dim}>
          {place === 1 ? 'CHAMPION' : place === 2 ? 'SILVER' : 'BRONZE'}
        </Label>
      </PodiumBlock>
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
      className='kbt-enter'
      style={{
        position: 'absolute',
        inset: 0,
        background: KBT.page,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
      <Backdrop />
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
        <DisplayText size={56} weight={800} tracking={3}>
          CHAMPIONS
        </DisplayText>
        <Label size={12} tracking={4} color={first ? KBT.accent : KBT.dim}>
          {first
            ? `${first.name} — TOURNAMENT CHAMPION`
            : 'NO SCORES ON RECORD'}
        </Label>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 18,
            marginTop: 8,
          }}>
          <PodiumSpot p={second} place={2} height={110} />
          <PodiumSpot p={first} place={1} height={160} />
          <PodiumSpot p={third} place={3} height={80} />
        </div>
        {ranked.length > 3 ? (
          <Label size={11} tracking={1.5}>
            {ranked
              .slice(3, 8)
              .map(
                (p, i) => `${i + 4}. ${p.name} ${p.finalScore ?? p.bestScore}`,
              )
              .join('   ·   ')}
          </Label>
        ) : null}
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          padding: '10px 32px 16px',
          borderTop: `1px solid ${KBT.border}`,
        }}>
        <FooterHint
          hints={[
            { key: 'ENTER', label: 'RUN IT BACK' },
            { key: 'ESC', label: 'POWER DOWN' },
          ]}
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <KbtButton
                variant='outline'
                dense
                label='EXIT TO TITLE'
                onClick={onExit}
              />
              <KbtButton
                variant='solid'
                dense
                label='BACK TO REGISTRATION'
                sub='roster reopens — run it back'
                active
                onClick={onPlayAgain}
              />
            </div>
          }
        />
      </div>
    </div>
  );
}
