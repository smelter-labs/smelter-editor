import React from 'react';
import { Image, Rescaler, Shader, Text, View } from '@swmansion/smelter';
import type { ShooterOverlay } from '../app/store';
import { ArcadeBigText, RETRO, RetroPanel } from './RetroPanel';
import {
  CharacterClip,
  HudLine,
  shooterCharacter,
  useCharacterClipPlaying,
} from './ShooterCharacterClip';
import {
  DOG_ICONS_MAX,
  chamferClipCut,
  dogIconPitch,
  hudScale,
  resultsLayout,
  type PodiumSlot,
} from './retroHudLayout';

const FONT = 'Doto';

/**
 * Dog tally: one sprite per dog bagged, laid out right-to-left so the pile stays
 * flush with the strip's right edge and shingles instead of overflowing. Shares
 * dogIconPitch with the broadcast scoreboard so both read the same way.
 */
function DogTally({
  count,
  top,
  left,
  stripW,
  iconH,
}: {
  count: number;
  top: number;
  left: number;
  stripW: number;
  iconH: number;
}) {
  const n = Math.min(count, DOG_ICONS_MAX);
  if (n <= 0) return null;
  const iconW = Math.round((iconH * 29) / 28); // dog-tally.png is 29x28
  const pitch = dogIconPitch(
    n,
    stripW,
    iconW,
    Math.max(2, Math.round(iconH * 0.17)),
  );
  return (
    <View
      style={{ top, left, width: stripW, height: iconH, overflow: 'hidden' }}>
      {Array.from({ length: n }).map((_, i) => (
        <View
          key={`dog-${i}`}
          style={{
            top: 0,
            left: Math.round(stripW - iconW - i * pitch),
            width: iconW,
            height: iconH,
            overflow: 'hidden',
          }}>
          <Rescaler style={{ width: iconW, height: iconH, rescaleMode: 'fit' }}>
            <Image imageId='dog-tally' />
          </Rescaler>
        </View>
      ))}
    </View>
  );
}

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

type PodiumEntry = {
  name: string;
  color: string;
  score: number;
  characterId?: string;
};

/**
 * One place on the podium: the finisher's character clip standing on a
 * ranked pedestal. The pedestal is a retro panel in the player's color and
 * doubles as the fallback surface — a hunter who never picked a character (or
 * whose clip has not started decoding yet) simply gets an empty lit box, so
 * the podium never changes shape while the input warms up.
 */
function PodiumPlace({
  slot,
  entry,
  k,
}: {
  slot: PodiumSlot;
  entry: PodiumEntry | undefined;
  k: number;
}) {
  const first = slot.place === 1;
  const accent = entry ? entry.color : RETRO.line;
  const character = shooterCharacter(entry?.characterId);
  const clipPlaying = useCharacterClipPlaying(entry?.characterId);
  // Keeps the panel's chamfered stroke visible around the video.
  const clipInset = Math.max(3, Math.round(6 * k));
  const panelCut = Math.round(12 * k);
  const clipW = slot.clip.width - clipInset * 2;
  const clipH = slot.clip.height - clipInset * 2;
  const nameFs = Math.round((first ? 36 : 30) * k);
  const scoreFs = Math.round(slot.pedestal.height * (first ? 0.46 : 0.44));
  const rankFs = Math.round(slot.pedestal.height * 0.26);
  return (
    <>
      {/* Name + character title above the clip. */}
      <HudLine
        text={entry ? entry.name : '—'}
        color={accent}
        top={slot.label.top}
        left={slot.label.left}
        width={slot.label.width}
        fontSize={nameFs}
        weight='black'
      />
      {character ? (
        <HudLine
          text={character.name}
          color={character.color}
          top={slot.label.top + Math.round(nameFs * 1.35)}
          left={slot.label.left}
          width={slot.label.width}
          fontSize={Math.round(22 * k)}
        />
      ) : null}

      {/* Character clip, framed by a panel in the finisher's color. */}
      <RetroPanel
        x={slot.clip.left}
        y={slot.clip.top}
        w={slot.clip.width}
        h={slot.clip.height}
        cut={panelCut}
        line={accent}
        glow={first ? 0.55 : 0.3}
        glowPx={Math.round((first ? 22 : 14) * k)}
        fill={RETRO.panelDark}
        fillA={0.92}
        scanline={0.35}
        scanPx={Math.max(3, Math.round(4 * k))}>
        {/* The clip is stacked ON TOP of the panel chrome, so its square
            corners would cover the 45° cuts — carve them out to match. */}
        {clipPlaying ? (
          <View
            style={{
              top: clipInset,
              left: clipInset,
              width: clipW,
              height: clipH,
              overflow: 'hidden',
            }}>
            <Shader
              shaderId='chamfer-clip'
              resolution={{ width: clipW, height: clipH }}
              shaderParam={{
                type: 'struct',
                value: [
                  {
                    type: 'f32',
                    fieldName: 'cut_px',
                    value: chamferClipCut(panelCut, clipInset),
                  },
                  { type: 'f32', fieldName: 'feather_px', value: 1.5 },
                ],
              }}>
              {/* Shader children must have a known size. */}
              <View style={{ width: clipW, height: clipH, overflow: 'hidden' }}>
                <CharacterClip
                  characterId={entry?.characterId}
                  width={clipW}
                  height={clipH}
                />
              </View>
            </Shader>
          </View>
        ) : null}
      </RetroPanel>

      {/* Pedestal: rank digit top-left, score across the face. */}
      <RetroPanel
        x={slot.pedestal.left}
        y={slot.pedestal.top}
        w={slot.pedestal.width}
        h={slot.pedestal.height}
        cut={Math.round(14 * k)}
        line={accent}
        glow={first ? 0.5 : 0.25}
        glowPx={Math.round((first ? 20 : 12) * k)}
        fill={RETRO.panel}
        fillA={0.94}
        scanline={0.5}
        scanPx={Math.max(3, Math.round(4 * k))}>
        <View
          style={{
            top: Math.round(8 * k),
            left: Math.round(12 * k),
            width: Math.round(rankFs * 1.6),
            height: Math.round(rankFs * 1.4),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: rankFs,
              color: first ? RETRO.yellow : RETRO.inkMuted,
              fontFamily: FONT,
              fontWeight: 'black',
            }}>
            {`${slot.place}`}
          </Text>
        </View>
        <ArcadeBigText
          text={entry ? `${entry.score}` : '—'}
          fontSize={scoreFs}
          color={first ? RETRO.yellow : RETRO.ink}
          top={Math.round((slot.pedestal.height - scoreFs * 1.4) / 2)}
          width={slot.pedestal.width}
        />
      </RetroPanel>
    </>
  );
}

/**
 * Full-frame GAME OVER scene burned into the output while the match sits in
 * 'ended' (until the host arms the lobby again): translucent blueprint
 * backdrop over the live video, a TOP 3 podium of character clips on ranked
 * pedestals, and the frozen FINAL SCORES / global TOP SCORES tables below —
 * the same retro-kit look as the browser results screen, drawn with the
 * retro-panel shader + Doto text. Mounted at the output root (like the KBT
 * chrome), so it survives any layout.
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
  const winnerCharacter = shooterCharacter(winner?.characterId);
  // Re-rendered on every publish (~30 Hz) — same blink pattern as MatchHud.
  const blinkOn = Date.now() % 700 < 400;

  const rowFs = Math.round(30 * k);
  const rowH = Math.round(rowFs * 1.9);
  const pad = layout.finals.pad;
  const listTop = Math.round(64 * k);
  // Both lists render in two sub-columns: the columns are wide but short now
  // that the podium owns the upper half, and splitting keeps every entry.
  const finalsPerCol = 4;
  const topsPerCol = 5;
  // Reserved once for the whole column so every row's score stays aligned.
  const dogStripW = match.finalScores.some((p) => (p.dogScore ?? 0) > 0)
    ? Math.round(rowFs * 2.6)
    : 0;

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
        fontSize={Math.round(84 * k)}
        color={RETRO.orangeBright}
        top={layout.headerTop}
        width={resolution.width}
      />
      <HudLine
        text={
          winner
            ? `★ ${winner.name} TAKES THE MARSH${winnerCharacter ? ` AS ${winnerCharacter.title.toUpperCase()}` : ''} ★`
            : '★ NOBODY BAGGED THE CROWN — DRAW ★'
        }
        color={winner ? winner.color : RETRO.inkMuted}
        top={layout.subTop}
        left={0}
        width={resolution.width}
        fontSize={Math.round(26 * k)}
      />

      {/* TOP 3 podium — character clips on ranked pedestals. */}
      {winner ? (
        layout.slots
          // A 2-player round leaves the third pedestal out entirely rather
          // than lighting an empty box next to the finishers.
          .filter((slot) => match.finalScores[slot.place - 1] != null)
          .map((slot) => (
            <PodiumPlace
              key={`podium-${slot.place}`}
              slot={slot}
              entry={match.finalScores[slot.place - 1]}
              k={k}
            />
          ))
      ) : (
        <View
          style={{
            top: layout.podium.top,
            left: layout.podium.left,
            width: layout.podium.width,
            height: layout.podium.height,
            overflow: 'hidden',
          }}>
          <ArcadeBigText
            text='DRAW'
            fontSize={Math.round(120 * k)}
            color={RETRO.inkMuted}
            top={Math.round(layout.podium.height / 2 - 84 * k)}
            width={layout.podium.width}
          />
        </View>
      )}

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
        {match.finalScores.slice(0, finalsPerCol * 2).map((p, i) => {
          const col = Math.floor(i / finalsPerCol);
          const left = layout.finals.subLefts[col];
          const width = layout.finals.subWidth;
          const top = listTop + (i % finalsPerCol) * rowH;
          const character = shooterCharacter(p.characterId);
          return (
            <View
              key={`final-${i}`}
              style={{ top, left, width, height: rowH, overflow: 'hidden' }}>
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
                  // The name yields the tally strip's width only when somebody
                  // actually bagged a dog, so a dogless round is laid out
                  // exactly as before.
                  width: width - Math.round(rowFs * 6.0) - dogStripW,
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
              {/* Dogs bagged, between the name and the score. */}
              <DogTally
                count={p.dogScore ?? 0}
                top={Math.round((rowH - rowFs * 0.9) / 2)}
                left={width - Math.round(rowFs * 3) - dogStripW}
                stripW={Math.max(0, dogStripW - Math.round(rowFs * 0.3))}
                iconH={Math.round(rowFs * 0.9)}
              />
              <View
                style={{
                  top: Math.round((rowH - rowFs * 1.4) / 2),
                  left: width - Math.round(rowFs * 3),
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
        {match.topScores.slice(0, topsPerCol * 2).map((e, i) => {
          const isNew =
            match.topScoreRank != null && i === match.topScoreRank - 1;
          const rowColor = isNew ? RETRO.yellow : RETRO.ink;
          const topRowH = Math.round(rowFs * 1.7);
          const col = Math.floor(i / topsPerCol);
          const left = layout.tops.subLefts[col];
          const width = layout.tops.subWidth;
          const top = listTop + (i % topsPerCol) * topRowH;
          // The freshly earned row blinks arcade-style.
          if (isNew && !blinkOn) return null;
          return (
            <View
              key={`top-${i}`}
              style={{ top, left, width, height: topRowH, overflow: 'hidden' }}>
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
                  left: width - Math.round(rowFs * 4.4),
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
                  left: width - Math.round(rowFs * 1.2),
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
