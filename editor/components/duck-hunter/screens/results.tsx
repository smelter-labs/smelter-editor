'use client';

import { useMemo } from 'react';
import { characterById, characterVideoUrl } from '../characters';
import type { ShooterFeed } from '../use-shooter-feed';
import {
  ACCENT_LINE,
  ArcadeText,
  DogTally,
  LedText,
  PanelTitle,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  StarLine,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

/**
 * GAME OVER: winner card next to the winner's own character clip, the frozen
 * final scoreboard, and the global TOP SCORES table. The table (and the
 * winner's rank in it) rides the shooter_match 'ended' event — the server
 * records the score exactly once at match end, so remounts/refreshes can't
 * duplicate it. PLAY AGAIN keeps the room (phones stay in).
 */
export function Results({
  feed,
  onPlayAgain,
  onExit,
}: {
  feed: ShooterFeed;
  onPlayAgain: () => void;
  onExit: () => void;
}) {
  const match = feed.match;
  const winner = match?.winner ?? null;
  // The clip celebrates the WINNER's own pick (made on their phone).
  const winnerCharacter = characterById(winner?.characterId);
  const finalScores = useMemo(
    () => match?.finalScores ?? [],
    [match?.finalScores],
  );

  const table = match?.topScores ?? [];
  const newRank = match?.topScoreRank ?? null;

  useArcadeKeys({ confirm: onPlayAgain, back: onExit });

  return (
    <RetroFrame
      eyebrow='DUCK HUNTER'
      titleSize={26}
      footer={
        <RetroFooter
          tip='enter play again · esc exit to title'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton accent='red' glyph='B' label='EXIT' onClick={onExit} />
              <PixelButton
                accent='green'
                glyph='A'
                label='PLAY AGAIN'
                active
                onClick={onPlayAgain}
              />
            </div>
          }
        />
      }>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}>
        <ArcadeText size={40}>GAME OVER</ArcadeText>
        <StarLine>
          {winner ? `${winner.name} TAKES THE MARSH` : 'NOBODY BAGGED THE CROWN — DRAW'}
        </StarLine>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 24,
          flex: 1,
          minHeight: 0,
          marginTop: 18,
        }}>
        {/* Winner + their character clip */}
        <div
          style={{
            width: 330,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle color={winner ? winner.color : R5.cyan}>
            {winner ? 'WINNER' : 'RESULT'}
          </PanelTitle>
          {winnerCharacter ? (
            <PixelPanel
              accent={winnerCharacter.accent}
              cut={10}
              glow={0.5}
              innerStyle={{ padding: 0 }}>
              <video
                src={characterVideoUrl(winnerCharacter)}
                autoPlay
                loop
                muted
                playsInline
                style={{
                  display: 'block',
                  width: '100%',
                  aspectRatio: '16 / 9',
                  objectFit: 'cover',
                }}
              />
            </PixelPanel>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}>
            {winner ? (
              <>
                <span
                  style={{
                    fontFamily: pixelFont,
                    fontSize: 14,
                    color: winner.color,
                    textShadow: `0 0 10px ${winner.color}`,
                  }}>
                  {winner.name}
                </span>
                <LedText size={44}>{winner.score}</LedText>
              </>
            ) : (
              <span
                style={{
                  fontFamily: pixelFont,
                  fontSize: 14,
                  color: R5.inkMuted,
                }}>
                DRAW
              </span>
            )}
            {winnerCharacter ? (
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 10,
                  color: R5.inkMuted,
                  textTransform: 'uppercase',
                }}>
                hunting as {winnerCharacter.name}
              </span>
            ) : null}
          </div>
        </div>

        {/* Final scoreboard */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>FINAL SCORES</PanelTitle>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
            {finalScores.length === 0 ? (
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 12,
                  color: R5.inkMuted,
                }}>
                No hunters took a shot this round.
              </span>
            ) : (
              finalScores.map((p, i) => (
                <PixelPanel
                  key={p.clientId}
                  accent={i === 0 && winner ? 'yellow' : 'blue'}
                  cut={8}
                  glow={i === 0 && winner ? 0.5 : 0}
                  innerStyle={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 14px',
                  }}>
                  <span
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 11,
                      width: 22,
                      color: i === 0 ? R5.yellow : R5.inkMuted,
                    }}>
                    {i + 1}
                  </span>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      background: p.color,
                      boxShadow: `0 0 6px ${p.color}`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontFamily: pixelFont,
                      fontSize: 11,
                      color: R5.ink,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                    {p.name}
                  </span>
                  <DogTally count={p.dogScore ?? 0} size={14} />
                  <LedText size={22}>{p.score}</LedText>
                </PixelPanel>
              ))
            )}
          </div>
        </div>

        {/* Top scores */}
        <div
          style={{
            width: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle color={R5.orangeBright}>TOP SCORES</PanelTitle>
          <PixelPanel
            cut={10}
            innerStyle={{
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
            {table.length === 0 ? (
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 11,
                  color: R5.inkMuted,
                }}>
                The table is empty — make history.
              </span>
            ) : (
              table.map((e, i) => {
                const isNew = newRank != null && i === newRank - 1;
                return (
                  <div
                    key={`${e.at}-${i}`}
                    className={isNew ? 'r5-blink' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      fontFamily: monoFont,
                      fontSize: 12,
                      color: isNew ? R5.yellow : R5.ink,
                    }}>
                    <span style={{ width: 18, color: R5.inkMuted }}>
                      {i + 1}
                    </span>
                    <span
                      style={{
                        fontFamily: pixelFont,
                        fontSize: 10,
                        color: isNew ? R5.yellow : R5.cyan,
                      }}>
                      {e.initials}
                    </span>
                    <span style={{ flex: 1 }} />
                    <LedText size={16} color={isNew ? R5.yellow : R5.ink}>
                      {e.score}
                    </LedText>
                    <span style={{ fontSize: 10, color: R5.inkMuted }}>
                      {e.mode === 'time' ? 'TA' : 'SR'}
                    </span>
                  </div>
                );
              })
            )}
          </PixelPanel>
        </div>
      </div>
    </RetroFrame>
  );
}
