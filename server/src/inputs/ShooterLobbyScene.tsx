import React from 'react';
import { View } from '@swmansion/smelter';
import type { ShooterOverlay } from '../app/store';
import { ArcadeBigText, RETRO, RetroPanel } from './RetroPanel';
import { HudLine, HunterTile, shooterCharacter } from './ShooterCharacterClip';
import { hudScale, lineupLayout } from './retroHudLayout';

/** Lobby caps the roster at 6, and 6 tiles is also what fits the row. */
const MAX_TILES = 6;

/** `M:SS` from ms — same shape as the in-tile match chip. */
function formatClock(ms: number | null): string {
  if (ms == null) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Full-frame HUNTERS READY scene: the roster of joined players as square
 * avatar tiles — a player's live phone camera when they share one, their
 * character clip cropped to the square when they don't — over the same
 * blueprint backdrop as the results scene.
 *
 * On air while the host holds the arcade lobby and through the 3-2-1, so the
 * countdown itself is drawn here; the in-tile MatchHud skips its countdown
 * beat because this scene sits above every layer and would bury it.
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
  const k = hudScale(resolution);
  const players = shooter.scores.slice(0, MAX_TILES);
  const layout = lineupLayout(resolution, players.length || 1);
  const now = Date.now();

  // Same label the in-tile chip shows (endsAt is only set once play begins, so
  // in the countdown the time-attack length is simply left off).
  const modeLabel = !match
    ? 'WAITING FOR THE HOST'
    : match.mode === 'time'
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
        fillA={countdown ? 0.78 : 0.87}
        grid={1}
        gridPx={Math.round(39 * k)}
        scanline={0.6}
        scanPx={Math.max(3, Math.round(4 * k))}
      />

      <ArcadeBigText
        text={countdown ? 'GET READY' : 'HUNTERS READY'}
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

      {/* The 3-2-1 beat lives here: the lineup covers the in-tile MatchHud. */}
      {countdown && match ? (
        <ArcadeBigText
          text={`${Math.max(1, Math.ceil(Math.max(0, match.startsAt - now) / 1000))}`}
          fontSize={layout.countdownFs}
          color={RETRO.yellow}
          top={layout.countdownTop}
          width={resolution.width}
        />
      ) : (
        <HudLine
          text='AIM WITH YOUR PHONE — TAP TO SHOOT'
          color={RETRO.inkMuted}
          top={layout.footerTop}
          left={0}
          width={resolution.width}
          fontSize={Math.round(26 * k)}
        />
      )}
    </View>
  );
}
