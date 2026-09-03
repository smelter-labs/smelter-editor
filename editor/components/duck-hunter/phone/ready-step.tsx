'use client';

import React from 'react';
import type { ShooterMatchEvent } from '@smelter-editor/types';
import { LedText, PixelPanel, R5, monoFont, pixelFont } from '../retro-kit';
import { ActionButton } from './phone-shell';

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
      }}>
      <span
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 11,
          letterSpacing: 1,
          color: color ?? R5.ink,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Step 4 — mission briefing: your loadout plus the live room status (the
 * server broadcasts shooter_state / shooter_match to every socket, so the
 * phone knows the marsh is warm before joining). JOIN THE HUNT commits.
 */
export function ReadyStep({
  name,
  gyroMode,
  camOn,
  targetActive,
  playersCount,
  maxPlayers,
  lobbyFull,
  characterName,
  match,
  joined,
  canEnter,
  onJoin,
  onBack,
}: {
  name: string;
  gyroMode: boolean;
  camOn: boolean;
  targetActive: boolean;
  playersCount: number;
  /** Roster cap, shown beside the count so "3/3" explains a refused JOIN. */
  maxPlayers: number;
  /** Every slot is held by someone else — JOIN would be refused. */
  lobbyFull: boolean;
  /** The hunter this phone picked, or null if the pick was lost/taken. */
  characterName: string | null;
  match: ShooterMatchEvent | null;
  /** The player pressed JOIN but the host hasn't opened the gate yet. */
  joined: boolean;
  /** Whether JOIN would enter the game right now (round live / open range). */
  canEnter: boolean;
  onJoin: () => void;
  onBack: () => void;
}) {
  const phase = match?.phase ?? 'idle';
  const matchLine =
    phase === 'countdown' || phase === 'playing'
      ? 'ROUND IN PROGRESS — JUMP IN'
      : phase === 'ended'
        ? 'ROUND OVER — NEXT ONE SOON'
        : phase === 'lobby'
          ? 'HOST IS PREPPING THE ROUND'
          : targetActive
            ? 'OPEN RANGE — DIVE IN'
            : 'WAITING FOR THE HOST';

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 16,
      }}>
      <PixelPanel
        cut={10}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '18px 16px',
        }}>
        <span
          style={{
            fontFamily: pixelFont,
            fontSize: 9,
            letterSpacing: 2,
            color: R5.cyan,
          }}>
          MISSION BRIEFING
        </span>
        <Row
          label='call sign'
          value={name.trim().toUpperCase() || 'HUNTER'}
          color={R5.yellow}
        />
        <Row
          label='hunter'
          value={characterName ?? 'NOT PICKED'}
          color={characterName ? undefined : R5.red}
        />
        <Row
          label='weapon'
          value={gyroMode ? 'GYRO CANNON' : 'FINGER BLASTER'}
        />
        <Row label='camera' value={camOn ? 'ON AIR' : 'OFF'} />
        <Row
          label='the marsh'
          value={targetActive ? 'LIVE' : 'WARMING UP…'}
          color={targetActive ? R5.green : R5.orange}
        />
        <Row
          label='hunters in'
          value={`${playersCount}/${maxPlayers}`}
          color={lobbyFull ? R5.red : undefined}
        />
      </PixelPanel>

      <div style={{ textAlign: 'center' }}>
        <span
          className={
            phase === 'idle' || phase === 'lobby' ? 'r5-blink' : undefined
          }
          style={{
            fontFamily: pixelFont,
            fontSize: 10,
            letterSpacing: 1,
            color:
              phase === 'countdown' || phase === 'playing'
                ? R5.green
                : R5.inkMuted,
          }}>
          {matchLine}
        </span>
      </div>

      {joined && !canEnter ? (
        <ActionButton
          accent='yellow'
          disabled
          label={
            phase === 'ended' ? 'ROUND OVER — STANDING BY' : 'STANDING BY…'
          }
          sub="you're in — the hunt starts when the host does"
        />
      ) : !characterName ? (
        // A slot is a hunter, so there is nothing to join without one. Both
        // this and the full-lobby case below only pre-empt a refusal the
        // server would send anyway.
        <ActionButton
          accent='red'
          disabled
          label='PICK YOUR HUNTER'
          sub='go back and choose a character first'
        />
      ) : lobbyFull ? (
        <ActionButton
          accent='red'
          disabled
          label='LOBBY FULL'
          sub={`${maxPlayers} hunters are already in — wait for a slot`}
        />
      ) : (
        <ActionButton
          accent='green'
          label={
            phase === 'countdown' || phase === 'playing'
              ? 'JUMP IN'
              : 'JOIN THE HUNT'
          }
          active
          onClick={onJoin}
        />
      )}
      <button
        type='button'
        className='r5-btn'
        onClick={onBack}
        style={{
          fontFamily: pixelFont,
          fontSize: 9,
          letterSpacing: 1,
          color: R5.inkMuted,
          textAlign: 'center',
          padding: 6,
        }}>
        ◀ CHANGE HUNTER
      </button>
      {!targetActive ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <LedText size={14} color={R5.orange} glowRgb={R5.orangeRgb}>
            DUCKS INBOUND…
          </LedText>
        </div>
      ) : null}
    </div>
  );
}
