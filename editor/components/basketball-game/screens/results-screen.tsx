'use client';

import React from 'react';
import type { BbTeamId } from '@smelter-editor/types';
import {
  DisplayText,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
} from '@/components/kettlebell-tournament/kbt-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { TeamBadge } from '../bb-kit';
import type { BbFeed } from '../use-bb-feed';

function pct(makes: number, attempts: number): string {
  return attempts > 0 ? `${Math.round((makes / attempts) * 100)}%` : '—';
}

/** Final: winner, score, per-team stats, then NEW MATCH or EXIT. */
export function ResultsScreen({
  feed,
  onNewMatch,
  onExit,
}: {
  feed: BbFeed;
  onNewMatch: () => void;
  onExit: () => void;
}) {
  useArcadeKeys({ confirm: onNewMatch });
  const state = feed.state;
  if (!state) return null;
  const winner = state.winner;
  const cols: BbTeamId[] = ['A', 'B'];
  return (
    <Frame
      title='FINAL'
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <FooterHint hints={[{ key: 'ENTER', label: 'NEW MATCH' }]} />
          <div style={{ display: 'flex', gap: 10 }}>
            <KbtButton
              label='EXIT TO TITLE'
              variant='outline'
              onClick={onExit}
            />
            <KbtButton label='NEW MATCH' active onClick={onNewMatch} />
          </div>
        </div>
      }>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <div style={{ textAlign: 'center' }}>
          <DisplayText
            size={40}
            weight={800}
            tracking={3}
            color={winner ? state.teams[winner].color : KBT.cream}>
            {winner ? `${state.teams[winner].name.toUpperCase()} WINS` : 'DRAW'}
          </DisplayText>
          <Label size={10} tracking={2}>
            {state.period === 'ot' ? 'AFTER OVERTIME · ' : ''}LEAD CHANGES{' '}
            {state.leadChanges}
          </Label>
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {cols.map((team) => {
            const t = state.teams[team];
            const rows: [string, string][] = [
              ['MAKES', String(t.makes)],
              ['ATTEMPTS', String(t.attempts)],
              ['FG%', pct(t.makes, t.attempts)],
              ['TWOS', String(t.twos)],
              ['OT POINTS', String(t.otScore)],
            ];
            return (
              <Plate
                key={team}
                cutPx={16}
                accentBar
                accentColor={t.color}
                innerStyle={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '14px 16px',
                }}>
                <PlateTitle
                  right={
                    winner === team ? (
                      <Label size={9} tracking={2} color={KBT.accent}>
                        WINNER
                      </Label>
                    ) : null
                  }>
                  <TeamBadge name={t.name} color={t.color} size={18} />
                </PlateTitle>
                <DisplayText
                  size={96}
                  weight={800}
                  color={winner === team ? t.color : KBT.cream}>
                  {String(t.score)}
                </DisplayText>
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}>
                    <Label size={10} tracking={2}>
                      {label}
                    </Label>
                    <DisplayText size={20} weight={700}>
                      {value}
                    </DisplayText>
                  </div>
                ))}
              </Plate>
            );
          })}
        </div>
        {state.unattributedMisses > 0 ? (
          <Label size={9} tracking={1.5}>
            {state.unattributedMisses} missed attempts could not be attributed
            to a team
          </Label>
        ) : null}
      </div>
    </Frame>
  );
}
