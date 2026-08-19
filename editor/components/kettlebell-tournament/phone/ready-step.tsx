'use client';

import React from 'react';
import type { KbtPlayer, KbtStateEvent } from '@smelter-editor/types';
import {
  PixelPanel,
  R5,
  StarLine,
  ledFont,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';

function Row({
  left,
  right,
  color,
  dim,
}: {
  left: string;
  right: string;
  color?: string;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        fontFamily: monoFont,
        fontSize: 12,
        color: dim ? R5.inkMuted : R5.ink,
      }}>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        <span style={{ color: color ?? R5.ink }}>■ </span>
        {left}
      </span>
      <span style={{ fontFamily: ledFont, fontWeight: 700 }}>{right}</span>
    </div>
  );
}

/**
 * Step 4 — standing by between heats: your heat assignment, the live pose
 * check while your heat is staged, and the tournament standings. The page
 * flips to the live HUD on its own when your heat starts counting.
 */
export function ReadyStep({
  state,
  myClientId,
  myName,
  poseTracked,
  inMyIntro,
}: {
  state: KbtStateEvent | null;
  myClientId: string | null;
  myName: string;
  poseTracked: boolean;
  /** My heat is staged (intro) — show the framing check prominently. */
  inMyIntro: boolean;
}) {
  const players = state?.players ?? [];
  const me =
    (myClientId && players.find((p) => p.clientId === myClientId)) ||
    players.find((p) => p.name === myName.trim()) ||
    null;
  const myHeat =
    me?.heatIndex != null && state ? state.heats[me.heatIndex] : null;
  const heatMates = myHeat
    ? myHeat.playerIds
        .map((id) => players.find((p) => p.clientId === id))
        .filter((p): p is KbtPlayer => !!p)
    : [];
  const standings = [...players].sort(
    (a, b) =>
      (b.finalScore ?? -1) - (a.finalScore ?? -1) || b.bestScore - a.bestScore,
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      {inMyIntro ? (
        <PixelPanel
          accent={poseTracked ? 'green' : 'orange'}
          cut={10}
          glow={0.6}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '14px 16px',
          }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 13,
              letterSpacing: 1.5,
              color: poseTracked ? R5.green : R5.orangeBright,
            }}
            className={poseTracked ? undefined : 'r5-blink'}>
            {poseTracked ? 'POSE LOCKED ✓' : 'STEP INTO FRAME'}
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
            {poseTracked
              ? 'The AI sees you. Grab the bell and await the countdown.'
              : 'Stand back until your whole body is tracked on your tile.'}
          </span>
        </PixelPanel>
      ) : (
        <PixelPanel
          accent='yellow'
          cut={10}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '14px 16px',
          }}>
          <span
            className='r5-blink'
            style={{
              fontFamily: pixelFont,
              fontSize: 13,
              letterSpacing: 2,
              color: R5.yellow,
            }}>
            STANDING BY…
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
            {myHeat
              ? `You lift in ${myHeat.final ? 'the FINAL' : `HEAT ${myHeat.index + 1}`}. Keep the phone propped and awake.`
              : 'Waiting for the host to draw the heats.'}
          </span>
        </PixelPanel>
      )}

      {heatMates.length > 0 ? (
        <PixelPanel
          accent='cyan'
          cut={10}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
          }}>
          <StarLine size={8}>
            {myHeat?.final ? 'FINAL LINE-UP' : `HEAT ${myHeat!.index + 1} LINE-UP`}
          </StarLine>
          {heatMates.map((p) => (
            <Row
              key={p.clientId}
              left={p.name + (p.clientId === me?.clientId ? ' (YOU)' : '')}
              right={p.camConnected ? 'CAM ✓' : 'NO CAM'}
              color={p.color}
              dim={!p.camConnected}
            />
          ))}
        </PixelPanel>
      ) : null}

      {standings.some((p) => p.bestScore > 0 || p.finalScore != null) ? (
        <PixelPanel
          accent='pink'
          cut={10}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
          }}>
          <StarLine size={8}>STANDINGS</StarLine>
          {standings.slice(0, 8).map((p, i) => (
            <Row
              key={p.clientId}
              left={`${i + 1}. ${p.name}`}
              right={`${p.finalScore ?? p.bestScore}`}
              color={p.color}
              dim={p.bestScore === 0 && p.finalScore == null}
            />
          ))}
        </PixelPanel>
      ) : null}
    </div>
  );
}
