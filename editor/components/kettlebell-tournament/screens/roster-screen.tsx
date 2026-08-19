'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import type { KbtPlayer } from '@smelter-editor/types';
import {
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
} from '@/lib/server-url';
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
import type { KbtRoom } from '../use-kbt-room';

const PUBLIC_BASE_KEY = 'smelter-public-base';

function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

function PlayerRow({ p, mark }: { p: KbtPlayer; mark?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: monoFont,
        fontSize: 13,
      }}>
      <span style={{ color: p.color }}>■</span>
      <span
        style={{
          flex: 1,
          color: R5.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {p.name}
        {mark ? <span style={{ color: R5.inkMuted }}> · {mark}</span> : null}
      </span>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 9,
          letterSpacing: 1,
          color: p.camConnected ? R5.green : R5.orangeBright,
        }}
        className={p.camConnected ? undefined : 'r5-blink'}>
        {p.camConnected ? 'CAM ✓' : 'NO CAM'}
      </span>
    </div>
  );
}

/**
 * Registration screen: the join QR (the phone page publishes its camera), the
 * live roster with camera status, and — once drawn — the heat card the host
 * stages next. The output video behind this shows the camera mosaic, so
 * lifters see themselves the moment they go live.
 */
export function RosterScreen({
  room,
  feed,
  onDrawHeats,
  onStageHeat,
  onBack,
}: {
  room: KbtRoom;
  feed: KbtFeed;
  onDrawHeats: () => void;
  onStageHeat: (heatIndex: number) => void;
  onBack: () => void;
}) {
  const [base, setBase] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem(PUBLIC_BASE_KEY);
    setBase(saved || defaultPublicBase());
  }, []);

  // Same link recipe as Duck Hunter: public page base + explicit ?server=.
  const liftUrl = useMemo(() => {
    const b = base.trim().replace(/\/+$/, '');
    if (!b || !room.roomId) return '';
    const url = `${b}/mobile/${encodeURIComponent(room.roomId)}/lift`;
    const api = getStoredClientServerUrl() ?? getPublicDefaultServerUrl();
    return api ? `${url}?server=${encodeURIComponent(api)}` : url;
  }, [base, room.roomId]);

  const players = feed.state?.players ?? [];
  const heats = feed.state?.heats ?? [];
  const heatsDrawn = heats.length > 0;
  const nextHeat = heats.find((h) => h.phase === 'idle');
  const camsReady = players.filter((p) => p.camConnected).length;
  // One lifter is a valid tournament — the SOLO CHALLENGE (one heat of one).
  const canDraw = !!room.roomId && players.length >= 1;
  const solo = players.length === 1;
  const canStage = heatsDrawn && !!nextHeat;

  const primary = () => {
    if (canStage) onStageHeat(nextHeat!.index);
    else if (canDraw) onDrawHeats();
  };
  useArcadeKeys({ confirm: primary, back: onBack });

  const statusLine = room.error
    ? `SETUP FAILED: ${room.error}`
    : room.creating || !room.roomId
      ? 'BUILDING THE ARENA…'
      : players.length === 0
        ? 'WAITING FOR THE FIRST LIFTER'
        : camsReady < players.length
          ? `${camsReady}/${players.length} CAMERAS LIVE`
          : solo
            ? 'SOLO CHALLENGE — CAMERA LIVE'
            : 'ALL CAMERAS LIVE';

  return (
    <RetroFrame
      title='REGISTRATION'
      eyebrow='KETTLEBELL TOURNAMENT'
      subtitle={statusLine}
      titleSize={26}
      footer={
        <RetroFooter
          tip='scan to enter · enter to draw heats / stage the next heat'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='RULES'
                onClick={onBack}
              />
              {!heatsDrawn ? (
                <PixelButton
                  accent='green'
                  glyph='A'
                  label={solo ? 'SOLO CHALLENGE' : 'DRAW HEATS'}
                  active={canDraw}
                  disabled={!canDraw}
                  onClick={onDrawHeats}
                />
              ) : (
                <PixelButton
                  accent='green'
                  glyph='A'
                  label={
                    nextHeat
                      ? `STAGE ${nextHeat.final ? 'FINAL' : `HEAT ${nextHeat.index + 1}`}`
                      : 'ALL HEATS DONE'
                  }
                  active={canStage}
                  disabled={!canStage}
                  onClick={() => nextHeat && onStageHeat(nextHeat.index)}
                />
              )}
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        {/* QR + link */}
        <div
          style={{
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
          <PanelTitle>ENTER WITH YOUR PHONE</PanelTitle>
          {liftUrl ? (
            <PixelPanel
              accent='cyan'
              cut={10}
              glow={0.35}
              fill='#ffffff'
              innerStyle={{ padding: 14 }}>
              <QRCode value={liftUrl} size={200} />
            </PixelPanel>
          ) : (
            <PixelPanel
              cut={10}
              innerStyle={{
                width: 228,
                height: 228,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: pixelFont,
                fontSize: 11,
                color: R5.inkMuted,
              }}>
              {room.creating ? 'BUILDING…' : 'NO ARENA'}
            </PixelPanel>
          )}
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 10,
              color: R5.inkMuted,
              textAlign: 'center',
              wordBreak: 'break-all',
            }}>
            {liftUrl || 'the join link appears when the arena is up'}
          </div>
          <input
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              window.localStorage.setItem(PUBLIC_BASE_KEY, e.target.value);
            }}
            placeholder='public page base (https://…)'
            style={{
              width: '100%',
              fontFamily: monoFont,
              fontSize: 11,
              color: R5.ink,
              background: 'rgba(120,150,200,0.1)',
              border: `1px solid rgba(${R5.gridRgb},0.5)`,
              padding: '8px 10px',
              outline: 'none',
            }}
          />
        </div>

        {/* Roster */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
          }}>
          <PanelTitle>
            {`ROSTER — ${players.length} LIFTER${players.length === 1 ? '' : 'S'}`}
          </PanelTitle>
          <PixelPanel
            accent='cyan'
            cut={10}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 16px',
              minHeight: 120,
            }}>
            {players.length === 0 ? (
              <span
                className='r5-blink'
                style={{
                  fontFamily: pixelFont,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: R5.inkMuted,
                }}>
                WAITING FOR LIFTERS…
              </span>
            ) : (
              players.map((p) => (
                <PlayerRow
                  key={p.clientId}
                  p={p}
                  mark={
                    p.heatIndex != null ? `HEAT ${p.heatIndex + 1}` : undefined
                  }
                />
              ))
            )}
          </PixelPanel>
        </div>

        {/* Heats preview */}
        <div
          style={{
            width: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>HEATS</PanelTitle>
          {heatsDrawn ? (
            heats.map((h) => {
              const done = h.phase === 'ended';
              const isNext = nextHeat?.index === h.index;
              return (
                <PixelPanel
                  key={h.index}
                  accent={isNext ? 'green' : done ? 'blue' : 'yellow'}
                  cut={10}
                  glow={isNext ? 0.5 : 0.15}
                  innerStyle={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '10px 14px',
                    opacity: done ? 0.6 : 1,
                  }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: pixelFont,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      color: isNext ? R5.green : done ? R5.inkMuted : R5.yellow,
                    }}>
                    <span>{h.final ? 'FINAL' : `HEAT ${h.index + 1}`}</span>
                    <span>{done ? 'DONE' : isNext ? 'UP NEXT' : ''}</span>
                  </div>
                  <div
                    style={{
                      fontFamily: monoFont,
                      fontSize: 11,
                      color: R5.ink,
                    }}>
                    {h.playerIds
                      .map(
                        (id) =>
                          players.find((p) => p.clientId === id)?.name ?? '?',
                      )
                      .join(' · ')}
                  </div>
                </PixelPanel>
              );
            })
          ) : (
            <PixelPanel cut={10} innerStyle={{ padding: '12px 14px' }}>
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: R5.inkMuted,
                }}>
                Draw heats when the roster is in — groups of{' '}
                {feed.state?.config.heatSize ?? 2} in join order. A lone
                trailing lifter folds into the last heat.
              </span>
            </PixelPanel>
          )}
          {feed.state ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: monoFont,
                fontSize: 11,
                color: R5.inkMuted,
              }}>
              <span>ROUND</span>
              <LedText size={16}>
                {`${Math.floor(feed.state.config.heatDurationMs / 60000)}:${String(
                  Math.round(feed.state.config.heatDurationMs / 1000) % 60,
                ).padStart(2, '0')}`}
              </LedText>
            </div>
          ) : null}
        </div>
      </div>
    </RetroFrame>
  );
}
