'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  FB,
  FbButton,
  FbPlate,
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
} from '../fb-kit';
import type { FbFeed } from '../use-fb-feed';
import { matchClock } from '../use-fb-feed';
import type { FbRoom } from '../use-fb-room';

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
        background: 'radial-gradient(ellipse at 50% 85%,#1d3a2b,#0b1220 70%)',
        border: `1px solid ${FB.rule}`,
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
        color={FB.chalk}
        style={{ position: 'absolute', left: 10, bottom: 8, opacity: 0.6 }}>
        {caption}
      </Mono>
    </div>
  );
}

/**
 * The match in progress: program monitor + score/clock + flow on the left,
 * the referee queue (mirrored from the panel) and the ledger on the right.
 * Keys: SPACE pause/resume · H half time / second half · E end (arms) · U undo.
 */
export function LiveScreen({ room, feed }: { room: FbRoom; feed: FbFeed }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  const state = feed.state;
  const match = feed.match;
  const phase = match?.phase ?? state?.phase ?? 'live';
  const clock =
    phase === 'ended'
      ? 'FT'
      : phase === 'halftime'
        ? 'HT'
        : matchClock(match, feed.matchReceivedAt);
  const clockTone = phase === 'paused' ? 'amber' : 'chalk';
  const teams = state?.teams;
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];
  const confirm = useArmed(5000);
  const director = state?.director;

  const keyRef = useRef({ phase, confirm, period: match?.period ?? 1 });
  keyRef.current = { phase, confirm, period: match?.period ?? 1 };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const { phase: p, confirm: c, period } = keyRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        if (p === 'paused') void room.control('resume');
        else if (p === 'live') void room.control('pause');
      } else if (e.key === 'h' || e.key === 'H') {
        if (p === 'halftime') void room.control('second_half');
        else if ((p === 'live' || p === 'paused') && period === 1)
          void room.control('half_time');
      } else if (e.key === 'e' || e.key === 'E') {
        if (c.armed === 'end') {
          c.disarm();
          void room.control('end');
        } else c.arm('end');
      } else if (e.key === 'u' || e.key === 'U') {
        void room.editEvent({ op: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room]);

  const period = match?.period ?? 1;
  const flowButtons = (
    <div style={{ display: 'flex', gap: 8 }}>
      {phase === 'paused' ? (
        <FbButton
          variant='good'
          label='RESUME'
          keyBadge='SPACE'
          active
          onClick={() => void room.control('resume')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      ) : phase === 'halftime' ? (
        <FbButton
          variant='good'
          label='SECOND HALF'
          keyBadge='H'
          active
          onClick={() => void room.control('second_half')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      ) : (
        <FbButton
          variant='chalk'
          label='PAUSE'
          keyBadge='SPACE'
          disabled={phase !== 'live'}
          onClick={() => void room.control('pause')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      )}
      {period === 1 && phase !== 'halftime' ? (
        <FbButton
          variant='outline'
          label='HALF TIME'
          keyBadge='H'
          disabled={phase !== 'live' && phase !== 'paused'}
          onClick={() => void room.control('half_time')}
          style={{ flex: 1, height: 43, fontSize: 17 }}
        />
      ) : null}
      <FbButton
        variant='outline'
        label='FULL TIME'
        onClick={() => confirm.arm('end')}
        style={{ flex: 1, height: 43, fontSize: 17 }}
      />
      <FbButton
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
            {phase === 'halftime' ? 'HALF TIME' : phase.toUpperCase()}
          </StatusPill>
          {director ? (
            <StatusPill
              tone={director.ballTracked ? 'live' : 'idle'}
              size={9}
              dot={false}>
              {director.effectiveView.toUpperCase()}
              {director.ballTracked ? ' · BALL' : ' · NO BALL'}
            </StatusPill>
          ) : null}
        </div>
      }
      meta={
        <Meta size={10} tracking={0.22}>
          ROOM {room.roomId ?? '—'} · ON AIR: {state?.scene ?? '—'} ·{' '}
          {state?.session?.toUpperCase() ?? 'NO CLIP'} · AI{' '}
          {(state?.aiEvents ?? 'off').toUpperCase()}
        </Meta>
      }
      hints={[
        { key: 'SPACE', label: 'PAUSE / RESUME' },
        { key: 'H', label: 'HALF TIME' },
        { key: 'E', label: 'FULL TIME' },
        { key: 'U', label: 'UNDO' },
      ]}
      hintsRight={
        <Mono
          size={10}
          tracking={0.22}
          color={FB.chalk}
          style={{ opacity: 0.7 }}>
          RESET AND FULL TIME ASK TWICE
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
            caption={`PROGRAM · ${director?.effectiveView.toUpperCase() ?? '—'}`}
          />
          <FbPlate
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
                borderLeft: `1px solid ${FB.rule}`,
                paddingLeft: 16,
                flexShrink: 0,
              }}>
              <Clock text={clock} size={23} tone={clockTone} />
              <Meta size={9} tracking={0.22}>
                {period === 2 ? '2ND HALF' : '1ST HALF'} ·{' '}
                {Math.round((match?.halfMs ?? 2_700_000) / 60000)} MIN
                {match?.clockFromClip ? ' · CLIP CLOCK' : ''}
              </Meta>
            </div>
          </FbPlate>
          {confirm.armed ? (
            <ConfirmCard
              key={confirm.armed}
              scale={0.75}
              title={
                confirm.armed === 'end' ? 'FULL TIME?' : 'RESET THE MATCH?'
              }
              copy={
                confirm.armed === 'end'
                  ? 'The clock stops and the final card goes on air.'
                  : 'Score, clock and ledger go back to zero. The stream stays on.'
              }
              confirmLabel={confirm.armed === 'end' ? 'FULL TIME' : 'RESET'}
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

        <div
          className='fb-scroll'
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 13,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
          {pending.length > 0 && teams ? (
            <FbPlate
              cutPx={12}
              leftBar={4}
              leftBarColor={FB.amber}
              style={{
                padding: '14px 19px 6px 21px',
                display: 'flex',
                flexDirection: 'column',
              }}>
              <PlateHead
                size={19}
                tracking={0.06}
                color={FB.amber}
                right={
                  <Meta size={9} tracking={0.22}>
                    MODERATOR DECIDES
                  </Meta>
                }
                style={{ marginBottom: 6 }}>
                GOAL? · {pending.length}
              </PlateHead>
              {pending.map((e) => (
                <LedgerRow
                  key={e.id}
                  event={e}
                  teams={teams}
                  dense
                  scale={0.85}
                  onAssign={(team) =>
                    void room.editEvent({ op: 'resolve', eventId: e.id, team })
                  }
                  onVoid={() =>
                    void room.editEvent({
                      op: 'resolve',
                      eventId: e.id,
                      voided: true,
                    })
                  }
                />
              ))}
            </FbPlate>
          ) : null}
          <FbPlate
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
                        label={`GOAL ${teams[t].short}`}
                        onClick={() =>
                          void room.editEvent({
                            op: 'add',
                            team: t,
                            kind: 'goal',
                          })
                        }
                      />
                    ))}
                    <Chip
                      dense
                      label='UNDO LAST'
                      onClick={() => void room.editEvent({ op: 'undo' })}
                    />
                  </div>
                ) : null
              }
              style={{ marginBottom: 6 }}>
              LEDGER
            </PlateHead>
            {recent.length === 0 ? (
              <Meta size={10} tracking={0.16} style={{ padding: '10px 0' }}>
                nothing yet — the telemetry calls chances, shots and corners
              </Meta>
            ) : null}
            {teams
              ? recent.map((e) => (
                  <LedgerRow
                    key={e.id}
                    event={e}
                    teams={teams}
                    dense
                    scale={0.85}
                    onAssign={(team) =>
                      void room.editEvent({
                        op: 'resolve',
                        eventId: e.id,
                        team,
                      })
                    }
                    onVoid={() =>
                      void room.editEvent({
                        op: 'resolve',
                        eventId: e.id,
                        voided: true,
                      })
                    }
                  />
                ))
              : null}
          </FbPlate>
        </div>
      </div>
    </HostFrame>
  );
}
