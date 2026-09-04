import React from 'react';
import { Image, Rescaler, View } from '@swmansion/smelter';
import { MAX_SHOOTER_PLAYERS } from '@smelter-editor/types';
import type { ShooterLobbyOverlay, ShooterOverlay } from '../app/store';
import { ArcadeBigText, RETRO, RetroPanel } from './RetroPanel';
import { HudLine, HunterTile, shooterCharacter } from './ShooterCharacterClip';
import {
  hudScale,
  lineupLayout,
  openingLayout,
  type OpeningColumn,
  type Rect,
} from './retroHudLayout';

/**
 * One tile per hunter. The server refuses a fourth join, so this only ever
 * clamps a roster that arrived from an older/mismatched server.
 */
const MAX_TILES = MAX_SHOOTER_PLAYERS;

/**
 * The briefing, in the order a newcomer needs it. Static: none of it depends
 * on room state, and the room has to be able to learn the game off the screen
 * alone (the host page is not on air).
 */
const HOW_TO_PLAY = [
  'SCAN THE CODE — YOUR PHONE IS THE GUN',
  'PICK YOUR HUNTER ON THE PHONE',
  'TILT TO AIM · TAP TO SHOOT',
  'RELOAD IS AUTOMATIC — WATCH YOUR PIPS',
] as const;

/** `M:SS` from ms — same shape as the in-tile match chip. */
function formatClock(ms: number | null): string {
  if (ms == null) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** RetroPanel takes x/y/w/h; the layout speaks in Rects. */
function panelBox(rect: Rect): { x: number; y: number; w: number; h: number } {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** The round the host staged, or the honest truth that they haven't yet. */
function roundLabel(setup: ShooterLobbyOverlay['setup']): string {
  if (!setup) return 'WAITING FOR THE HOST';
  return setup.mode === 'time'
    ? `TIME ATTACK · ${formatClock(setup.durationMs)}`
    : `SCORE RUSH · FIRST TO ${setup.targetScore ?? '?'}`;
}

/** Shared chrome for the three opening-screen columns. */
function OpeningPanel({
  column,
  accent,
  title,
  k,
  children,
}: {
  column: OpeningColumn;
  accent: string;
  title: string;
  k: number;
  children?: React.ReactNode;
}) {
  return (
    <RetroPanel
      {...panelBox(column)}
      cut={Math.round(14 * k)}
      line={accent}
      glow={0.3}
      glowPx={Math.round(14 * k)}
      fillA={0.9}
      scanline={0.4}
      scanPx={Math.max(3, Math.round(4 * k))}>
      <HudLine
        text={title}
        color={accent}
        top={column.titleTop}
        left={0}
        width={column.width}
        fontSize={Math.round(24 * k)}
        weight='black'
      />
      {children}
    </RetroPanel>
  );
}

/**
 * Full-frame duck-hunter opening screen, on air while the host holds the
 * arcade lobby: the game's title card, how to join (QR + address), how to
 * play, the staged round, the hall of fame, and the hunters who already joined
 * as live camera tiles.
 *
 * The same component still owns the 3-2-1 beat, but as a separate lineup
 * branch — the countdown wants the roster big and nothing else, and this scene
 * sits above every layer, so the in-tile MatchHud skips its countdown.
 */
export function ShooterLobbyScene({
  shooter,
  resolution,
}: {
  shooter: ShooterOverlay;
  resolution: { width: number; height: number };
}) {
  const match = shooter.match;
  const countdown = match?.phase === 'countdown';
  if (!countdown && !(shooter.lobbyArmed && !match)) return null;
  const players = shooter.scores.slice(0, MAX_TILES);
  return countdown && match ? (
    <CountdownLineup players={players} match={match} resolution={resolution} />
  ) : (
    <OpeningScreen
      players={players}
      lobby={shooter.lobby ?? null}
      resolution={resolution}
    />
  );
}

function OpeningScreen({
  players,
  lobby,
  resolution,
}: {
  players: ShooterOverlay['scores'];
  lobby: ShooterLobbyOverlay | null;
  resolution: { width: number; height: number };
}) {
  const label = roundLabel(lobby?.setup ?? null);
  const L = openingLayout(resolution, players.length || 1, label);
  const k = L.k;
  const topScores = (lobby?.topScores ?? []).slice(0, L.tops.rows);
  // Tables are per round variant, so the caption names the exact variant
  // (mode + length/target) this table belongs to.
  const modeCaption = lobby?.setup ? roundLabel(lobby.setup) : 'ALL TIME';

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'hidden',
      }}>
      {/* Blueprint backdrop over the live stage, same as the results scene. */}
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

      {/* Title card — mirrors the editor arcade's TITLE screen. */}
      <HudLine
        text='EST. 1984 · SMELTER ARCADE'
        color={RETRO.inkMuted}
        top={L.eyebrowTop}
        left={0}
        width={resolution.width}
        fontSize={L.eyebrowFs}
      />
      <ArcadeBigText
        text='DUCK HUNTER'
        fontSize={L.titleFs}
        color={RETRO.orangeBright}
        top={L.titleTop}
        width={resolution.width}
      />
      <HudLine
        text='★ PHONES ARE GUNS · TV IS THE MARSH ★'
        color={RETRO.cyan}
        top={L.starTop}
        left={0}
        width={resolution.width}
        fontSize={L.starFs}
      />

      {/* The staged round: the single line the room most needs. */}
      <RetroPanel
        {...panelBox(L.banner)}
        cut={Math.round(16 * k)}
        line={RETRO.orangeBright}
        glow={0.35}
        glowPx={Math.round(16 * k)}
        fillA={0.92}>
        <HudLine
          text={label}
          color={lobby?.setup ? RETRO.yellow : RETRO.inkMuted}
          top={Math.round((L.banner.height - L.banner.fontSize * 1.45) / 2)}
          left={0}
          width={L.banner.width}
          fontSize={L.banner.fontSize}
          weight='black'
        />
      </RetroPanel>

      {/* JOIN: the QR is the only way into the game, so it leads. */}
      <OpeningPanel
        column={L.join}
        accent={RETRO.cyan}
        title='JOIN WITH YOUR PHONE'
        k={k}>
        {lobby?.qrImageId ? (
          <View
            style={{
              top: L.join.qr.top,
              left: L.join.qr.left,
              width: L.join.qr.width,
              height: L.join.qr.height,
              overflow: 'hidden',
            }}>
            <Rescaler
              style={{
                width: L.join.qr.width,
                height: L.join.qr.height,
                rescaleMode: 'fit',
              }}>
              <Image imageId={lobby.qrImageId} />
            </Rescaler>
          </View>
        ) : (
          // Only the host page knows the public base, so the QR arrives a
          // beat late (or never, on a room opened without one).
          <HudLine
            text='PREPARING THE LINK…'
            color={RETRO.inkMuted}
            top={L.join.qr.top + Math.round(L.join.qr.height / 2)}
            left={0}
            width={L.join.width}
            fontSize={Math.round(20 * k)}
          />
        )}
        {lobby?.joinLabel ? (
          <HudLine
            text={lobby.joinLabel}
            color={RETRO.ink}
            top={L.join.labelTop}
            left={0}
            width={L.join.width}
            fontSize={Math.round(22 * k)}
            weight='black'
          />
        ) : null}
        <HudLine
          text='SCAN TO JOIN'
          color={RETRO.inkMuted}
          top={L.join.hintTop}
          left={0}
          width={L.join.width}
          fontSize={Math.round(18 * k)}
        />
      </OpeningPanel>

      <OpeningPanel
        column={L.howTo}
        accent={RETRO.lineBright}
        title='HOW TO PLAY'
        k={k}>
        {HOW_TO_PLAY.map((line, i) => {
          const top = L.howTo.rowTop + i * L.howTo.rowH;
          const numW = Math.round(44 * k);
          const textLeft = L.howTo.pad + Math.round(60 * k);
          return (
            <React.Fragment key={`how-${i}`}>
              <HudLine
                text={`${i + 1}`}
                color={RETRO.orangeBright}
                top={top}
                left={L.howTo.pad}
                width={numW}
                fontSize={Math.round(28 * k)}
                weight='black'
              />
              <HudLine
                text={line}
                color={RETRO.ink}
                top={top}
                left={textLeft}
                width={L.howTo.width - textLeft - L.howTo.pad}
                fontSize={Math.round(28 * k)}
                align='left'
              />
            </React.Fragment>
          );
        })}
      </OpeningPanel>

      <OpeningPanel
        column={L.tops}
        accent={RETRO.orangeBright}
        title='TOP SCORES'
        k={k}>
        <HudLine
          text={modeCaption}
          color={RETRO.inkMuted}
          top={Math.round(58 * k)}
          left={0}
          width={L.tops.width}
          fontSize={Math.round(18 * k)}
        />
        {topScores.length === 0 ? (
          <HudLine
            text='THE TABLE IS EMPTY — MAKE HISTORY.'
            color={RETRO.inkMuted}
            top={L.tops.rowTop + L.tops.rowH}
            left={L.tops.pad}
            width={L.tops.width - L.tops.pad * 2}
            fontSize={Math.round(20 * k)}
          />
        ) : (
          topScores.map((e, i) => {
            const top = L.tops.rowTop + i * L.tops.rowH;
            const fs = Math.round(26 * k);
            const rankW = Math.round(36 * k);
            const initialsLeft = L.tops.pad + Math.round(46 * k);
            const scoreW = Math.round(130 * k);
            return (
              <React.Fragment key={`top-${i}`}>
                <HudLine
                  text={`${i + 1}`}
                  color={RETRO.inkMuted}
                  top={top}
                  left={L.tops.pad}
                  width={rankW}
                  fontSize={fs}
                  align='left'
                />
                <HudLine
                  text={e.initials}
                  color={RETRO.cyan}
                  top={top}
                  left={initialsLeft}
                  width={Math.round(130 * k)}
                  fontSize={fs}
                  weight='black'
                  align='left'
                />
                <HudLine
                  text={`${e.score}`}
                  color={RETRO.ink}
                  top={top}
                  left={L.tops.width - L.tops.pad - scoreW}
                  width={scoreW}
                  fontSize={fs}
                  weight='black'
                  align='right'
                />
              </React.Fragment>
            );
          })
        )}
      </OpeningPanel>

      {/* Hunters already in, with their live phone cameras. */}
      {players.map((p, i) => {
        const left = L.rowLeft + i * (L.tileSize + L.gap);
        const character = shooterCharacter(p.characterId);
        return (
          <React.Fragment key={`hunter-${p.clientId}`}>
            <HunterTile
              camInputId={p.camInputId}
              camLive={p.camLive}
              characterId={p.characterId}
              color={p.color}
              size={L.tileSize}
              top={L.rowTop}
              left={left}
            />
            <HudLine
              text={p.name}
              color={p.color}
              top={L.nameTop}
              left={left}
              width={L.tileSize}
              fontSize={L.nameFs}
              weight='black'
            />
            <HudLine
              text={character ? character.name : 'NO HUNTER PICKED'}
              color={character ? character.color : RETRO.inkMuted}
              top={L.captionTop}
              left={left}
              width={L.tileSize}
              fontSize={L.captionFs}
            />
          </React.Fragment>
        );
      })}

      {players.length === 0 ? (
        <HudLine
          text='WAITING FOR HUNTERS…'
          color={RETRO.inkMuted}
          top={L.rowTop + Math.round(L.tileSize / 2)}
          left={0}
          width={resolution.width}
          fontSize={Math.round(40 * k)}
          weight='black'
        />
      ) : null}

      <HudLine
        text='AIM WITH YOUR PHONE — TAP TO SHOOT'
        color={RETRO.inkMuted}
        top={L.footerTop}
        left={0}
        width={resolution.width}
        fontSize={L.footerFs}
      />
    </View>
  );
}

/**
 * The 3-2-1 beat: the roster blown up big with the countdown digit under it.
 * Deliberately not the opening screen — nobody reads a QR or the rules in the
 * three seconds before the round starts.
 */
function CountdownLineup({
  players,
  match,
  resolution,
}: {
  players: ShooterOverlay['scores'];
  match: NonNullable<ShooterOverlay['match']>;
  resolution: { width: number; height: number };
}) {
  const k = hudScale(resolution);
  const layout = lineupLayout(resolution, players.length || 1);
  const now = Date.now();
  // endsAt is only set once play begins, so during the countdown the
  // time-attack length is simply left off.
  const modeLabel =
    match.mode === 'time'
      ? `TIME ATTACK ${formatClock(match.endsAt != null ? match.endsAt - match.startsAt : null)}`.trim()
      : `FIRST TO ${match.targetScore ?? '?'}`;

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'hidden',
      }}>
      <RetroPanel
        x={0}
        y={0}
        w={resolution.width}
        h={resolution.height}
        cut={0}
        linePx={0}
        gapPx={0}
        fill={RETRO.bgDeep}
        fillA={0.78}
        grid={1}
        gridPx={Math.round(39 * k)}
        scanline={0.6}
        scanPx={Math.max(3, Math.round(4 * k))}
      />

      <ArcadeBigText
        text='GET READY'
        fontSize={Math.round(84 * k)}
        color={RETRO.orangeBright}
        top={layout.headerTop}
        width={resolution.width}
      />
      <HudLine
        text={modeLabel}
        color={RETRO.cyan}
        top={layout.subTop}
        left={0}
        width={resolution.width}
        fontSize={Math.round(30 * k)}
      />
      {/* Mirrors the phone's countdown instruction: phones recenter on GO, so
          wherever the hunter is physically aiming right now becomes center. */}
      <HudLine
        text='AIM AT SCREEN CENTER'
        color={RETRO.yellow}
        top={layout.subTop + Math.round(48 * k)}
        left={0}
        width={resolution.width}
        fontSize={Math.round(34 * k)}
        weight='black'
      />

      {players.map((p, i) => {
        const left = layout.rowLeft + i * (layout.tileSize + layout.gap);
        const character = shooterCharacter(p.characterId);
        return (
          <React.Fragment key={`hunter-${p.clientId}`}>
            <HunterTile
              camInputId={p.camInputId}
              camLive={p.camLive}
              characterId={p.characterId}
              color={p.color}
              size={layout.tileSize}
              top={layout.rowTop}
              left={left}
            />
            <HudLine
              text={p.name}
              color={p.color}
              top={layout.nameTop}
              left={left}
              width={layout.tileSize}
              fontSize={Math.round(32 * k)}
              weight='black'
            />
            <HudLine
              text={character ? character.name : 'NO HUNTER PICKED'}
              color={character ? character.color : RETRO.inkMuted}
              top={layout.titleTop}
              left={left}
              width={layout.tileSize}
              fontSize={Math.round(22 * k)}
            />
          </React.Fragment>
        );
      })}

      {players.length === 0 ? (
        <HudLine
          text='WAITING FOR HUNTERS…'
          color={RETRO.inkMuted}
          top={layout.rowTop + Math.round(layout.tileSize / 2)}
          left={0}
          width={resolution.width}
          fontSize={Math.round(40 * k)}
          weight='black'
        />
      ) : null}

      <ArcadeBigText
        text={`${Math.max(1, Math.ceil(Math.max(0, match.startsAt - now) / 1000))}`}
        fontSize={layout.countdownFs}
        color={RETRO.yellow}
        top={layout.countdownTop}
        width={resolution.width}
      />
    </View>
  );
}
