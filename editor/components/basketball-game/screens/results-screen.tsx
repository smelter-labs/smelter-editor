'use client';

import React from 'react';
import type { BbTeamId } from '@smelter-editor/types';
import {
  BB,
  BbButton,
  BbPlate,
  Display,
  HostFrame,
  Meta,
  Mono,
  StatCell,
  Stencil,
  TagChip,
  TeamStripe,
  halftone,
} from '../bb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import type { BbFeed } from '../use-bb-feed';
import { formatClock } from '../use-bb-feed';

function pct(makes: number, attempts: number): string {
  return attempts > 0 ? `${Math.round((makes / attempts) * 100)}` : '—';
}

/** Final: winner, score, per-team stats, then NEW MATCH or EXIT. */
export function ResultsScreen({
  feed,
  roomId,
  recordingSaved = false,
  onNewMatch,
  onExit,
}: {
  feed: BbFeed;
  roomId: string | null;
  recordingSaved?: boolean;
  onNewMatch: () => void;
  onExit: () => void;
}) {
  useArcadeKeys({ confirm: onNewMatch });
  const state = feed.state;
  if (!state) return null;
  const winner = state.winner;
  const cols: BbTeamId[] = ['A', 'B'];
  const elapsed = feed.match?.elapsedMs;
  const subline = [
    state.period === 'ot' ? 'AFTER OVERTIME' : 'FULL TIME',
    `LEAD CHANGES ${state.leadChanges}`,
    elapsed != null ? `${formatClock(elapsed)} PLAYED` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <HostFrame
      background={
        <>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: halftone('232,179,58', 0.14, '15% 20%'),
              backgroundSize: '10px 10px',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(135deg, rgba(20,20,22,.1), ${BB.page} 50%)`,
            }}
          />
        </>
      }
      title={
        <Stencil size={29} tracking={0.1} bg={BB.page}>
          FINAL
        </Stencil>
      }
      meta={
        <Meta size={10} tracking={0.22}>
          ROOM {roomId ?? '—'}
          {recordingSaved ? ' · RECORDING SAVED' : ''}
        </Meta>
      }
      actions={
        <>
          <BbButton
            variant='outline'
            label='EXIT TO TITLE'
            onClick={onExit}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <BbButton
            active
            label='NEW MATCH'
            keyBadge='ENTER'
            onClick={onNewMatch}
            style={{ height: 43, fontSize: 20, padding: '0 24px' }}
          />
        </>
      }
      hints={[{ key: 'ENTER', label: 'NEW MATCH' }]}
      hintsRight={
        state.unattributedMisses > 0 ? (
          <Meta size={9} tracking={0.16}>
            {state.unattributedMisses} missed attempts could not be attributed
            to a team
          </Meta>
        ) : (
          <Mono
            size={10}
            tracking={0.22}
            color={BB.chalk}
            style={{ opacity: 0.6 }}>
            CHAMPION OF THE BLACKTOP
          </Mono>
        )
      }>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingTop: 14,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 19 }}>
          {winner ? (
            <TeamStripe color={state.teams[winner].color} w={16} h={60} />
          ) : null}
          <Display size={87} weight={900} lineHeight={0.85} tracking={0.02}>
            {winner ? (
              <>
                {state.teams[winner].name}{' '}
                <span
                  style={{
                    background: BB.goldText,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}>
                  WINS
                </span>
              </>
            ) : (
              'DRAW'
            )}
          </Display>
        </div>
        <Mono
          size={12}
          tracking={0.22}
          color={BB.chalk}
          style={{ opacity: 0.75, paddingLeft: winner ? 35 : 0 }}>
          {subline}
        </Mono>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 19,
          flex: 1,
          minHeight: 0,
          marginTop: 22,
        }}>
        {cols.map((team) => {
          const t = state.teams[team];
          const win = winner === team;
          const cells: [string, string][] = [
            ['MAKES', String(t.makes)],
            ['ATTEMPTS', String(t.attempts)],
            ['FG%', pct(t.makes, t.attempts)],
            ['TWOS', String(t.twos)],
            ['OT POINTS', String(t.otScore)],
          ];
          return (
            <BbPlate
              key={team}
              cutPx={15}
              topBar={4}
              topBarColor={t.color}
              style={{
                padding: '24px 27px 21px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <Display size={27} weight={800}>
                  {t.name}
                </Display>
                {win ? (
                  <TagChip tone='gold' size={9}>
                    WINNER
                  </TagChip>
                ) : null}
              </div>
              <Display
                size={64}
                weight={900}
                lineHeight={0.9}
                color={win ? BB.gold : BB.chalk}
                style={{ opacity: win || !winner ? 1 : 0.85 }}>
                {t.score}
              </Display>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 8,
                  marginTop: 'auto',
                }}>
                {cells.map(([label, value]) => (
                  <StatCell key={label} label={label} value={value} size={27} />
                ))}
              </div>
            </BbPlate>
          );
        })}
      </div>
    </HostFrame>
  );
}
