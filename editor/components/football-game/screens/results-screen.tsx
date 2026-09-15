'use client';

import React from 'react';
import type { FbTeamId } from '@smelter-editor/types';
import {
  FB,
  FbButton,
  FbPlate,
  Display,
  HostFrame,
  Meta,
  Mono,
  StatCell,
  Stencil,
  TagChip,
  TeamStripe,
  halftone,
} from '../fb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import type { FbFeed } from '../use-fb-feed';

/** Full time: winner, score, per-team stats, the tracking leaders, then NEW MATCH or EXIT. */
export function ResultsScreen({
  feed,
  roomId,
  recordingSaved = false,
  onNewMatch,
  onExit,
}: {
  feed: FbFeed;
  roomId: string | null;
  recordingSaved?: boolean;
  onNewMatch: () => void;
  onExit: () => void;
}) {
  useArcadeKeys({ confirm: onNewMatch });
  const state = feed.state;
  if (!state) return null;
  const winner = state.winner;
  const cols: FbTeamId[] = ['A', 'B'];
  const top = state.tracking[0];
  const most = [...state.tracking].sort((a, b) => b.meters - a.meters)[0];
  const subline = [
    'FULL TIME',
    top ? `TOP SPEED #${top.tag} ${Math.round(top.topKmh)} KM/H` : null,
    most ? `MOST GROUND #${most.tag} ${most.meters} M` : null,
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
              backgroundImage: halftone('47,191,113', 0.14, '15% 20%'),
              backgroundSize: '10px 10px',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(135deg, rgba(11,18,32,.1), ${FB.page} 50%)`,
            }}
          />
        </>
      }
      title={
        <Stencil size={29} tracking={0.1} bg={FB.page}>
          FULL TIME
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
          <FbButton
            variant='outline'
            label='EXIT TO TITLE'
            onClick={onExit}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <FbButton
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
        <Mono
          size={10}
          tracking={0.22}
          color={FB.chalk}
          style={{ opacity: 0.6 }}>
          TOUCHLINE · SMELTER FOOTBALL
        </Mono>
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
                    background: FB.goldText,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}>
                  WIN
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
          color={FB.chalk}
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
            ['CHANCES', String(t.chances)],
            ['SHOTS', String(t.shots)],
            ['ON TARGET', String(t.shotsOnTarget)],
            ['CORNERS', String(t.corners)],
            ['SPRINTS', String(t.sprints)],
          ];
          return (
            <FbPlate
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
                color={win ? FB.gold : FB.chalk}
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
            </FbPlate>
          );
        })}
      </div>
    </HostFrame>
  );
}
