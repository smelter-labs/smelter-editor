'use client';

import React, { useEffect, useState } from 'react';
import type {
  KbtMatchAction,
  KbtMatchEvent,
  KbtStateEvent,
} from '@smelter-editor/types';
import { KBT, KbtButton, Label, Num, Plate, PlateTitle } from '../kbt-kit';
import { ScoreChip } from '../score-chip';

/**
 * The SHOW plate: one phase-appropriate primary action, mirroring the host
 * arcade's flow (roster-screen / heat-screen / results-screen), plus the
 * live clock and score chips while a heat runs. Danger actions (STOP HEAT /
 * RESET) live in the DangerZone, not here.
 */
export function ShowControl({
  state,
  match,
  sendMatch,
}: {
  state: KbtStateEvent | null;
  match: KbtMatchEvent | null;
  sendMatch: (action: KbtMatchAction, heatIndex?: number) => void;
}) {
  // 4 Hz chrome clock anchored on the authoritative match timestamps.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);

  const phase = state?.tournamentPhase ?? 'roster';
  const players = state?.players ?? [];
  const heats = state?.heats ?? [];
  const heatsDrawn = heats.length > 0;
  const nextIdle = heats.find((h) => h.phase === 'idle');
  const heatPhase = match?.heatIndex != null ? match.phase : 'idle';
  const heatLive =
    heatPhase === 'intro' ||
    heatPhase === 'countdown' ||
    heatPhase === 'playing';
  const finalPlayed = heats.some((h) => h.final && h.phase === 'ended');
  const heatLabel = match?.final
    ? 'FINAL'
    : match?.heatIndex != null
      ? `HEAT ${match.heatIndex + 1}`
      : 'HEAT';

  // Mirrors the server's begin_heat gate: briefing reached + live camera.
  const heat = match?.heatIndex != null ? heats[match.heatIndex] : null;
  const heatPlayers = (heat?.playerIds ?? []).map(
    (id) => players.find((p) => p.clientId === id) ?? null,
  );
  const allReady =
    heatPlayers.length > 0 &&
    heatPlayers.every((p) => p?.briefed && p?.camConnected);
  const waitingNames = heatPlayers
    .filter((p) => !p || !p.briefed || !p.camConnected)
    .map((p) => p?.name ?? '?');

  const now = Date.now();
  let clockLabel = '';
  let clockColor: string = KBT.cream;
  let urgent = false;
  if (heatPhase === 'countdown') {
    const left = Math.max(0, (match?.startsAtMs ?? now) - now);
    clockLabel = `GET SET ${Math.max(1, Math.ceil(left / 1000))}`;
    clockColor = KBT.good;
  } else if (heatPhase === 'playing') {
    const left = Math.max(0, (match?.endsAtMs ?? now) - now);
    const total = Math.round(left / 1000);
    clockLabel = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    clockColor = KBT.good;
    if (left <= 10_000) {
      clockColor = KBT.bad;
      urgent = true;
    }
  } else if (heatPhase === 'ended') {
    clockLabel = 'TIME!';
    clockColor = KBT.bad;
  }

  // The one thing to press next (the non-technical throughline).
  let primary: {
    label: string;
    sub: string;
    enabled: boolean;
    hint?: string;
    run: () => void;
  } | null = null;
  if (phase === 'podium') {
    primary = {
      label: 'BACK TO REGISTRATION',
      sub: 'open the roster again',
      enabled: true,
      run: () => sendMatch('roster'),
    };
  } else if (heatLive) {
    if (heatPhase === 'intro') {
      primary = {
        label: 'BEGIN THE HEAT',
        sub: 'starts the countdown',
        enabled: allReady,
        hint: allReady
          ? undefined
          : `WAITING FOR ${waitingNames.join(', ') || 'LIFTERS'}`,
        run: () => sendMatch('begin_heat'),
      };
    }
    // countdown/playing: nothing to press — the clock runs the show.
  } else if (phase === 'roster' && !heatsDrawn) {
    primary = {
      label: 'DRAW HEATS',
      sub: 'splits the roster into heats',
      enabled: players.length >= 1,
      hint: players.length >= 1 ? undefined : 'WAITING FOR LIFTERS',
      run: () => sendMatch('assign_heats'),
    };
  } else if (nextIdle && heatPhase !== 'ended') {
    primary = {
      label: `STAGE ${nextIdle.final ? 'THE FINAL' : `HEAT ${nextIdle.index + 1}`}`,
      sub: 'lifters to the platform',
      enabled: true,
      run: () => sendMatch('start_heat', nextIdle.index),
    };
  } else if (heatPhase === 'ended') {
    if (nextIdle) {
      primary = {
        label: 'NEXT HEAT',
        sub: `stage heat ${nextIdle.index + 1}`,
        enabled: true,
        run: () => {
          // next_heat points currentHeatIndex at the first idle heat;
          // start_heat with no index stages exactly that one.
          sendMatch('next_heat');
          sendMatch('start_heat');
        },
      };
    } else if (!match?.final && players.length >= 2) {
      primary = {
        label: 'START THE FINAL',
        sub: 'top lifters re-run',
        enabled: true,
        run: () => {
          sendMatch('start_final');
          sendMatch('start_heat');
        },
      };
    } else {
      primary = {
        label: 'TO THE PODIUM',
        sub: 'final results on air',
        enabled: true,
        run: () => sendMatch('podium'),
      };
    }
  } else if (!heatsDrawn) {
    primary = {
      label: 'DRAW HEATS',
      sub: 'splits the roster into heats',
      enabled: players.length >= 1,
      run: () => sendMatch('assign_heats'),
    };
  } else {
    primary = {
      label: 'TO THE PODIUM',
      sub: 'final results on air',
      enabled: true,
      run: () => sendMatch('podium'),
    };
  }

  const rows = Object.entries(match?.scores ?? {})
    .map(([clientId, s]) => ({ clientId, ...s }))
    .sort((a, b) => b.points - a.points);

  const phaseLine =
    phase === 'roster'
      ? `REGISTRATION OPEN — ${players.length} LIFTER${players.length === 1 ? '' : 'S'}`
      : phase === 'podium'
        ? 'PODIUM ON AIR'
        : heatLive || heatPhase === 'ended'
          ? `${heatLabel} — ${heatPhase.toUpperCase()}`
          : `${phase === 'final' ? 'FINAL' : 'HEATS'} — STANDINGS ON AIR`;

  return (
    <Plate
      cutPx={18}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '14px 18px',
      }}>
      <PlateTitle
        right={
          clockLabel ? (
            <Num size={22} color={clockColor}>
              <span className={urgent ? 'kbt-blink' : undefined}>
                {clockLabel}
              </span>
            </Num>
          ) : null
        }>
        SHOW
      </PlateTitle>
      <Label size={10} tracking={1.5}>
        {phaseLine}
      </Label>
      {rows.length > 0 && (heatLive || heatPhase === 'ended') ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {rows.map((r) => (
            <ScoreChip
              key={r.clientId}
              name={r.name}
              color={r.color}
              photoUrl={r.photoUrl}
              points={r.points}
            />
          ))}
        </div>
      ) : null}
      {primary ? (
        <>
          <KbtButton
            label={primary.label}
            sub={primary.sub}
            active={primary.enabled}
            disabled={!primary.enabled}
            block
            onClick={primary.run}
          />
          {primary.hint ? (
            <Label size={10} tracking={1.5} style={{ textAlign: 'center' }}>
              <span className='kbt-blink'>{primary.hint}</span>
            </Label>
          ) : null}
        </>
      ) : (
        <Label size={10} tracking={1.5} style={{ textAlign: 'center' }}>
          HEAT RUNNING — the clock does the work
        </Label>
      )}
      <Label
        size={9}
        tracking={1}
        color={KBT.dim}
        style={{ textAlign: 'center' }}>
        show actions return the view to AUTO
      </Label>
    </Plate>
  );
}
