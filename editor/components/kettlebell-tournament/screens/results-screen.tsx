'use client';

import React from 'react';
import type { KbtScoreBreakdown } from '@smelter-editor/types';
import {
  Bar,
  DisplayText,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  Tab,
  kbtMonoFont,
  rankColor,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import type { KbtFeed } from '../use-kbt-feed';

function ScoreRow({
  rank,
  sheet,
  winner,
  topPoints,
}: {
  rank: number;
  sheet: KbtScoreBreakdown;
  winner: boolean;
  topPoints: number;
}) {
  return (
    <Plate
      cutPx={14}
      accentBar={winner}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 18px',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Num size={18} color={rankColor(rank - 1)} style={{ width: 30 }}>
          {`${rank}.`}
        </Num>
        <span
          style={{
            width: 8,
            height: 8,
            background: sheet.color,
            flexShrink: 0,
          }}
        />
        <DisplayText
          size={22}
          weight={700}
          tracking={1.5}
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {sheet.name}
        </DisplayText>
        <Label size={10} tracking={1.5}>
          {`SW ${sheet.reps.swing} · CL ${sheet.reps.clean} · SN ${sheet.reps.snatch}`}
          {sheet.incorrectReps > 0 ? ` · ✕${sheet.incorrectReps}` : ''}
          {sheet.bestStreak >= 5 ? ` · x${sheet.bestStreak}` : ''}
        </Label>
        <DisplayText
          size={30}
          weight={800}
          color={winner ? KBT.accent : KBT.cream}
          style={{ minWidth: 54, textAlign: 'right' }}>
          {`${sheet.points}`}
        </DisplayText>
      </div>
      <Bar
        value={sheet.points}
        max={Math.max(1, topPoints)}
        color={winner ? KBT.accent : 'rgba(232,228,218,.35)'}
        height={4}
      />
    </Plate>
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
  const topPoints = rows[0]?.points ?? 0;

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
    <Frame
      title='STANDINGS'
      tab={<Tab>{`${heatLabel} COMPLETE`}</Tab>}
      footer={
        <FooterHint
          hints={[{ key: 'ENTER', label: 'NEXT STEP' }]}
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              {hasNextHeat ? (
                <KbtButton
                  variant='solid'
                  dense
                  label='NEXT HEAT'
                  active
                  onClick={onNextHeat}
                />
              ) : null}
              {canFinal ? (
                <KbtButton
                  variant={hasNextHeat ? 'outline' : 'solid'}
                  dense
                  label='RUN THE FINAL'
                  active={!hasNextHeat}
                  onClick={onStartFinal}
                />
              ) : null}
              {!hasNextHeat && !canFinal ? (
                <KbtButton
                  variant='outline'
                  dense
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
          <Plate
            cutPx={14}
            accentBar
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
            }}>
            <Label size={10} tracking={2} color={KBT.cream}>
              {winnerName
                ? `${winnerName} TAKES ${heatLabel}`
                : 'DEAD HEAT — A DRAW'}
            </Label>
          </Plate>
          {rows.map((sheet, i) => (
            <ScoreRow
              key={`${sheet.name}-${i}`}
              rank={i + 1}
              sheet={sheet}
              winner={winnerName != null && sheet.name === winnerName}
              topPoints={topPoints}
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
          <Label size={11}>TOURNAMENT</Label>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 16px',
            }}>
            {standings.map((p, i) => {
              const scored = p.bestScore > 0 || p.finalScore != null;
              return (
                <div
                  key={p.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    opacity: scored ? 1 : 0.55,
                  }}>
                  <Num size={13} color={rankColor(i)} style={{ width: 24 }}>
                    {`${i + 1}.`}
                  </Num>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: p.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontFamily: kbtMonoFont,
                      fontSize: 12,
                      letterSpacing: 0.5,
                      color: KBT.cream,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                    {p.name}
                    {p.finalScore != null ? (
                      <span style={{ color: KBT.dim }}> · FINALIST</span>
                    ) : null}
                  </span>
                  <Num size={15}>{`${p.finalScore ?? p.bestScore}`}</Num>
                </div>
              );
            })}
          </Plate>
          {canFinal ? (
            <Plate cutPx={14} accentBar innerStyle={{ padding: '10px 14px' }}>
              <span
                style={{
                  fontFamily: kbtMonoFont,
                  fontSize: 11,
                  lineHeight: 1.7,
                  letterSpacing: 0.5,
                  color: KBT.cream,
                }}>
                Qualification complete — the top {state?.config.heatSize ?? 2}{' '}
                scores meet in the FINAL.
              </span>
            </Plate>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
