'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  FbEventKind,
  FbTeamId,
  FbView,
  FbViewOverride,
} from '@smelter-editor/types';
import {
  FB_MINIMAP_SIZES,
  FB_PANO_VIEWS,
  FB_TRICAM_VIEWS,
} from '@smelter-editor/types';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import {
  FB,
  FbButton,
  FbPlate,
  FbRecordingPlate,
  Chip,
  Clock,
  ConfirmCard,
  Display,
  LedgerRow,
  Meta,
  Mono,
  PlateHead,
  RefCallCard,
  ScoreRow,
  Segment,
  StatusPill,
  TagChip,
  TeamStripe,
  Wordmark,
  useArmed,
} from '../fb-kit';
import {
  FileCamPicker,
  FileCamSyncButton,
  ROLE_LABEL,
  rolesForSession,
  useMp4Library,
} from '../file-cam-picker';
import {
  aiEventsChipLabel,
  aiEventsChipTitle,
  aiEventsChipTone,
} from '../ai-events-helpers';
import { aiLogTime, aiLogToneKey } from '../ai-log-helpers';
import { replayClip } from '../replay-helpers';
import { MANUAL_EVENT_KINDS, eventLabel } from '../fb-kit-helpers';
import { formatClock, matchClock } from '../use-fb-feed';
import type { FbPanelSocket } from './use-fb-panel-socket';
import { FollowTuningRows } from '../follow-tuning';

const COLUMN: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
};

const PLATE: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** PROGRAM monitor (WHEP, muted). */
function ProgramMonitor({ whepUrl }: { whepUrl: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!whepUrl) return;
    let closeConnection = () => {};
    let cancelled = false;
    void connectWhep(whepUrl).then(({ stream, close }) => {
      if (cancelled) {
        close();
        return;
      }
      closeConnection = close;
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      closeConnection();
    };
  }, [whepUrl]);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        background: 'radial-gradient(ellipse at 50% 85%,#1d3a2b,#0b1220 70%)',
        overflow: 'hidden',
      }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}

const VIEW_LABEL: Record<FbView, string> = {
  auto: 'AUTO',
  wide: 'WIDE',
  follow: 'FOLLOW',
  'left-goal': 'LEFT GOAL',
  'right-goal': 'RIGHT GOAL',
  left: 'LEFT CAM',
  centre: 'CENTRE CAM',
  right: 'RIGHT CAM',
};

function overrideFor(view: FbView): FbViewOverride {
  return view === 'auto' ? { mode: 'auto' } : { mode: 'view', view };
}

/**
 * The moderator panel: REF CALLS on top (goal candidates), then score +
 * clock + match flow, manual goals, views, the program monitor, cameras,
 * the ledger, the AI log and the tracking table. One column on phones, two
 * on a tablet/laptop, three on a wide screen — the panel takes the full width.
 */
export function PanelScreen({
  socket,
  name,
  whepUrl,
  roomId,
  narrow,
  columns,
}: {
  socket: FbPanelSocket;
  name: string;
  whepUrl: string | null;
  roomId: string;
  narrow: boolean;
  /** Desktop column count (ignored when `narrow`). */
  columns: 2 | 3;
}) {
  const rec = useKbtRecording(roomId, socket.state?.isRecording ?? false);
  const library = useMp4Library();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  const [monitorOpen, setMonitorOpen] = useState(!narrow);
  const confirm = useArmed(5000);

  // Keyboard shortcuts for the oldest pending call: A / B / N (no goal) / V.
  const pendingRef = useRef(socket.state?.pending ?? []);
  pendingRef.current = socket.state?.pending ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      )
        return;
      const top = pendingRef.current[0];
      if (!top) return;
      if (e.key === 'a' || e.key === 'A')
        socket.resolveEvent(top.id, { team: 'A' });
      else if (e.key === 'b' || e.key === 'B')
        socket.resolveEvent(top.id, { team: 'B' });
      else if (e.key === 'v' || e.key === 'V' || e.key === 'n' || e.key === 'N')
        socket.resolveEvent(top.id, { voided: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [socket]);

  const state = socket.state;
  const match = socket.match;
  const teams = state?.teams;
  const phase = state?.phase ?? 'lobby';
  const period = match?.period ?? 1;
  const clock =
    phase === 'ended'
      ? 'FT'
      : phase === 'halftime'
        ? 'HT'
        : phase === 'lobby'
          ? formatClock(0)
          : matchClock(match, socket.matchReceivedAt);
  const clockTone =
    phase === 'paused' ? 'amber' : phase === 'lobby' ? 'dim' : 'chalk';
  const tag =
    phase === 'paused'
      ? { tone: 'amber' as const, text: 'PAUSED' }
      : phase === 'ended'
        ? { tone: 'chalk' as const, text: 'FULL TIME' }
        : phase === 'halftime'
          ? { tone: 'chalk' as const, text: 'HALF TIME' }
          : phase === 'lobby'
            ? { tone: 'outline' as const, text: 'PRE-MATCH' }
            : {
                tone: 'electric' as const,
                text: period === 2 ? '2ND HALF' : '1ST HALF',
              };
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];
  const session = state?.session ?? null;
  const views: readonly FbView[] =
    session === 'pano'
      ? FB_PANO_VIEWS
      : session === 'tricam'
        ? FB_TRICAM_VIEWS
        : ['auto'];
  const activeView: FbView =
    state?.viewOverride?.mode === 'view' ? state.viewOverride.view : 'auto';
  const lastGoal =
    recent.find((e) => e.status === 'confirmed' && e.kind === 'goal') ?? null;
  const director = socket.director ?? state?.director ?? null;

  const headerPill =
    phase === 'paused' ? (
      <StatusPill tone='paused'>PAUSED</StatusPill>
    ) : phase === 'ended' ? (
      <StatusPill tone='chalk' dot={false}>
        FULL TIME
      </StatusPill>
    ) : phase === 'lobby' ? (
      <StatusPill tone='idle' dot={false}>
        PRE-MATCH
      </StatusPill>
    ) : phase === 'halftime' ? (
      <StatusPill tone='paused' dot={false}>
        HALF TIME
      </StatusPill>
    ) : (
      <StatusPill tone='live'>LIVE</StatusPill>
    );

  /* ── plates ── */

  const refCallPlate =
    pending.length > 0 && teams ? (
      <FbPlate
        cutPx={12}
        leftBar={6}
        leftBarColor={FB.amber}
        style={{ ...PLATE, paddingLeft: 20 }}>
        <PlateHead
          size={24}
          color={FB.amber}
          right={
            <Meta size={10} tracking={0.2}>
              {pending.length > 1
                ? 'OLDEST FIRST'
                : formatClock(pending[0].clockMs)}
            </Meta>
          }>
          REF CALL · {pending.length} WAITING
        </PlateHead>
        <RefCallCard
          event={pending[0]}
          teams={teams}
          index={0}
          total={pending.length}
          compact={!narrow}
          clockLabel={formatClock(pending[0].clockMs)}
          keysHint={narrow ? 'V' : 'A · B · N · V'}
          onAssign={(team) => socket.resolveEvent(pending[0].id, { team })}
          onVoid={() => socket.resolveEvent(pending[0].id, { voided: true })}
        />
        {pending.length > 1 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              borderTop: `1px solid ${FB.rule}`,
              paddingTop: 10,
            }}>
            {pending.slice(1).map((e, i) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  opacity: i === 0 ? 0.7 : 0.5,
                }}>
                <Mono size={12} tracking={0.1} color={FB.chalk}>
                  {i + 2} / {pending.length} · {formatClock(e.clockMs)} ·{' '}
                  {eventLabel(e.kind)} · {e.team ?? '?'}{' '}
                  {Math.round(e.aiConfidence * 100)}%
                </Mono>
                {i === 0 ? (
                  <Meta size={10} tracking={0.2}>
                    NEXT
                  </Meta>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </FbPlate>
    ) : (
      <FbPlate
        cutPx={12}
        leftBar={6}
        leftBarColor={FB.rule2}
        style={{
          ...PLATE,
          paddingLeft: 20,
          gap: 10,
          minHeight: 100,
          justifyContent: 'center',
        }}>
        <Display
          size={24}
          weight={800}
          tracking={0.04}
          style={{ opacity: 0.6 }}>
          REF CALL
        </Display>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: state?.aiEvents === 'armed' ? FB.good : FB.rule2,
            }}
          />
          <Mono size={12} tracking={0.2}>
            {state?.aiEvents === 'armed'
              ? 'NO CALLS WAITING · AI EVENTS ARMED'
              : 'NO CALLS WAITING · AI EVENTS ' +
                (state?.aiEvents ?? 'off').replace('_', ' ').toUpperCase()}
          </Mono>
        </div>
      </FbPlate>
    );

  const flowGrid = confirm.armed ? (
    <ConfirmCard
      key={confirm.armed}
      title={confirm.armed === 'end' ? 'FULL TIME?' : 'RESET THE MATCH?'}
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
        socket.sendMatch(id === 'end' ? 'end' : 'reset');
      }}
    />
  ) : (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns:
          narrow || columns === 3 ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: 8,
      }}>
      {phase === 'lobby' ? (
        <FbButton
          active
          label='KICK-OFF'
          onClick={() => socket.sendMatch('start')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'live' ? (
        <FbButton
          variant='chalk'
          label='PAUSE'
          onClick={() => socket.sendMatch('pause')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'paused' ? (
        <FbButton
          variant='good'
          active
          label='RESUME'
          onClick={() => socket.sendMatch('resume')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'halftime' ? (
        <FbButton
          variant='good'
          active
          label='SECOND HALF'
          onClick={() => socket.sendMatch('second_half')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {(phase === 'live' || phase === 'paused') && period === 1 ? (
        <FbButton
          variant='outline'
          label='HALF TIME'
          onClick={() => socket.sendMatch('half_time')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'ended' ? (
        <FbButton
          active
          label='NEW MATCH'
          onClick={() => socket.sendMatch('reset')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'live' || phase === 'paused' || phase === 'halftime' ? (
        <FbButton
          variant='outline'
          label={narrow ? 'FULL TIME' : 'END'}
          onClick={() => confirm.arm('end')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase !== 'ended' ? (
        <FbButton
          variant='danger'
          label='RESET'
          onClick={() => confirm.arm('reset')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
    </div>
  );

  const scoreFlowPlate = (
    <FbPlate cutPx={12} style={PLATE}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        <TagChip tone={tag.tone}>{tag.text}</TagChip>
        <Clock text={clock} size={34} tone={clockTone} />
      </div>
      {teams ? (
        <ScoreRow
          teams={teams}
          nameSize={22}
          scoreSize={38}
          stripe={{ w: 8, h: 30 }}
        />
      ) : null}
      {flowGrid}
    </FbPlate>
  );

  const eventsLocked = phase === 'lobby';
  const recentError =
    socket.lastError && Date.now() - socket.lastError.at < 6000
      ? socket.lastError
      : null;
  const manualPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          eventsLocked ? (
            <Meta size={10} tracking={0.18} color={FB.amber}>
              KICK OFF FIRST
            </Meta>
          ) : undefined
        }>
        MANUAL EVENTS
      </PlateHead>
      {teams ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['A', 'B'] as const).map((t) => (
            <div
              key={t}
              style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <TeamStripe color={teams[t].color} w={8} h={40} />
              <FbButton
                variant='outline'
                label={`GOAL ${teams[t].short}`}
                disabled={eventsLocked}
                onClick={() => socket.addEvent(t, 'goal')}
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  padding: '0 12px',
                  flex: 1.4,
                }}
              />
              {(
                MANUAL_EVENT_KINDS.filter((k) => k !== 'goal') as FbEventKind[]
              ).map((k) => (
                <Chip
                  key={k}
                  label={eventLabel(k)}
                  disabled={eventsLocked}
                  onClick={() => socket.addEvent(t, k)}
                  style={{
                    flex: 1,
                    height: 40,
                    minWidth: 0,
                    ...(narrow ? { padding: '0 4px' } : {}),
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <button
        type='button'
        className='fb-btn'
        onClick={() => socket.undoEvent()}
        style={{
          height: 44,
          background: 'none',
          border: 'none',
          color: FB.chalk,
          opacity: 0.8,
          fontFamily: 'inherit',
        }}>
        <Mono size={12} weight={600} tracking={0.2}>
          UNDO LAST GOAL
          {lastGoal && teams && lastGoal.team
            ? ` · ${teams[lastGoal.team].name}`
            : ''}
        </Mono>
      </button>
      {recentError ? (
        <Meta size={10} tracking={0.12} color={FB.amber}>
          {recentError.message.toUpperCase()}
        </Meta>
      ) : null}
    </FbPlate>
  );

  const viewGrid = (
    <>
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {views.map((v) => {
          const active = activeView === v;
          const disabled =
            session === 'tricam' &&
            v !== 'auto' &&
            !state?.cams[v as 'left' | 'centre' | 'right']?.fileName;
          return (
            <button
              key={v}
              type='button'
              className='fb-btn'
              data-variant={active ? 'solid' : 'segment'}
              disabled={disabled}
              onClick={() => socket.sendView(overrideFor(v))}
              style={{
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: active ? FB.chalk : 'transparent',
                color: active ? FB.dark : FB.chalk,
                border: active
                  ? '1px solid transparent'
                  : `1px solid ${FB.rule3}`,
                fontFamily: 'inherit',
                padding: '0 4px',
              }}>
              <Mono
                size={11}
                weight={active ? 600 : 400}
                tracking={0.14}
                color='inherit'
                style={{ textAlign: 'center' }}>
                {VIEW_LABEL[v]}
              </Mono>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip
          label={state?.config.replay ? 'REPLAY · ON' : 'REPLAY · OFF'}
          active={!!state?.config.replay}
          disabled={!state}
          title='Instant replay window after shots and goals'
          onClick={() => socket.setReplay(!state?.config.replay)}
        />
        <Chip
          label={state?.minimap ? 'MINIMAP · ON' : 'MINIMAP · OFF'}
          active={!!state?.minimap}
          disabled={!state}
          title='Tracking minimap on air'
          onClick={() => socket.setMinimap(!state?.minimap)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Meta size={10} tracking={0.16}>
            SIZE
          </Meta>
          <Segment
            height={28}
            fontSize={10}
            style={{
              width: 170,
              ...(state?.minimap
                ? {}
                : { pointerEvents: 'none', opacity: 0.5 }),
            }}
            options={FB_MINIMAP_SIZES.map((n) => ({
              value: n,
              label: String(n),
            }))}
            value={state?.config.minimapSize ?? 1}
            onChange={(v) => socket.setMinimapSize(v)}
          />
        </div>
      </div>
      {director ? (
        <Meta size={10} tracking={0.16}>
          DIRECTOR · {director.effectiveView.toUpperCase()}
          {director.crop
            ? ` · CROP ${director.crop.w}×${director.crop.h} @ ${director.crop.x},${director.crop.y}`
            : ''}
          {director.cam ? ` · ${director.cam.toUpperCase()} CAM` : ''} ·{' '}
          {director.ballTracked ? 'BALL TRACKED' : 'NO BALL'}
        </Meta>
      ) : null}
    </>
  );

  // Follow feel, live: the server clamps each knob and echoes it in the config.
  const tuningPlate =
    session === 'pano' && state ? (
      <FbPlate cutPx={12} style={{ ...PLATE, gap: 4 }}>
        <PlateHead
          size={22}
          right={
            <Meta size={10} tracking={0.2}>
              LIVE
            </Meta>
          }>
          FOLLOW TUNING
        </PlateHead>
        <FollowTuningRows
          director={state.config.director}
          onChange={socket.tuneDirector}
          controlHeight={30}
          row={(label, control) => (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                borderBottom: `1px solid ${FB.rule}`,
                padding: '6px 0',
                minHeight: 42,
              }}>
              <Meta size={10} tracking={0.14}>
                {label}
              </Meta>
              {control}
            </div>
          )}
        />
      </FbPlate>
    ) : null;

  const viewPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          <Meta size={10} tracking={0.2}>
            ON AIR:{' '}
            <span style={{ fontWeight: 600, color: FB.chalk }}>
              {(state?.scene ?? '—').toUpperCase()}
            </span>
          </Meta>
        }>
        VIEW
      </PlateHead>
      {viewGrid}
    </FbPlate>
  );

  const programPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          narrow ? (
            <Chip
              dense
              label={monitorOpen ? 'HIDE' : 'SHOW'}
              onClick={() => setMonitorOpen((o) => !o)}
            />
          ) : (
            <Meta size={10} tracking={0.2}>
              ON AIR:{' '}
              <span style={{ fontWeight: 600, color: FB.chalk }}>
                {(state?.scene ?? '—').toUpperCase()}
              </span>
            </Meta>
          )
        }>
        PROGRAM
      </PlateHead>
      {monitorOpen ? (
        <>
          <ProgramMonitor whepUrl={whepUrl} />
          {!narrow ? viewGrid : null}
        </>
      ) : null}
    </FbPlate>
  );

  const roles = session
    ? rolesForSession(session)
    : (['pano', 'left', 'centre', 'right'] as const);
  const camerasPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 8 }}>
      <PlateHead
        size={22}
        right={
          rec.effectiveIsRecording ? (
            <StatusPill tone='rec' size={9}>
              REC
            </StatusPill>
          ) : undefined
        }>
        CAMERAS
      </PlateHead>
      {roles.map((role) => {
        const cam = state?.cams[role];
        const live = !!cam?.connected;
        return (
          <div
            key={role}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: `1px solid ${FB.rule}`,
              paddingTop: 8,
            }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
              }}>
              <Mono
                size={12}
                weight={600}
                tracking={0.1}
                style={{ width: 96, flexShrink: 0 }}>
                {ROLE_LABEL[role]}
              </Mono>
              <Mono
                size={10}
                weight={600}
                tracking={0.2}
                color={!cam?.fileName ? FB.chalk : live ? FB.good : FB.amber}
                style={{
                  opacity: cam?.fileName ? 1 : 0.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                {!cam?.fileName
                  ? '○ NO CLIP'
                  : live
                    ? `● LIVE · ${cam.fileName}`
                    : `◌ CONNECTING · ${cam.fileName}`}
              </Mono>
              {cam?.fileName ? (
                <Chip
                  dense
                  tone='danger'
                  label='KICK'
                  onClick={() => socket.sendMatch('kick_cam', role)}
                  style={{ marginLeft: 'auto' }}
                />
              ) : null}
            </div>
            <FileCamPicker
              dense
              roomId={roomId}
              role={role}
              cams={state?.cams}
              files={library.files}
              loading={library.loading}
            />
          </div>
        );
      })}
      <FileCamSyncButton
        dense
        roomId={roomId}
        cams={state?.cams}
        onReload={() => library.reload()}
      />
      <FbRecordingPlate rec={rec} />
    </FbPlate>
  );

  const ledgerPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 4, paddingBottom: 8 }}>
      <PlateHead
        size={22}
        right={
          <Chip dense label='UNDO LAST' onClick={() => socket.undoEvent()} />
        }
        style={{ marginBottom: 4 }}>
        LEDGER
      </PlateHead>
      {recent.length === 0 ? (
        <Meta size={10} tracking={0.16} style={{ padding: '8px 0' }}>
          nothing yet
        </Meta>
      ) : null}
      {teams
        ? recent.map((e) => (
            <LedgerRow
              key={e.id}
              event={e}
              teams={teams}
              dense
              scale={0.9}
              onAssign={(team) => socket.resolveEvent(e.id, { team })}
              onVoid={() => socket.resolveEvent(e.id, { voided: true })}
            />
          ))
        : null}
    </FbPlate>
  );

  const ai = state?.aiEvents ?? 'off';
  const aiHasClip = !!replayClip(state?.cams);
  const run = state?.aiRun ?? null;
  const aiLogPlate = (
    <FbPlate
      cutPx={12}
      texture='lines'
      style={{ ...PLATE, gap: 6, paddingBottom: 8 }}>
      <PlateHead
        size={22}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {run ? (
              <Meta size={10} tracking={0.16}>
                {run.fired}/{run.total} · NEXT{' '}
                {run.nextFireInMs != null
                  ? `${Math.ceil(run.nextFireInMs / 1000)} S`
                  : '—'}
              </Meta>
            ) : null}
            <Chip
              dense
              tone={aiEventsChipTone(ai)}
              active={ai !== 'off'}
              label={aiEventsChipLabel(ai)}
              title={aiEventsChipTitle(ai, aiHasClip)}
              onClick={() => socket.setAiEvents(ai === 'off')}
            />
          </div>
        }
        style={{ marginBottom: 2 }}>
        AI LOG
      </PlateHead>
      {socket.aiLog.length === 0 ? (
        <Meta size={10} tracking={0.16} style={{ padding: '8px 0' }}>
          nothing yet — attach a clip with telemetry
        </Meta>
      ) : null}
      <div
        className='fb-scroll'
        style={{
          maxHeight: !narrow && columns === 3 ? 520 : 340,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
        {socket.aiLog.map((e) => (
          <div
            key={e.id}
            className='fb-enter'
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              padding: '5px 0',
              borderTop: `1px solid ${FB.rule}`,
            }}>
            <Mono
              size={10}
              color={FB.dim}
              style={{ flexShrink: 0, width: 44, textAlign: 'right' }}>
              {aiLogTime(e.atMs, Date.now())}
            </Mono>
            <Mono
              size={11}
              weight={600}
              tracking={0.08}
              color={FB[aiLogToneKey(e.tone)]}
              style={{ flexShrink: 0, width: 78 }}>
              {e.label}
            </Mono>
            <div
              style={{
                minWidth: 0,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}>
              <Mono
                size={11}
                color={FB.chalk}
                uppercase={false}
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                {e.text}
              </Mono>
              {e.detail ? (
                <Mono
                  size={9}
                  tracking={0.04}
                  color={FB.dim}
                  uppercase={false}
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                  {e.detail}
                </Mono>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </FbPlate>
  );

  const tracking = state?.tracking ?? [];
  const trackingPlate = (
    <FbPlate cutPx={12} style={{ ...PLATE, gap: 4, paddingBottom: 8 }}>
      <PlateHead
        size={22}
        right={
          <Meta size={10} tracking={0.2}>
            {teams?.A.short ?? 'HOME'} · TAGGED PLAYERS
          </Meta>
        }
        style={{ marginBottom: 4 }}>
        TRACKING
      </PlateHead>
      {tracking.length === 0 ? (
        <Meta size={10} tracking={0.16} style={{ padding: '8px 0' }}>
          no player telemetry
        </Meta>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr 1fr 1fr',
            gap: '4px 12px',
            alignItems: 'baseline',
          }}>
          <Meta size={9} tracking={0.16}>
            TAG
          </Meta>
          <Meta size={9} tracking={0.16}>
            TOP KM/H
          </Meta>
          <Meta size={9} tracking={0.16}>
            METRES
          </Meta>
          <Meta size={9} tracking={0.16}>
            SPRINTS
          </Meta>
          {tracking.slice(0, 14).map((t) => (
            <React.Fragment key={t.tag}>
              <Mono size={12} weight={600}>
                #{t.tag}
              </Mono>
              <Mono size={12}>{t.topKmh.toFixed(1)}</Mono>
              <Mono size={12}>{t.meters}</Mono>
              <Mono size={12}>{t.sprints}</Mono>
            </React.Fragment>
          ))}
        </div>
      )}
    </FbPlate>
  );

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 4px',
      }}>
      <Wordmark size={28} />
      {!narrow ? (
        <Meta size={10} tracking={0.22}>
          MODERATOR · {name.toUpperCase()} · ROOM {roomId.slice(0, 8)}
        </Meta>
      ) : null}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {headerPill}
      </div>
    </div>
  );

  if (narrow) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          paddingBottom: 24,
        }}>
        {header}
        {refCallPlate}
        {scoreFlowPlate}
        {manualPlate}
        {viewPlate}
        {tuningPlate}
        {programPlate}
        {camerasPlate}
        {ledgerPlate}
        {aiLogPlate}
        {trackingPlate}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingBottom: 24,
      }}>
      {header}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 16,
          alignItems: 'start',
        }}>
        {columns === 3 ? (
          <>
            <div style={COLUMN}>
              {refCallPlate}
              {scoreFlowPlate}
              {manualPlate}
              {trackingPlate}
            </div>
            <div style={COLUMN}>
              {programPlate}
              {tuningPlate}
              {camerasPlate}
            </div>
            <div style={COLUMN}>
              {ledgerPlate}
              {aiLogPlate}
            </div>
          </>
        ) : (
          <>
            <div style={COLUMN}>
              {refCallPlate}
              {scoreFlowPlate}
              {manualPlate}
              {trackingPlate}
            </div>
            <div style={COLUMN}>
              {programPlate}
              {tuningPlate}
              {ledgerPlate}
              {aiLogPlate}
              {camerasPlate}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
