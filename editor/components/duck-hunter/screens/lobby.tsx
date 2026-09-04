'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { MAX_SHOOTER_PLAYERS } from '@smelter-editor/types';
import { setDuckHunterConfig } from '@/app/actions/actions';
import { useArmed } from '@/lib/arcade/use-armed';
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
  chamfer,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

const PUBLIC_BASE_KEY = 'smelter-public-base';

/**
 * Per-row remove button. Two presses: `✕` arms into `KICK?`, and the arm
 * lapses on its own — the host drives this screen from across the room, and a
 * stray click must not silently drop a hunter who is already calibrating.
 */
function KickChip({
  armed,
  name,
  onClick,
}: {
  armed: boolean;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      className='r5-btn'
      title={`Remove ${name} from the lobby`}
      aria-label={`Remove ${name} from the lobby`}
      onClick={onClick}
      style={{
        clipPath: chamfer(5),
        flexShrink: 0,
        background: armed ? R5.red : 'rgba(255,90,90,0.14)',
        color: armed ? R5.bgDeep : R5.red,
        fontFamily: pixelFont,
        fontSize: 8,
        letterSpacing: 1,
        padding: '7px 9px',
        whiteSpace: 'nowrap',
      }}>
      {armed ? 'KICK?' : '✕'}
    </button>
  );
}

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

  // The server can't know the public page base, so push the join URL down and
  // let the broadcast's opening screen burn in its own QR. Debounced: the
  // public-address field below edits live, and every distinct URL writes a PNG
  // and registers a fresh (immutable) engine image.
  const roomId = room.roomId;
  useEffect(() => {
    if (!shootUrl || !roomId) return;
    let label = base.trim();
    try {
      label = new URL(base.trim()).host;
    } catch {
      // Not a URL yet (mid-typing) — send the raw base as the label.
    }
    const timer = window.setTimeout(() => {
      void setDuckHunterConfig(roomId, {
        joinUrl: shootUrl,
        joinLabel: label,
      }).catch(() => {
        // Non-fatal: the on-air QR just stays on PREPARING THE LINK.
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [shootUrl, base, roomId]);

  const ready = feed.targetActive && !room.creating && !!room.roomId;
  const canStart = ready && feed.players.length > 0;
  // The roster and the hunter catalog are the same scarce thing (one character
  // each), so a full lobby means the QR has nothing left to sell.
  const full = feed.players.length >= MAX_SHOOTER_PLAYERS;
  const kick = useArmed(3000);

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
          : full
            ? 'FULL — READY'
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
              : full
                ? `lobby full (${MAX_SHOOTER_PLAYERS} hunters) · ✕ to remove one · enter to start`
                : 'scan to join · ✕ to remove a hunter · enter to start'
          }
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='BACK'
                onClick={onBack}
              />
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
          <PanelTitle>
            {full ? 'LOBBY FULL' : 'JOIN WITH YOUR PHONE'}
          </PanelTitle>
          {shootUrl ? (
            <PixelPanel
              accent={full ? 'red' : 'cyan'}
              cut={10}
              glow={0.35}
              fill='#ffffff'
              innerStyle={{ padding: 14 }}>
              {/* Dimmed rather than removed: a fourth phone that scans anyway
                  gets a clean refusal, and the code is instantly live again
                  the moment the host kicks someone. */}
              <div style={{ opacity: full ? 0.25 : 1 }}>
                <QRCode value={shootUrl} size={200} />
              </div>
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
            HUNTERS ({feed.players.length}/{MAX_SHOOTER_PLAYERS})
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
                    <KickChip
                      armed={kick.armed === p.clientId}
                      name={p.name}
                      onClick={() => {
                        if (kick.armed !== p.clientId) {
                          kick.arm(p.clientId);
                          return;
                        }
                        kick.disarm();
                        void room.kickPlayer(p.clientId);
                      }}
                    />
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
