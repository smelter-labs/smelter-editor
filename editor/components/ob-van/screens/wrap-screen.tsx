'use client';

import React, { useState } from 'react';
import { getObWrapNotes } from '@/app/actions/actions';
import type { KbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import { formatClock, formatSeconds } from '@/lib/ob-van/pacing';
import {
  avgHoldMs,
  camShare,
  cutsBySource,
  pct,
  showLengthMs,
} from '@/lib/ob-van/stats';
import { SOURCE_LABEL } from '@/lib/ob-van/view-labels';
import {
  Copy,
  Display,
  Meta,
  Mono,
  OB,
  ObButton,
  ObPlate,
  ObRecordingPlate,
  ProgressBar,
  StatCell,
  HostFrame,
  WarnPlate,
  useArmed,
} from '../ob-kit';
import type { ObFeed } from '../use-ob-feed';
import { describeObError, type ObRoom } from '../use-ob-room';
import { useServerNow } from '../panel/use-server-now';

/**
 * WRAP: the show in numbers (cuts, mean hold, who cut), each camera's share
 * of the program, the recording, and the director's notes from the LLM.
 * NEW EVENT goes back to SETUP with the cameras still joined.
 */
export function WrapScreen({
  room,
  feed,
  rec,
  recordingSaved,
  onNewEvent,
  onExit,
}: {
  room: ObRoom;
  feed: ObFeed;
  rec: KbtRecording;
  recordingSaved: boolean;
  onNewEvent: () => void;
  onExit: () => void;
}) {
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const { armed, arm, disarm } = useArmed(4000);
  const now = useServerNow(feed.clockOffsetMs, 1000);
  const state = feed.state;
  if (!state)
    return (
      <HostFrame title='WRAP'>
        <Meta>waiting for the show state…</Meta>
      </HostFrame>
    );

  const stats = state.stats;
  const shares = camShare(stats, state.cams);
  const sources = cutsBySource(stats);
  const shownNotes = notes ?? state.wrapNotes;

  const generate = async () => {
    if (!room.roomId || notesBusy) return;
    setNotesBusy(true);
    setNotesError(null);
    try {
      const res = await getObWrapNotes(room.roomId);
      if (res.ok) setNotes(res.value.notes);
      else setNotesError(describeObError(res.error));
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : String(err));
    } finally {
      setNotesBusy(false);
    }
  };

  return (
    <HostFrame
      title='WRAP'
      meta={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ObButton
            size='sm'
            variant='primary'
            label='NEW EVENT'
            title='Back to SETUP — the cameras stay joined'
            onClick={onNewEvent}
          />
          <ObButton
            size='sm'
            variant={armed === 'exit' ? 'dangerSolid' : 'danger'}
            label={armed === 'exit' ? 'DELETE + EXIT' : 'EXIT'}
            onClick={() => {
              if (armed !== 'exit') return arm('exit');
              disarm();
              onExit();
            }}
          />
        </div>
      }
      hints={[]}
      hintsRight={
        <Mono size={9.5} tracking={0.14} color={OB.dim2}>
          {state.config.eventName}
        </Mono>
      }>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 400px',
          gap: 14,
        }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 0,
          }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 16,
            }}>
            <StatCell
              label='SHOW LENGTH'
              value={formatClock(showLengthMs(stats, now))}
            />
            <StatCell label='CUTS' value={String(stats.cuts)} />
            <StatCell
              label='MEAN HOLD'
              value={formatSeconds(avgHoldMs(stats, now))}
            />
            <StatCell
              label='AUTO SHARE'
              value={pct(sources.find((s) => s.source === 'auto')?.share ?? 0)}
              color={OB.accent}
            />
          </div>
          <ObPlate title='WHO CUT' padding={12}>
            <div style={{ display: 'flex', gap: 18 }}>
              {sources.map((s) => (
                <div
                  key={s.source}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Meta size={9}>{SOURCE_LABEL[s.source]}</Meta>
                  <Display size={26} weight={700}>
                    {s.count}
                  </Display>
                </div>
              ))}
            </div>
          </ObPlate>
          <ObPlate title='CAMERA SHARE OF PROGRAM' scroll style={{ flex: 1 }}>
            {shares.length === 0 ? (
              <Meta>no cameras aired</Meta>
            ) : (
              shares.map((row) => (
                <div
                  key={row.camId}
                  style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Display size={18} weight={800} style={{ width: 22 }}>
                    {row.number ?? '?'}
                  </Display>
                  <Mono
                    size={11}
                    weight={600}
                    style={{
                      width: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                    {row.name}
                  </Mono>
                  <ProgressBar
                    value={row.share}
                    height={8}
                    color={OB.program}
                    style={{ flex: 1 }}
                  />
                  <Mono
                    size={10.5}
                    weight={600}
                    style={{
                      width: 120,
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}>
                    {pct(row.share)} · {formatClock(row.ms)}
                  </Mono>
                </div>
              ))
            )}
          </ObPlate>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 0,
          }}>
          <ObPlate padding={12}>
            <ObRecordingPlate rec={rec} saved={recordingSaved} />
          </ObPlate>
          <ObPlate
            title="DIRECTOR'S NOTES"
            bar={OB.accent}
            scroll
            style={{ flex: 1 }}>
            {shownNotes ? (
              <Copy size={12} color='rgba(230,233,239,.88)' lineHeight={1.6}>
                {shownNotes}
              </Copy>
            ) : (
              <Meta size={9.5} tracking={0.06}>
                {state.llm.available
                  ? 'a short review of the show, written by Claude from the WHY log'
                  : 'LLM OFF — set ANTHROPIC_API_KEY on the server'}
              </Meta>
            )}
            {notesError ? <WarnPlate tone='bad'>{notesError}</WarnPlate> : null}
            <div>
              <ObButton
                size='sm'
                variant='ai'
                label={
                  notesBusy
                    ? 'WRITING…'
                    : shownNotes
                      ? 'REWRITE NOTES'
                      : 'GENERATE NOTES'
                }
                locked={notesBusy}
                disabled={!state.llm.available}
                onClick={() => void generate()}
              />
            </div>
          </ObPlate>
        </div>
      </div>
    </HostFrame>
  );
}
