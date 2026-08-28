import React from 'react';
import { Text, View } from '@swmansion/smelter';
import { SHOOTER_CHARACTERS } from '@smelter-editor/types';
import type { ShooterOverlay } from '../app/store';
import { ArcadeBigText, RETRO, RetroPanel } from './RetroPanel';
import { hudScale, resultsLayout } from './retroHudLayout';

const FONT = 'Doto';

const CHARACTER_BY_ID = new Map(SHOOTER_CHARACTERS.map((c) => [c.id, c]));

/** Small uppercase column header in the retro-kit PanelTitle spirit. */
function ColumnTitle({
  text,
  color,
  left,
  top,
  width,
  k,
}: {
  text: string;
  color: string;
  left: number;
  top: number;
  width: number;
  k: number;
}) {
  const fs = Math.round(28 * k);
  return (
    <View
      style={{
        top,
        left,
        width,
        height: Math.round(fs * 1.4),
        overflow: 'hidden',
      }}>
      <Text
        style={{
          fontSize: fs,
          color,
          width,
          align: 'center',
          fontFamily: FONT,
          fontWeight: 'black',
        }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Full-frame GAME OVER scene burned into the output while the match sits in
 * 'ended' (until the host arms the lobby again): translucent blueprint
 * backdrop over the live video, the winner card, the frozen FINAL SCORES and
 * the global TOP SCORES table — the same retro-kit look as the browser
 * results screen, drawn with the retro-panel shader + Doto text. Mounted at
 * the output root (like the KBT chrome), so it survives any layout.
 */
export function ShooterResultsScene({
  shooter,
  resolution,
}: {
  shooter: ShooterOverlay;
  resolution: { width: number; height: number };
}) {
  const match = shooter.match;
  if (!match || match.phase !== 'ended') return null;
  const k = hudScale(resolution);
  const layout = resultsLayout(resolution);
  const winner = match.winner;
  const winnerCharacter = winner?.characterId
    ? CHARACTER_BY_ID.get(
        winner.characterId as (typeof SHOOTER_CHARACTERS)[number]['id'],
      )
    : undefined;
  // Re-rendered on every publish (~30 Hz) — same blink pattern as MatchHud.
  const blinkOn = Date.now() % 700 < 400;

  const rowFs = Math.round(30 * k);
  const rowH = Math.round(rowFs * 1.9);
  const pad = Math.round(24 * k);
  const listTop = Math.round(64 * k);

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'hidden',
      }}>
      {/* Blueprint backdrop dimming the live video. */}
      <RetroPanel
        x={0}
        y={0}
        w={resolution.width}
        h={resolution.height}
        cut={0}
        linePx={0}
        gapPx={0}
        fill={RETRO.bgDeep}
        fillA={0.87}
        grid={1}
        gridPx={Math.round(39 * k)}
        scanline={0.6}
        scanPx={Math.max(3, Math.round(4 * k))}
      />

      <ArcadeBigText
        text='GAME OVER'
        fontSize={Math.round(96 * k)}
        color={RETRO.orangeBright}
        top={layout.headerTop}
        width={resolution.width}
      />
      <View
        style={{
          top: layout.subTop,
          left: 0,
          width: resolution.width,
          height: Math.round(40 * k),
          overflow: 'hidden',
        }}>
        <Text
          style={{
            fontSize: Math.round(26 * k),
            color: winner ? winner.color : RETRO.inkMuted,
            width: resolution.width,
            align: 'center',
            fontFamily: FONT,
            fontWeight: 'bold',
          }}>
          {winner
            ? `★ ${winner.name} TAKES THE MARSH ★`
            : '★ NOBODY BAGGED THE CROWN — DRAW ★'}
        </Text>
      </View>

      {/* WINNER column */}
      <RetroPanel
        x={layout.winner.left}
        y={layout.winner.top}
        w={layout.winner.width}
        h={layout.winner.height}
        cut={Math.round(14 * k)}
        line={winner ? winner.color : RETRO.cyan}
        glow={0.4}
        glowPx={Math.round(18 * k)}
        fillA={0.9}
        scanline={0.4}
        scanPx={Math.max(3, Math.round(4 * k))}>
        <ColumnTitle
          text={winner ? 'WINNER' : 'RESULT'}
          color={winner ? winner.color : RETRO.cyan}
          left={0}
          top={pad}
          width={layout.winner.width}
          k={k}
        />
        {winner ? (
          <>
            <View
              style={{
                top: Math.round(150 * k),
                left: 0,
                width: layout.winner.width,
                height: Math.round(52 * k),
                overflow: 'hidden',
              }}>
              <Text
                style={{
                  fontSize: Math.round(40 * k),
                  color: winner.color,
                  width: layout.winner.width,
                  align: 'center',
                  fontFamily: FONT,
                  fontWeight: 'black',
                }}>
                {winner.name}
              </Text>
            </View>
            <ArcadeBigText
              text={`${winner.score}`}
              fontSize={Math.round(150 * k)}
              color={RETRO.yellow}
              top={Math.round(230 * k)}
              width={layout.winner.width}
            />
            {winnerCharacter ? (
              <>
                <View
                  style={{
                    top: Math.round(470 * k),
                    left: 0,
                    width: layout.winner.width,
                    height: Math.round(40 * k),
                    overflow: 'hidden',
                  }}>
                  <Text
                    style={{
                      fontSize: Math.round(30 * k),
                      color: winnerCharacter.color,
                      width: layout.winner.width,
                      align: 'center',
                      fontFamily: FONT,
                      fontWeight: 'black',
                    }}>
                    {winnerCharacter.name}
                  </Text>
                </View>
                <View
                  style={{
                    top: Math.round(515 * k),
                    left: 0,
                    width: layout.winner.width,
                    height: Math.round(32 * k),
                    overflow: 'hidden',
                  }}>
                  <Text
                    style={{
                      fontSize: Math.round(22 * k),
                      color: RETRO.inkMuted,
                      width: layout.winner.width,
                      align: 'center',
                      fontFamily: FONT,
                      fontWeight: 'bold',
                    }}>
                    {`HUNTING AS ${winnerCharacter.title.toUpperCase()}`}
                  </Text>
                </View>
              </>
            ) : null}
          </>
        ) : (
          <View
            style={{
              top: Math.round(280 * k),
              left: 0,
              width: layout.winner.width,
              height: Math.round(50 * k),
              overflow: 'hidden',
            }}>
            <Text
              style={{
                fontSize: Math.round(36 * k),
                color: RETRO.inkMuted,
                width: layout.winner.width,
                align: 'center',
                fontFamily: FONT,
                fontWeight: 'black',
              }}>
              DRAW
            </Text>
          </View>
        )}
      </RetroPanel>

      {/* FINAL SCORES column */}
      <RetroPanel
        x={layout.finals.left}
        y={layout.finals.top}
        w={layout.finals.width}
        h={layout.finals.height}
        cut={Math.round(14 * k)}
        line={RETRO.lineBright}
        fillA={0.9}
        scanline={0.4}
        scanPx={Math.max(3, Math.round(4 * k))}>
        <ColumnTitle
          text='FINAL SCORES'
          color={RETRO.ink}
          left={0}
          top={pad}
          width={layout.finals.width}
          k={k}
        />
        {match.finalScores.slice(0, 8).map((p, i) => {
          const top = listTop + i * rowH;
          const character = p.characterId
            ? CHARACTER_BY_ID.get(
                p.characterId as (typeof SHOOTER_CHARACTERS)[number]['id'],
              )
            : undefined;
          return (
            <View
              key={`final-${i}`}
              style={{
                top,
                left: pad,
                width: layout.finals.width - pad * 2,
                height: rowH,
                overflow: 'hidden',
              }}>
              <View
                style={{
                  top: Math.round((rowH - rowFs * 1.3) / 2),
                  left: 0,
                  width: Math.round(rowFs * 1.4),
                  height: Math.round(rowFs * 1.4),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: rowFs,
                    color: i === 0 && winner ? RETRO.yellow : RETRO.inkMuted,
                    fontFamily: FONT,
                    fontWeight: 'black',
                  }}>
                  {`${i + 1}`}
                </Text>
              </View>
              <View
                style={{
                  top: Math.round((rowH - rowFs * 0.8) / 2),
                  left: Math.round(rowFs * 1.6),
                  width: Math.round(rowFs * 0.8),
                  height: Math.round(rowFs * 0.8),
                  backgroundColor: p.color,
                }}
              />
              <View
                style={{
                  top: Math.round((rowH - rowFs * 1.3) / 2),
                  left: Math.round(rowFs * 2.9),
                  width:
                    layout.finals.width - pad * 2 - Math.round(rowFs * 6.0),
                  height: Math.round(rowFs * 1.4),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: rowFs,
                    color: character ? character.color : RETRO.ink,
                    fontFamily: FONT,
                    fontWeight: 'bold',
                  }}>
                  {p.name}
                </Text>
              </View>
              <View
                style={{
                  top: Math.round((rowH - rowFs * 1.4) / 2),
                  left: layout.finals.width - pad * 2 - Math.round(rowFs * 3),
                  width: Math.round(rowFs * 3),
                  height: Math.round(rowFs * 1.5),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: Math.round(rowFs * 1.2),
                    color: '#FFFFFF',
                    width: Math.round(rowFs * 3),
                    align: 'right',
                    fontFamily: FONT,
                    fontWeight: 'black',
                  }}>
                  {`${p.score}`}
                </Text>
              </View>
            </View>
          );
        })}
      </RetroPanel>

      {/* TOP SCORES column */}
      <RetroPanel
        x={layout.tops.left}
        y={layout.tops.top}
        w={layout.tops.width}
        h={layout.tops.height}
        cut={Math.round(14 * k)}
        line={RETRO.orangeBright}
        glow={0.3}
        glowPx={Math.round(14 * k)}
        fillA={0.9}
        scanline={0.4}
        scanPx={Math.max(3, Math.round(4 * k))}>
        <ColumnTitle
          text='TOP SCORES'
          color={RETRO.orangeBright}
          left={0}
          top={pad}
          width={layout.tops.width}
          k={k}
        />
        {match.topScores.slice(0, 10).map((e, i) => {
          const isNew = match.topScoreRank != null && i === match.topScoreRank - 1;
          const rowColor = isNew ? RETRO.yellow : RETRO.ink;
          const topRowH = Math.round(rowFs * 1.7);
          const top = listTop + i * topRowH;
          // The freshly earned row blinks arcade-style.
          if (isNew && !blinkOn) return null;
          return (
            <View
              key={`top-${i}`}
              style={{
                top,
                left: pad,
                width: layout.tops.width - pad * 2,
                height: topRowH,
                overflow: 'hidden',
              }}>
              <View
                style={{
                  top: 0,
                  left: 0,
                  width: Math.round(rowFs * 1.3),
                  height: Math.round(rowFs * 1.4),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: Math.round(rowFs * 0.85),
                    color: RETRO.inkMuted,
                    fontFamily: FONT,
                    fontWeight: 'bold',
                  }}>
                  {`${i + 1}`}
                </Text>
              </View>
              <View
                style={{
                  top: 0,
                  left: Math.round(rowFs * 1.5),
                  width: Math.round(rowFs * 3.2),
                  height: Math.round(rowFs * 1.4),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: rowFs,
                    color: isNew ? RETRO.yellow : RETRO.cyan,
                    fontFamily: FONT,
                    fontWeight: 'black',
                  }}>
                  {e.initials}
                </Text>
              </View>
              <View
                style={{
                  top: 0,
                  left: layout.tops.width - pad * 2 - Math.round(rowFs * 4.4),
                  width: Math.round(rowFs * 3),
                  height: Math.round(rowFs * 1.4),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: rowFs,
                    color: rowColor,
                    width: Math.round(rowFs * 3),
                    align: 'right',
                    fontFamily: FONT,
                    fontWeight: 'black',
                  }}>
                  {`${e.score}`}
                </Text>
              </View>
              <View
                style={{
                  top: Math.round(rowFs * 0.25),
                  left: layout.tops.width - pad * 2 - Math.round(rowFs * 1.2),
                  width: Math.round(rowFs * 1.2),
                  height: Math.round(rowFs * 1.0),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: Math.round(rowFs * 0.6),
                    color: RETRO.inkMuted,
                    fontFamily: FONT,
                    fontWeight: 'bold',
                  }}>
                  {e.mode === 'time' ? 'TA' : 'SR'}
                </Text>
              </View>
            </View>
          );
        })}
        {match.topScores.length === 0 ? (
          <View
            style={{
              top: listTop,
              left: pad,
              width: layout.tops.width - pad * 2,
              height: Math.round(rowFs * 1.4),
              overflow: 'hidden',
            }}>
            <Text
              style={{
                fontSize: Math.round(rowFs * 0.7),
                color: RETRO.inkMuted,
                fontFamily: FONT,
                fontWeight: 'bold',
              }}>
              THE TABLE IS EMPTY — MAKE HISTORY.
            </Text>
          </View>
        ) : null}
      </RetroPanel>
    </View>
  );
}
