'use client';

import { useEffect, useState } from 'react';
import type { ShooterTopScoreEntry } from '@smelter-editor/types';
import { getDuckHunterTopScores } from '@/app/actions/actions';
import {
  ArcadeText,
  LedText,
  PixelWing,
  R5,
  RetroFrame,
  RetroFooter,
  StarLine,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { CHARACTERS, characterVideoUrl } from '../characters';
import { useArcadeKeys } from '../use-arcade-input';

/**
 * Attract-mode title screen: winged DUCK HUNTER headline over a dimmed
 * character clip, blinking PRESS START, and the local top score. Any
 * click / Enter starts the cabinet.
 */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useArcadeKeys({ confirm: onStart });
  const [attractIdx, setAttractIdx] = useState(0);

  // Slow attract rotation through the three character clips.
  useEffect(() => {
    const t = window.setInterval(
      () => setAttractIdx((i) => (i + 1) % CHARACTERS.length),
      9000,
    );
    return () => window.clearInterval(t);
  }, []);

  // Global (server-side) table; best across both modes. Failure shows nothing.
  const [topScore, setTopScore] = useState<ShooterTopScoreEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDuckHunterTopScores()
      .then((scores) => {
        if (cancelled) return;
        const best = [...scores.time, ...scores.points].sort(
          (a, b) => b.score - a.score || a.at - b.at,
        )[0];
        setTopScore(best ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div onClick={onStart} style={{ position: 'absolute', inset: 0 }}>
      <RetroFrame
        scanlines
        footer={<RetroFooter tip='insert coin · any key to start' />}>
        {/* Dimmed attract footage behind the grid. */}
        <video
          key={CHARACTERS[attractIdx].id}
          src={characterVideoUrl(CHARACTERS[attractIdx])}
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.14,
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 22,
          }}>
          <div
            style={{
              fontFamily: pixelFont,
              fontSize: 9,
              letterSpacing: 4,
              color: R5.inkMuted,
            }}>
            EST. 1984 · SMELTER ARCADE
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <PixelWing size={72} />
            <ArcadeText size={58}>DUCK HUNTER</ArcadeText>
            <PixelWing size={72} flip />
          </div>
          <StarLine size={13}>PHONES ARE GUNS · TV IS THE MARSH</StarLine>

          <div className='r5-blink' style={{ marginTop: 26 }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 20,
                letterSpacing: 3,
                color: R5.yellow,
                textShadow: `0 0 12px rgba(${R5.yellowRgb},0.7)`,
              }}>
              PRESS START
            </span>
          </div>

          {topScore ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                marginTop: 8,
                fontFamily: monoFont,
                fontSize: 12,
                letterSpacing: 2,
                color: R5.inkMuted,
                textTransform: 'uppercase',
              }}>
              top score
              <LedText size={22}>{topScore.score}</LedText>
              <span style={{ color: R5.cyan }}>{topScore.initials}</span>
            </div>
          ) : null}
        </div>
      </RetroFrame>
    </div>
  );
}
