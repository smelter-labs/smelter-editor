'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
} from '@/lib/server-url';
import type { MatchSetup } from '../arcade';
import { characterById } from '../characters';
import type { DuckHunterRoom } from '../use-duck-hunter-room';
import type { ShooterFeed } from '../use-shooter-feed';
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
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

const PUBLIC_BASE_KEY = 'smelter-public-base';

/** Default public base for the QR: env override, else the current origin. */
function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

/**
 * Phone lobby: creates the arcade room on entry (the YOLO sidecar warms up
 * behind the QR), shows the join QR + live hunter list, and starts the
 * match. Ducks already fly on the output while the lobby is open — that's
 * the attract mode.
 */
export function Lobby({
  setup,
  room,
  feed,
  onStart,
  onBack,
}: {
  setup: MatchSetup;
  room: DuckHunterRoom;
  feed: ShooterFeed;
  onStart: () => void;
  onBack: () => void;
}) {
  const [base, setBase] = useState('');
  const [copied, setCopied] = useState(false);

  // Load saved public base (or default) once on mount.
  useEffect(() => {
    const saved = window.localStorage.getItem(PUBLIC_BASE_KEY);
    setBase(saved || defaultPublicBase());
  }, []);

  // Same link recipe as the dashboard DuckHunterPanel: public page base plus
  // an explicit ?server= so the phone talks to the same backend.
  const shootUrl = useMemo(() => {
    const b = base.trim().replace(/\/+$/, '');
    if (!b || !room.roomId) return '';
    const url = `${b}/mobile/${encodeURIComponent(room.roomId)}/shoot`;
    const api = getStoredClientServerUrl() ?? getPublicDefaultServerUrl();
    return api ? `${url}?server=${encodeURIComponent(api)}` : url;
  }, [base, room.roomId]);

  const ready = feed.targetActive && !room.creating && !!room.roomId;
  const canStart = ready && feed.players.length > 0;

  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const tryStart = () => {
    if (!ready) return;
    if (feed.players.length === 0 && !confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    onStart();
  };

  useArcadeKeys({ confirm: tryStart, back: onBack });

  const statusLine = room.error
    ? `SETUP FAILED: ${room.error}`
    : room.creating || !room.roomId
      ? 'BUILDING THE MARSH…'
      : !feed.targetActive
        ? 'SPINNING UP DUCKS…'
        : feed.players.length === 0
          ? 'WAITING FOR HUNTERS'
          : 'READY';

  return (
    <RetroFrame
      title='LOBBY'
      eyebrow='DUCK HUNTER'
      subtitle={
        setup.mode === 'time'
          ? `TIME ATTACK · ${setup.durationMs / 1000}S`
          : `SCORE RUSH · FIRST TO ${setup.targetScore}`
      }
      titleSize={26}
      footer={
        <RetroFooter
          tip={
            confirmEmpty
              ? 'no hunters joined — press start again to run anyway'
              : 'scan to join · enter to start'
          }
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton accent='red' glyph='B' label='BACK' onClick={onBack} />
              <PixelButton
                accent='green'
                glyph='A'
                label={canStart || confirmEmpty ? 'START GAME' : statusLine}
                active={canStart || (ready && confirmEmpty)}
                disabled={!ready}
                onClick={tryStart}
              />
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
          <PanelTitle>JOIN WITH YOUR PHONE</PanelTitle>
          {shootUrl ? (
            <PixelPanel
              accent='cyan'
              cut={10}
              glow={0.35}
              fill='#ffffff'
              innerStyle={{ padding: 14 }}>
              <QRCode value={shootUrl} size={200} />
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
              }}>
              <span
                className='r5-blink'
                style={{
                  fontFamily: pixelFont,
                  fontSize: 10,
                  color: R5.inkMuted,
                }}>
                {room.error ? 'ERROR' : 'LOADING…'}
              </span>
            </PixelPanel>
          )}
          <button
            type='button'
            className='r5-btn'
            disabled={!shootUrl}
            onClick={() => {
              void navigator.clipboard?.writeText(shootUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            style={{
              fontFamily: monoFont,
              fontSize: 11,
              letterSpacing: 1,
              color: R5.cyan,
              textTransform: 'uppercase',
            }}>
            {copied ? 'copied!' : 'copy link'}
          </button>
          <label
            style={{
              width: '100%',
              fontFamily: monoFont,
              fontSize: 10,
              color: R5.inkMuted,
            }}>
            public address (https tunnel for gyro aiming):
            <input
              value={base}
              onChange={(e) => {
                setBase(e.target.value);
                try {
                  window.localStorage.setItem(PUBLIC_BASE_KEY, e.target.value);
                } catch {
                  /* ignore */
                }
              }}
              placeholder='https://xxx.ngrok-free.dev'
              style={{
                marginTop: 4,
                width: '100%',
                background: R5.panelDark,
                border: `1px solid rgba(${R5.gridRgb},0.4)`,
                color: R5.ink,
                fontFamily: monoFont,
                fontSize: 11,
                padding: '5px 8px',
              }}
            />
          </label>
        </div>

        {/* Hunters (each row shows the character picked on that phone) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>
            HUNTERS{' '}
            {feed.players.length > 0 ? `(${feed.players.length})` : ''}
          </PanelTitle>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
            {feed.players.length === 0 ? (
              <span
                className='r5-blink'
                style={{
                  fontFamily: pixelFont,
                  fontSize: 10,
                  color: R5.inkMuted,
                  marginTop: 12,
                }}>
                {statusLine}
              </span>
            ) : (
              feed.players.map((p) => {
                const ch = characterById(p.characterId);
                return (
                  <PixelPanel
                    key={p.clientId}
                    accent={ch?.accent ?? 'blue'}
                    cut={8}
                    innerStyle={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                    }}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        background: p.color,
                        boxShadow: `0 0 8px ${p.color}`,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: pixelFont,
                        fontSize: 11,
                        color: R5.ink,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                      {p.name}
                    </span>
                    <span style={{ flex: 1 }} />
                    {/* The hunter this player picked on their phone. */}
                    <span
                      style={{
                        fontFamily: monoFont,
                        fontSize: 10,
                        letterSpacing: 1,
                        color: ch ? ch.color : R5.inkMuted,
                        textShadow: ch ? `0 0 6px ${ch.color}` : undefined,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}>
                      {ch ? ch.name : 'PICKING…'}
                    </span>
                  </PixelPanel>
                );
              })
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'baseline',
              gap: 8,
            }}>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
                textTransform: 'uppercase',
              }}>
              status
            </span>
            <LedText
              size={18}
              color={ready ? R5.green : R5.orange}
              glowRgb={ready ? R5.greenRgb : R5.orangeRgb}>
              {statusLine}
            </LedText>
          </div>
        </div>
      </div>
    </RetroFrame>
  );
}
