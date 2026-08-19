'use client';

import React from 'react';
import type { KbtScoreBreakdown } from '@smelter-editor/types';
import {
  LedText,
  PanelTitle,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import type { KbtFeed } from '../use-kbt-feed';

function ScoreRow({
  rank,
  sheet,
  winner,
}: {
  rank: number;
  sheet: KbtScoreBreakdown;
  winner: boolean;
}) {
  return (
    <PixelPanel
      accent={winner ? 'yellow' : 'blue'}
      cut={10}
      glow={winner ? 0.5 : 0.15}
      innerStyle={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 18px',
      }}>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 15,
          color: winner ? R5.yellow : R5.inkMuted,
          width: 34,
        }}>
        {winner ? '★' : `${rank}.`}
      </span>
      <span style={{ color: sheet.color, fontSize: 18 }}>■</span>
      <span
        style={{
          flex: 1,
          fontFamily: pixelFont,
          fontSize: 14,
          letterSpacing: 1,
          color: R5.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {sheet.name}
      </span>
      <span style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
        {`SW ${sheet.reps.swing} · CL ${sheet.reps.clean} · SN ${sheet.reps.snatch}`}
        {sheet.incorrectReps > 0 ? ` · ✕${sheet.incorrectReps}` : ''}
        {sheet.bestStreak >= 5 ? ` · x${sheet.bestStreak}` : ''}
      </span>
      <LedText size={30} color={winner ? R5.yellow : R5.ink}>
        {sheet.points}
      </LedText>
    </PixelPanel>
  );
}

/**
 * After the buzzer: this heat's board, the tournament standings so far, and
 * where to go next — the next idle heat, the final (once every heat ran), or
 * the podium.
 */
export function ResultsScreen({
  feed,
  onNextHeat,
  onStartFinal,
  onPodium,
}: {
  feed: KbtFeed;
  onNextHeat: () => void;
  onStartFinal: () => void;
  onPodium: () => void;
}) {
  const match = feed.match;
  const state = feed.state;
  const heatLabel = match?.final
    ? 'FINAL'
    : match?.heatIndex != null
      ? `HEAT ${match.heatIndex + 1}`
      : 'HEAT';
  const rows = Object.values(match?.scores ?? {}).sort(
    (a, b) => b.points - a.points,
  );
  const winnerName = match?.winner?.name ?? null;

  const heats = state?.heats ?? [];
  const hasNextHeat = heats.some((h) => h.phase === 'idle');
  const qualificationDone =
    heats.length > 0 &&
    heats.filter((h) => !h.final).every((h) => h.phase === 'ended');
  const finalRan = heats.some((h) => h.final && h.phase === 'ended');
  const canFinal =
    qualificationDone &&
    !finalRan &&
    !match?.final &&
    (state?.players.filter((p) => p.bestScore > 0).length ?? 0) >= 2;

  const standings = [...(state?.players ?? [])].sort(
    (a, b) =>
      (b.finalScore ?? -1) - (a.finalScore ?? -1) || b.bestScore - a.bestScore,
  );

  const primary = hasNextHeat ? onNextHeat : canFinal ? onStartFinal : onPodium;
  useArcadeKeys({ confirm: primary });

  return (
    <RetroFrame
      title={`${heatLabel} — RESULTS`}
      eyebrow='KETTLEBELL TOURNAMENT'
      subtitle={
        winnerName ? `${winnerName} TAKES ${heatLabel}` : 'DEAD HEAT — A DRAW'
      }
      titleSize={26}
      footer={
        <RetroFooter
          tip='enter for the next step'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              {hasNextHeat ? (
                <PixelButton
                  accent='green'
                  glyph='A'
                  label='NEXT HEAT'
                  active
                  onClick={onNextHeat}
                />
              ) : null}
              {canFinal ? (
                <PixelButton
                  accent='yellow'
                  glyph={hasNextHeat ? '★' : 'A'}
                  label='RUN THE FINAL'
                  active={!hasNextHeat}
                  onClick={onStartFinal}
                />
              ) : null}
              {!hasNextHeat && !canFinal ? (
                <PixelButton
                  accent='yellow'
                  glyph='A'
                  label='TO THE PODIUM'
                  active
                  onClick={onPodium}
                />
              ) : null}
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: 1.4,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
          }}>
          <PanelTitle>THE BOARD</PanelTitle>
          {rows.map((sheet, i) => (
            <ScoreRow
              key={`${sheet.name}-${i}`}
              rank={i + 1}
              sheet={sheet}
              winner={winnerName != null && sheet.name === winnerName}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
          }}>
          <PanelTitle>STANDINGS</PanelTitle>
          <PixelPanel
            accent='cyan'
            cut={10}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 16px',
            }}>
            {standings.map((p, i) => (
              <div
                key={p.clientId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontFamily: monoFont,
                  fontSize: 13,
                  color:
                    p.bestScore > 0 || p.finalScore != null
                      ? R5.ink
                      : R5.inkMuted,
                }}>
                <span style={{ width: 22 }}>{i + 1}.</span>
                <span style={{ color: p.color }}>■</span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                  {p.name}
                  {p.finalScore != null ? ' · FINALIST' : ''}
                </span>
                <LedText size={16}>{`${p.finalScore ?? p.bestScore}`}</LedText>
              </div>
            ))}
          </PixelPanel>
          {canFinal ? (
            <PixelPanel
              accent='yellow'
              cut={10}
              innerStyle={{ padding: '10px 14px' }}>
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 11,
                  color: R5.yellow,
                }}>
                Qualification complete — the top {state?.config.heatSize ?? 2}{' '}
                scores meet in the FINAL.
              </span>
            </PixelPanel>
          ) : null}
        </div>
      </div>
    </RetroFrame>
  );
}
