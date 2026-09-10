'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  BB,
  BbButton,
  BbPlate,
  Chip,
  Clock,
  ConfirmCard,
  HostFrame,
  LedgerRow,
  Meta,
  Mono,
  PlateHead,
  ScoreRow,
  StatusPill,
  TagChip,
  useArmed,
} from '../bb-kit';
import type { BbFeed } from '../use-bb-feed';
import { formatClock, remainingNow } from '../use-bb-feed';
import type { BbRoom } from '../use-bb-room';

/** PROGRAM monitor with reconnect (the arcade page has no mic — unmuted is fine). */
function ProgramMonitor({
  whepUrl,
  caption,
}: {
  whepUrl: string | null;
  caption: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [feedDown, setFeedDown] = useState(false);

  useEffect(() => {
    if (!whepUrl) return;
    let cancelled = false;
    let closeConnection = () => {};
    let retryTimer: number | null = null;
    let delay = 1000;
    const schedule = () => {
      if (cancelled || retryTimer != null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
      delay = Math.min(8000, delay * 2);
    };
    const connect = () => {
      if (cancelled) return;
      void connectWhep(whepUrl)
        .then(({ stream, close }) => {
          if (cancelled) {
            close();
            return;
          }
          closeConnection = close;
          setFeedDown(false);
          delay = 1000;
          const vid = videoRef.current;
          if (vid && vid.srcObject !== stream) {
            vid.srcObject = stream;
            vid.play().catch(() => {});
          }
          stream.getVideoTracks()[0]?.addEventListener('ended', () => {
            if (cancelled) return;
            setFeedDown(true);
            closeConnection();
            schedule();
          });
        })
        .catch(() => {
          if (cancelled) return;
          setFeedDown(true);
          schedule();
        });
    };
    connect();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      closeConnection();
    };
  }, [whepUrl]);

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        background: 'radial-gradient(ellipse at 50% 85%,#3a3a3e,#1c1c1f 70%)',
        border: `1px solid ${BB.rule}`,
        overflow: 'hidden',
      }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
        }}
      />
      {feedDown ? (
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <TagChip tone='bad' size={10}>
            PROGRAM FEED RECONNECTING
          </TagChip>
        </div>
      ) : null}
      <Mono
        size={9}
        tracking={0.22}
        color={BB.chalk}
        style={{ position: 'absolute', left: 10, bottom: 8, opacity: 0.6 }}>
        {caption}
      </Mono>
    </div>
  );
}

/**
 * The match in progress: program monitor + score/clock + flow on the left,
 * the referee queue (mirrored from the panel) and the ledger on the right.
 * Keys: SPACE pause/resume · O overtime · E end (arms) · U undo.
 */
export function LiveScreen({ room, feed }: { room: BbRoom; feed: BbFeed }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  const state = feed.state;
  const match = feed.match;
  const phase = match?.phase ?? state?.phase ?? 'live';
  const remaining = remainingNow(match, feed.matchReceivedAt);
  const clock =
    phase === 'overtime'
      ? 'OT'
      : phase === 'ended'
        ? 'FINAL'
        : formatClock(remaining);
  const clockTone =
    phase === 'paused'
      ? 'amber'
      : phase === 'overtime'
        ? 'electric'
        : remaining <= 10_000 && phase === 'live'
          ? 'bad'
          : 'chalk';
  const teams = state?.teams;
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];
  const arc = (state?.config.arcPoints ?? 2) as 1 | 2;
  const confirm = useArmed(5000);

  const phones =
    (state?.cams.hoop.joined ? 1 : 0) +
    (state?.cams.court.joined ? 1 : 0) +
    (state?.commentator ? 1 : 0);

  // Keyboard: SPACE pause/resume, O overtime, E end (two-press), U undo.
  const keyRef = useRef({ phase, confirm });
  keyRef.current = { phase, confirm };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const p = keyRef.current.phase;
      const c = keyRef.current.confirm;
      if (e.key === ' ') {
        e.preventDefault();
        if (p === 'paused') void room.control('resume');
        else if (p === 'live' || p === 'overtime') void room.control('pause');
      } else if (e.key === 'o' || e.key === 'O') {
        if (p === 'live' || p === 'paused') void room.control('start_overtime');
      } else if (e.key === 'e' || e.key === 'E') {
        if (c.armed === 'end') {
          c.disarm();
          void room.control('end');
        } else c.arm('end');
      } else if (e.key === 'u' || e.key === 'U') {
        void room.editShot({ op: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room]);

  const flowButtons = (
    <div style={{ display: 'flex', gap: 8 }}>
      {phase === 'paused' ? (
        <BbButton
          variant='good'
          label='RESUME'
          keyBadge='SPACE'
          active
          onClick={() => void room.control('resume')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      ) : (
        <BbButton
          variant='chalk'
          label='PAUSE'
          keyBadge='SPACE'
          disabled={phase !== 'live' && phase !== 'overtime'}
          onClick={() => void room.control('pause')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      )}
      <BbButton
        variant='outline'
        label='GO TO OVERTIME'
        dimmed={phase !== 'live' && phase !== 'paused'}
        disabled={phase !== 'live' && phase !== 'paused'}
        onClick={() => void room.control('start_overtime')}
        style={{ flex: 1, height: 43, fontSize: 17 }}
      />
      <BbButton
        variant='outline'
        label='END MATCH'
        onClick={() => confirm.arm('end')}
        style={{ flex: 1, height: 43, fontSize: 17 }}
      />
      <BbButton
        variant='danger'
        label='RESET'
        onClick={() => confirm.arm('reset')}
        style={{ width: 93, height: 43, fontSize: 15, padding: 0 }}
      />
    </div>
  );

  return (
    <HostFrame
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusPill
            tone={
              phase === 'paused'
                ? 'paused'
                : phase === 'ended'
                  ? 'chalk'
                  : 'live'
            }
            size={9}>
            {phase === 'overtime' ? 'OVERTIME' : phase.toUpperCase()}
          </StatusPill>
          {state && !state.cams.hoop.camConnected ? (
            <StatusPill tone='bad' size={9} dot={false}>
              HOOP CAM DOWN
            </StatusPill>
          ) : null}
        </div>
      }
      meta={
        <Meta size={10} tracking={0.22}>
          ROOM {room.roomId ?? '—'} · ON AIR: {state?.scene ?? '—'} · {phones}{' '}
          {phones === 1 ? 'PHONE' : 'PHONES'}
        </Meta>
      }
      hints={[
        { key: 'SPACE', label: 'PAUSE / RESUME' },
        { key: 'O', label: 'OVERTIME' },
        { key: 'E', label: 'END MATCH' },
        { key: 'U', label: 'UNDO' },
      ]}
      hintsRight={
        <Mono
          size={10}
          tracking={0.22}
          color={BB.chalk}
          style={{ opacity: 0.7 }}>
          RESET AND END ASK TWICE · PROGRAM RUNS ~3 S BEHIND
        </Mono>
      }>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '58fr 42fr',
          gap: 19,
          flex: 1,
          minHeight: 0,
        }}>
        {/* ── program + score + flow ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 13,
            minWidth: 0,
            minHeight: 0,
          }}>
          <ProgramMonitor
            whepUrl={room.whepUrl}
            caption={`PROGRAM · ${(state?.config as { resolution?: string } | undefined)?.resolution ?? '1080P'} · −3.0 S`}
          />
          <BbPlate
            cutPx={12}
            style={{
              height: 80,
              padding: '0 21px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexShrink: 0,
            }}>
            {teams ? (
              <ScoreRow
                teams={teams}
                nameSize={20}
                scoreSize={32}
                stripe={{ w: 13, h: 37 }}
                style={{ flex: 1, minWidth: 0 }}
              />
            ) : (
              <div style={{ flex: 1 }} />
            )}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
                borderLeft: `1px solid ${BB.rule}`,
                paddingLeft: 16,
                flexShrink: 0,
              }}>
              <Clock text={clock} size={23} tone={clockTone} />
              <Meta size={9} tracking={0.22}>
                {match?.period === 'ot'
                  ? 'OVERTIME · FIRST TO +' + (state?.config.otWinPoints ?? 2)
                  : `REGULATION · TO ${state?.config.targetPoints ?? 21}`}
              </Meta>
            </div>
          </BbPlate>
          {confirm.armed ? (
            <ConfirmCard
              key={confirm.armed}
              scale={0.75}
              title={
                confirm.armed === 'end' ? 'END THE MATCH?' : 'RESET THE MATCH?'
              }
              copy={
                confirm.armed === 'end'
                  ? 'The clock stops and the final card goes on air.'
                  : 'Score, clock and ledger go back to zero. The stream stays on.'
              }
              confirmLabel={confirm.armed === 'end' ? 'END MATCH' : 'RESET'}
              onKeep={confirm.disarm}
              onConfirm={() => {
                const id = confirm.armed;
                confirm.disarm();
                void room.control(id === 'end' ? 'end' : 'reset');
              }}
              style={{ padding: '10px 14px', gap: 8 }}
            />
          ) : (
            flowButtons
          )}
        </div>

        {/* ── ref queue + ledger ── */}
        <div
          className='bb-scroll'
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 13,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
          {pending.length > 0 && teams ? (
            <BbPlate
              cutPx={12}
              leftBar={4}
              leftBarColor={BB.amber}
              style={{
                padding: '14px 19px 6px 21px',
                display: 'flex',
                flexDirection: 'column',
              }}>
              <PlateHead
                size={19}
                tracking={0.06}
                color={BB.amber}
                right={
                  <Meta size={9} tracking={0.22}>
                    MODERATOR DECIDES
                  </Meta>
                }
                style={{ marginBottom: 6 }}>
                AWAITING THE REF · {pending.length}
              </PlateHead>
              {pending.map((s) => (
                <LedgerRow
                  key={s.id}
                  shot={s}
                  teams={teams}
                  dense
                  scale={0.85}
                  onAssign={(team) =>
                    void room.editShot({ op: 'resolve', shotId: s.id, team })
                  }
                  onPoints={(points) =>
                    void room.editShot({ op: 'resolve', shotId: s.id, points })
                  }
                  onVoid={() =>
                    void room.editShot({
                      op: 'resolve',
                      shotId: s.id,
                      voided: true,
                    })
                  }
                />
              ))}
            </BbPlate>
          ) : null}
          <BbPlate
            cutPx={12}
            style={{
              padding: '14px 19px 6px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
            }}>
            <PlateHead
              size={19}
              tracking={0.06}
              right={
                teams ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['A', 'B'] as const).map((t) => (
                      <Chip
                        key={t}
                        dense
                        label={`+${arc} ${teams[t].name}`}
                        onClick={() =>
                          void room.editShot({
                            op: 'add',
                            team: t,
                            points: arc,
                          })
                        }
                      />
                    ))}
                    <Chip
                      dense
                      label='UNDO LAST'
                      onClick={() => void room.editShot({ op: 'undo' })}
                    />
                  </div>
                ) : null
              }
              style={{ marginBottom: 6 }}>
              LEDGER
            </PlateHead>
            {recent.length === 0 ? (
              <Meta size={10} tracking={0.16} style={{ padding: '10px 0' }}>
                no makes yet — the AI calls them from the hoop cam
              </Meta>
            ) : null}
            {teams
              ? recent.map((s) => (
                  <LedgerRow
                    key={s.id}
                    shot={s}
                    teams={teams}
                    dense
                    scale={0.85}
                    onAssign={(team) =>
                      void room.editShot({ op: 'resolve', shotId: s.id, team })
                    }
                    onPoints={(points) =>
                      void room.editShot({
                        op: 'resolve',
                        shotId: s.id,
                        points,
                      })
                    }
                    onVoid={() =>
                      void room.editShot({
                        op: 'resolve',
                        shotId: s.id,
                        voided: true,
                      })
                    }
                  />
                ))
              : null}
          </BbPlate>
        </div>
      </div>
    </HostFrame>
  );
}
