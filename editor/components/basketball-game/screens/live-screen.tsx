'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  ConfirmRail,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
} from '@/components/kettlebell-tournament/kbt-kit';
import { ScoreLine, ShotRow } from '../bb-kit';
import type { BbFeed } from '../use-bb-feed';
import { formatClock, remainingNow } from '../use-bb-feed';
import type { BbRoom } from '../use-bb-room';

/** PROGRAM monitor with reconnect (the arcade page has no mic — unmuted is fine). */
function ProgramMonitor({ whepUrl }: { whepUrl: string | null }) {
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
        width: '100%',
        aspectRatio: '16 / 9',
        background: '#000',
        border: `1px solid ${KBT.border}`,
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
        }}
      />
      {feedDown ? (
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <Tab size={10} color={KBT.bad} textColor={KBT.dark}>
            PROGRAM FEED RECONNECTING
          </Tab>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The match in progress: program monitor + score/clock on the left, the
 * ledger (with the moderator's pending queue mirrored) and the flow
 * controls on the right.
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
      ? 'OVERTIME'
      : phase === 'ended'
        ? 'FINAL'
        : formatClock(remaining);
  const clockColor =
    phase === 'paused'
      ? KBT.amber
      : phase === 'overtime'
        ? KBT.accent
        : remaining <= 10_000 && phase === 'live'
          ? KBT.bad
          : KBT.good;
  const teams = state?.teams;
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];

  return (
    <Frame
      title='LIVE'
      tab={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusDot
            state={feed.connected ? 'good' : 'bad'}
            pulse={!feed.connected}
          />
          <Tab
            size={11}
            color={phase === 'paused' ? KBT.amber : KBT.good}
            textColor={KBT.dark}>
            {phase.toUpperCase()}
          </Tab>
          {state?.cams.hoop.camConnected ? null : (
            <Label size={10} tracking={1.5} color={KBT.bad}>
              HOOP CAM DOWN
            </Label>
          )}
        </div>
      }
      footer={
        <FooterHint
          hints={[
            { key: 'MODERATOR', label: 'confirms pending makes on the panel' },
          ]}
          right={
            <Label size={9} tracking={1.5}>
              the program runs ~3 s behind the court
            </Label>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: '0 0 58%',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minWidth: 0,
          }}>
          <ProgramMonitor whepUrl={room.whepUrl} />
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              gap: 16,
            }}>
            {teams ? <ScoreLine teams={teams} size={48} /> : null}
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: 'var(--font-kbt-mono)',
                  fontSize: 34,
                  fontWeight: 600,
                  color: clockColor,
                }}>
                {clock}
              </div>
              <Label size={9} tracking={2}>
                {match?.period === 'ot' ? 'OVERTIME' : 'REGULATION'} · TO{' '}
                {state?.config.targetPoints ?? 21}
              </Label>
            </div>
          </Plate>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {phase === 'paused' ? (
              <KbtButton
                label='RESUME'
                active
                onClick={() => void room.control('resume')}
              />
            ) : phase === 'live' || phase === 'overtime' ? (
              <KbtButton
                label='PAUSE'
                variant='outline'
                onClick={() => void room.control('pause')}
              />
            ) : null}
            {phase === 'live' || phase === 'paused' ? (
              <KbtButton
                label='GO TO OVERTIME'
                variant='outline'
                onClick={() => void room.control('start_overtime')}
              />
            ) : null}
            <div style={{ flex: 1 }} />
            <ConfirmRail
              actions={[
                { id: 'end', label: 'END MATCH', prompt: 'end the match now?' },
                {
                  id: 'reset',
                  label: 'RESET',
                  prompt: 'wipe the score and go back to the lobby?',
                },
              ]}
              onConfirm={(id) =>
                void room.control(id === 'end' ? 'end' : 'reset')
              }
            />
          </div>
        </div>
        <div
          className='kbt-scroll'
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
          {pending.length > 0 && teams ? (
            <Plate
              cutPx={14}
              accentBar
              accentColor={KBT.amber}
              innerStyle={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '10px 12px',
              }}>
              <PlateTitle color={KBT.amber}>
                AWAITING THE REF · {pending.length}
              </PlateTitle>
              {pending.map((s) => (
                <ShotRow
                  key={s.id}
                  shot={s}
                  teams={teams}
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
            </Plate>
          ) : null}
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '10px 12px',
            }}>
            <PlateTitle
              right={
                teams ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['A', 'B'] as const).map((t) => (
                      <KbtButton
                        key={t}
                        dense
                        variant='outline'
                        label={`+${state?.config.arcPoints ?? 2} ${teams[t].name.toUpperCase()}`}
                        onClick={() =>
                          void room.editShot({
                            op: 'add',
                            team: t,
                            points: (state?.config.arcPoints ?? 2) as 1 | 2,
                          })
                        }
                      />
                    ))}
                    <KbtButton
                      dense
                      variant='danger'
                      label='UNDO LAST'
                      onClick={() => void room.editShot({ op: 'undo' })}
                    />
                  </div>
                ) : null
              }>
              LEDGER
            </PlateTitle>
            {recent.length === 0 ? (
              <Label size={10} tracking={1.5}>
                no makes yet — the AI calls them from the hoop cam
              </Label>
            ) : null}
            {teams
              ? recent.map((s) => (
                  <ShotRow
                    key={s.id}
                    shot={s}
                    teams={teams}
                    dense
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
          </Plate>
        </div>
      </div>
    </Frame>
  );
}
