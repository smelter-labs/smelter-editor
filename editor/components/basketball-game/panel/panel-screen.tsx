'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  BbSceneName,
  BbShotEvent,
  BbTeamId,
  BbViewOverride,
} from '@smelter-editor/types';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  pointToVideoNorm,
  sampleVideoColorAt,
} from '@/lib/arcade/color-sample';
import { resolveMediaUrl } from '@/lib/server-url';
import type { CommentatorRig } from '@/components/kettlebell-tournament/panel/use-commentator-rig';
import type { CamRecovery } from '@/components/kettlebell-tournament/panel/use-cam-recovery';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import {
  BB,
  BbButton,
  BbPlate,
  BbRecordingPlate,
  Chip,
  Clock,
  ConfirmCard,
  Display,
  LedgerRow,
  Meta,
  MicMeter,
  Mono,
  PlateHead,
  RefCallCard,
  ScoreRow,
  StatusPill,
  TagChip,
  TeamStripe,
  TeamSwatch,
  Wordmark,
  useArmed,
} from '../bb-kit';
import {
  FileCamPicker,
  FileCamSyncButton,
  camSourceLabel,
  useMp4Library,
} from '../file-cam-picker';
import { ReplayControl, useBbEventsLibrary } from '../replay-control';
import { formatClock, remainingNow } from '../use-bb-feed';
import type { BbPanelSocket } from './use-bb-panel-socket';

const PLATE: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** PROGRAM monitor (WHEP, muted) that also serves as the colour sampler. */
function ProgramMonitor({
  whepUrl,
  onSample,
  sampling,
}: {
  whepUrl: string | null;
  onSample?: (hex: string) => void;
  sampling: BbTeamId | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

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
      ref={boxRef}
      onClick={(e) => {
        if (!sampling || !onSample || !videoRef.current || !boxRef.current)
          return;
        const p = pointToVideoNorm(
          boxRef.current,
          videoRef.current,
          e.clientX,
          e.clientY,
        );
        if (!p) return;
        const hex = sampleVideoColorAt(videoRef.current, p.nx, p.ny);
        if (hex) onSample(hex);
      }}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        background: 'radial-gradient(ellipse at 50% 85%,#3a3a3e,#1c1c1f 70%)',
        outline: sampling ? `2px dashed ${BB.electric}` : undefined,
        outlineOffset: 2,
        cursor: sampling ? 'crosshair' : undefined,
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
      {sampling ? (
        <span
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            background: BB.plate,
            padding: '3px 8px',
          }}>
          <Mono size={10} weight={600} tracking={0.2}>
            TAP A TEAM {sampling} JERSEY
          </Mono>
        </span>
      ) : null}
    </div>
  );
}

const VIEWS: { key: BbSceneName | 'auto'; label: string }[] = [
  { key: 'auto', label: 'AUTO' },
  { key: 'live', label: 'COURT + HOOP' },
  { key: 'hoop', label: 'HOOP CAM' },
  { key: 'court', label: 'COURT CAM' },
  { key: 'caster', label: 'MY CAMERA' },
  { key: 'split', label: 'COURT + ME' },
];

function overrideFor(key: BbSceneName | 'auto'): BbViewOverride {
  if (key === 'auto' || key === 'lobby' || key === 'ended' || key === 'replay')
    return { mode: 'auto' };
  return { mode: 'scene', scene: key };
}

/** Clock label for a shot ("06:31"), from the match clock at the make. */
function shotClockLabel(
  shot: BbShotEvent,
  durationMs: number | undefined,
  matchStartAt: number | null,
): string | undefined {
  if (!durationMs || matchStartAt == null) return undefined;
  const remaining = durationMs - (shot.atMs - matchStartAt);
  if (remaining < 0 || remaining > durationMs) return undefined;
  return formatClock(remaining);
}

/**
 * The courtside panel: REF CALL on top (big A / B / NO BASKET targets),
 * then score + clock + match flow, manual points, views, the program
 * monitor + jersey colour sampling, the rig (when on air), cameras +
 * recording and the ledger. One column on phones, two on a tablet/laptop.
 */
export function PanelScreen({
  socket,
  rig,
  recovery,
  name,
  whepUrl,
  roomId,
  narrow,
}: {
  socket: BbPanelSocket;
  rig: CommentatorRig;
  recovery: CamRecovery;
  name: string;
  whepUrl: string | null;
  roomId: string;
  narrow: boolean;
}) {
  const rec = useKbtRecording(roomId, socket.state?.isRecording ?? false);
  const library = useMp4Library();
  const events = useBbEventsLibrary();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  const [sampling, setSampling] = useState<BbTeamId | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(!narrow);
  const confirm = useArmed(5000);

  // Keyboard shortcuts for the oldest pending call: A / B / N (no basket) / V.
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
        socket.resolveShot(top.id, { team: 'A' });
      else if (e.key === 'b' || e.key === 'B')
        socket.resolveShot(top.id, { team: 'B' });
      else if (e.key === 'v' || e.key === 'V' || e.key === 'n' || e.key === 'N')
        socket.resolveShot(top.id, { voided: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [socket]);

  const state = socket.state;
  const match = socket.match;
  const teams = state?.teams;
  const phase = state?.phase ?? 'lobby';
  const remaining = remainingNow(match, socket.matchReceivedAt);
  const clock =
    phase === 'overtime'
      ? 'OT'
      : phase === 'ended'
        ? 'FINAL'
        : phase === 'lobby'
          ? formatClock(state?.config.durationMs ?? 600_000)
          : formatClock(remaining);
  const clockTone =
    phase === 'paused'
      ? 'amber'
      : phase === 'overtime'
        ? 'electric'
        : phase === 'live' && remaining <= 10_000
          ? 'bad'
          : phase === 'lobby'
            ? 'dim'
            : 'chalk';
  const tag =
    phase === 'paused'
      ? { tone: 'amber' as const, text: 'PAUSED' }
      : phase === 'overtime'
        ? {
            tone: 'electric' as const,
            text: 'FIRST TO +' + (state?.config.otWinPoints ?? 2),
          }
        : phase === 'ended'
          ? {
              tone: 'chalk' as const,
              text: match?.period === 'ot' ? 'AFTER OT' : 'FULL TIME',
            }
          : phase === 'lobby'
            ? { tone: 'outline' as const, text: 'WARM-UP' }
            : { tone: 'electric' as const, text: 'REG' };
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];
  const activeView: BbSceneName | 'auto' =
    state?.viewOverride?.mode === 'scene' ? state.viewOverride.scene : 'auto';
  const casterReady = state?.commentator?.camConnected ?? false;
  const arc = (state?.config.arcPoints ?? 2) as 1 | 2;
  const lastMake = recent.find((s) => s.status === 'confirmed') ?? null;
  const matchStartAt =
    match && phase !== 'lobby' && match.elapsedMs != null
      ? socket.matchReceivedAt - match.elapsedMs
      : null;

  const headerPill =
    phase === 'paused' ? (
      <StatusPill tone='paused'>PAUSED</StatusPill>
    ) : phase === 'ended' ? (
      <StatusPill tone='chalk' dot={false}>
        FINAL
      </StatusPill>
    ) : phase === 'lobby' ? (
      <StatusPill tone='idle' dot={false}>
        COURT OPEN
      </StatusPill>
    ) : (
      <StatusPill tone='live'>LIVE</StatusPill>
    );

  /* ── plates ── */

  const refCallPlate =
    pending.length > 0 && teams ? (
      <BbPlate
        cutPx={12}
        leftBar={6}
        leftBarColor={BB.amber}
        style={{ ...PLATE, paddingLeft: 20 }}>
        <PlateHead
          size={24}
          color={BB.amber}
          right={
            <Meta size={10} tracking={0.2}>
              {pending.length > 1
                ? 'OLDEST FIRST'
                : (shotClockLabel(
                    pending[0],
                    state?.config.durationMs,
                    matchStartAt,
                  ) ?? '')}
            </Meta>
          }>
          REF CALL · {pending.length} WAITING
        </PlateHead>
        <RefCallCard
          shot={pending[0]}
          teams={teams}
          index={0}
          total={pending.length}
          arcPoints={arc}
          compact={!narrow}
          clockLabel={
            pending.length > 1
              ? shotClockLabel(
                  pending[0],
                  state?.config.durationMs,
                  matchStartAt,
                )
              : undefined
          }
          keysHint={narrow ? 'V' : 'A · B · N · V'}
          stillUrl={
            pending[0].releaseFrameUrl || pending[0].frameUrl
              ? resolveMediaUrl(
                  (pending[0].releaseFrameUrl ?? pending[0].frameUrl) as string,
                )
              : null
          }
          onAssign={(team) => socket.resolveShot(pending[0].id, { team })}
          onPoints={(points) => socket.resolveShot(pending[0].id, { points })}
          onVoid={() => socket.resolveShot(pending[0].id, { voided: true })}
        />
        {pending.length > 1 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              borderTop: `1px solid ${BB.rule}`,
              paddingTop: 10,
            }}>
            {pending.slice(1).map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  opacity: i === 0 ? 0.7 : 0.5,
                }}>
                <Mono size={12} tracking={0.1} color={BB.chalk}>
                  {i + 2} / {pending.length} ·{' '}
                  {shotClockLabel(s, state?.config.durationMs, matchStartAt) ??
                    `#${s.index}`}{' '}
                  · AI: {s.aiTeam ?? '?'} {Math.round(s.aiConfidence * 100)}%
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
      </BbPlate>
    ) : (
      <BbPlate
        cutPx={12}
        leftBar={6}
        leftBarColor={BB.rule2}
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
              background: state?.cams.hoop.camConnected ? BB.good : BB.rule2,
            }}
          />
          <Mono size={12} tracking={0.2}>
            {state?.cams.hoop.camConnected
              ? 'NO CALLS WAITING · AI IS SURE'
              : 'NO CALLS WAITING · HOOP CAM DOWN'}
          </Mono>
        </div>
      </BbPlate>
    );

  const flowGrid = confirm.armed ? (
    <ConfirmCard
      key={confirm.armed}
      title={confirm.armed === 'end' ? 'END THE MATCH?' : 'RESET THE MATCH?'}
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
        socket.sendMatch(id === 'end' ? 'end' : 'reset');
      }}
    />
  ) : (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(4, 1fr)',
        gap: 8,
      }}>
      {phase === 'lobby' ? (
        <BbButton
          active
          label='TIP-OFF'
          onClick={() => socket.sendMatch('start')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'live' || phase === 'overtime' ? (
        <BbButton
          variant='chalk'
          label='PAUSE'
          onClick={() => socket.sendMatch('pause')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'paused' ? (
        <BbButton
          variant='good'
          active
          label='RESUME'
          onClick={() => socket.sendMatch('resume')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'ended' ? (
        <BbButton
          active
          label='NEW MATCH'
          onClick={() => socket.sendMatch('reset')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase !== 'ended' && phase !== 'lobby' ? (
        <BbButton
          variant='outline'
          label='OVERTIME'
          dimmed={phase === 'overtime'}
          disabled={phase === 'overtime'}
          onClick={() => socket.sendMatch('start_overtime')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase === 'live' || phase === 'paused' || phase === 'overtime' ? (
        <BbButton
          variant='outline'
          label={narrow ? 'END MATCH' : 'END'}
          onClick={() => confirm.arm('end')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
      {phase !== 'ended' ? (
        <BbButton
          variant='danger'
          label='RESET'
          onClick={() => confirm.arm('reset')}
          style={{ fontSize: 22, padding: 0 }}
        />
      ) : null}
    </div>
  );

  const scoreFlowPlate = (
    <BbPlate cutPx={12} style={PLATE}>
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
    </BbPlate>
  );

  const pointsLocked = phase === 'lobby' || phase === 'ended';
  const recentError =
    socket.lastError && Date.now() - socket.lastError.at < 6000
      ? socket.lastError
      : null;
  const manualPointsPlate = (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          pointsLocked ? (
            <Meta size={10} tracking={0.18} color={BB.amber}>
              {phase === 'lobby' ? 'START THE MATCH FIRST' : 'MATCH ENDED'}
            </Meta>
          ) : undefined
        }>
        MANUAL POINTS
      </PlateHead>
      {teams ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: narrow
              ? 'auto 1fr 1fr'
              : 'auto 1fr 1fr auto 1fr 1fr',
            gap: 8,
            alignItems: 'center',
          }}>
          {(['A', 'B'] as const).map((t) => (
            <React.Fragment key={t}>
              <TeamStripe
                color={teams[t].color}
                w={8}
                h={44}
                style={{ marginLeft: t === 'B' && !narrow ? 8 : 0 }}
              />
              <BbButton
                variant='outline'
                label='+1'
                disabled={pointsLocked}
                onClick={() => socket.addShot(t, 1)}
                style={{ fontSize: 26, fontWeight: 800, padding: 0 }}
              />
              <BbButton
                variant='outline'
                label={`+${arc}`}
                keyBadge={arc === 2 ? 'ARC' : undefined}
                disabled={pointsLocked}
                onClick={() => socket.addShot(t, arc)}
                style={{ fontSize: 26, fontWeight: 800, padding: 0, gap: 8 }}
              />
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <button
        type='button'
        className='bb-btn'
        onClick={() => socket.undoShot()}
        style={{
          height: 44,
          background: 'none',
          border: 'none',
          color: BB.chalk,
          opacity: 0.8,
          fontFamily: 'inherit',
        }}>
        <Mono size={12} weight={600} tracking={0.2}>
          UNDO LAST MAKE
          {lastMake && teams && lastMake.team
            ? ` · +${lastMake.points} ${teams[lastMake.team].name}`
            : ''}
        </Mono>
      </button>
      {recentError ? (
        <Meta size={10} tracking={0.12} color={BB.amber}>
          {recentError.message.toUpperCase()}
        </Meta>
      ) : null}
    </BbPlate>
  );

  const viewGrid = (
    <>
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {VIEWS.map((v) => {
          const needsCaster = v.key === 'caster' || v.key === 'split';
          const needsHoop = v.key === 'hoop';
          const needsCourt = v.key === 'court';
          const disabled =
            (needsCaster && !casterReady) ||
            (needsHoop && !state?.cams.hoop.joined) ||
            (needsCourt && !state?.cams.court.joined);
          const active = activeView === v.key;
          return (
            <button
              key={v.key}
              type='button'
              className='bb-btn'
              data-variant={active ? 'solid' : 'segment'}
              disabled={disabled}
              onClick={() => socket.sendView(overrideFor(v.key))}
              style={{
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: active ? BB.chalk : 'transparent',
                color: active ? BB.dark : BB.chalk,
                border: active
                  ? '1px solid transparent'
                  : `1px solid ${BB.rule3}`,
                fontFamily: 'inherit',
                padding: '0 4px',
              }}>
              <Mono
                size={11}
                weight={active ? 600 : 400}
                tracking={0.14}
                color='inherit'
                style={{ textAlign: 'center' }}>
                {v.label}
              </Mono>
            </button>
          );
        })}
      </div>
      <Chip
        label={state?.casterPip ? 'MY CAM PIP · ON' : 'MY CAM PIP · OFF'}
        active={!!state?.casterPip}
        disabled={!casterReady}
        onClick={() => socket.setCasterPip(!state?.casterPip)}
        style={{ alignSelf: 'flex-start' }}
      />
    </>
  );

  const viewPlate = (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          <Meta size={10} tracking={0.2}>
            ON AIR:{' '}
            <span style={{ fontWeight: 600, color: BB.chalk }}>
              {(state?.scene ?? '—').toUpperCase()}
            </span>
          </Meta>
        }>
        VIEW
      </PlateHead>
      {viewGrid}
    </BbPlate>
  );

  const programPlate = (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
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
              <span style={{ fontWeight: 600, color: BB.chalk }}>
                {(state?.scene ?? '—').toUpperCase()}
              </span>
              {' · MY CAM PIP '}
              <span
                style={{
                  fontWeight: 600,
                  color: state?.casterPip ? BB.good : BB.chalk,
                }}>
                {state?.casterPip ? 'ON' : 'OFF'}
              </span>
            </Meta>
          )
        }>
        {narrow ? 'PROGRAM · JERSEY COLOURS' : 'PROGRAM'}
      </PlateHead>
      {monitorOpen ? (
        <>
          <ProgramMonitor
            whepUrl={whepUrl}
            sampling={sampling}
            onSample={(hex) => {
              if (sampling) socket.setTeamColor(sampling, hex);
              setSampling(null);
            }}
          />
          {teams ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {(['A', 'B'] as const).map((t) => (
                <Chip
                  key={t}
                  label={sampling === t ? 'TAP THE JERSEY…' : `PICK ${t}`}
                  active={sampling === t}
                  leading={<TeamStripe color={teams[t].color} w={10} h={18} />}
                  onClick={() => setSampling(sampling === t ? null : t)}
                  style={{ flex: 1, height: 44 }}
                />
              ))}
            </div>
          ) : null}
          {!narrow ? viewGrid : null}
        </>
      ) : null}
    </BbPlate>
  );

  const rigPlate = rig.camOn ? (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 10 }}>
      <PlateHead
        size={22}
        right={
          rig.live ? (
            <StatusPill tone='onair' size={9}>
              ON AIR
            </StatusPill>
          ) : recovery.restoring ? (
            <StatusPill tone='paused' size={9}>
              RESTORING…
            </StatusPill>
          ) : (
            <StatusPill tone='idle' size={9}>
              OFFLINE
            </StatusPill>
          )
        }>
        RIG
      </PlateHead>
      <div style={{ display: 'flex', gap: 10 }}>
        <video
          autoPlay
          playsInline
          muted
          ref={rig.attachPreview}
          style={{
            width: 96,
            height: 72,
            objectFit: 'cover',
            background:
              'radial-gradient(ellipse at 50% 30%,#3d3a36,#18181a 75%)',
            transform: 'scaleX(-1)',
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            justifyContent: 'center',
            minWidth: 0,
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Meta size={10} tracking={0.2}>
              MIC · {name.toUpperCase()}
            </Meta>
            {rig.muted ? (
              <Meta size={10} tracking={0.2} weight={600} color={BB.bad}>
                MUTED
              </Meta>
            ) : null}
          </div>
          <MicMeter level={rig.micLevel} muted={rig.muted} />
          <div style={{ display: 'flex', gap: 6 }}>
            <Chip
              label={rig.muted ? 'UNMUTE' : 'MUTE'}
              tone={rig.muted ? 'bad' : 'default'}
              onClick={rig.toggleMute}
              style={{ flex: 1 }}
            />
            <Chip
              label='RESTART CAM'
              onClick={recovery.restartCamera}
              style={{ flex: 1 }}
            />
          </div>
        </div>
      </div>
      {rig.camErr ? (
        <Meta size={10} tracking={0.1} color={BB.bad}>
          {rig.camErr}
        </Meta>
      ) : null}
    </BbPlate>
  ) : null;

  const camerasPlate = (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 8 }}>
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
      {(['hoop', 'court'] as const).map((role) => {
        const cam = state?.cams[role];
        const live = !!cam?.camConnected;
        return (
          <div
            key={role}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: `1px solid ${BB.rule}`,
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
                style={{ width: 52, flexShrink: 0 }}>
                {role.toUpperCase()}
              </Mono>
              <Mono
                size={10}
                weight={600}
                tracking={0.2}
                color={!cam?.joined ? BB.chalk : live ? BB.good : BB.amber}
                style={{
                  opacity: cam?.joined ? 1 : 0.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                {!cam?.joined
                  ? '○ WAITING'
                  : live
                    ? `● LIVE · ${camSourceLabel(cam)}`
                    : `◌ CONNECTING · ${camSourceLabel(cam)}`}
              </Mono>
              {role === 'hoop' && cam?.joined ? (
                <Meta
                  size={10}
                  tracking={0.18}
                  color={cam.calibrated ? BB.dim : BB.amber}>
                  {cam.calibrated
                    ? cam.ballTracked
                      ? 'BALL'
                      : 'RIM SET'
                    : 'RIM NOT CALIBRATED'}
                </Meta>
              ) : null}
              {cam?.joined ? (
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
        onReload={() => {
          library.reload();
          events.reload();
        }}
      />
      <ReplayControl
        dense
        roomId={roomId}
        cams={state?.cams}
        replay={state?.replay}
        files={events.files}
        loading={events.loading}
      />
      <BbRecordingPlate rec={rec} />
    </BbPlate>
  );

  const ledgerPlate = (
    <BbPlate cutPx={12} style={{ ...PLATE, gap: 4, paddingBottom: 8 }}>
      <PlateHead
        size={22}
        right={
          <Chip dense label='UNDO LAST' onClick={() => socket.undoShot()} />
        }
        style={{ marginBottom: 4 }}>
        LEDGER
      </PlateHead>
      {recent.length === 0 ? (
        <Meta size={10} tracking={0.16} style={{ padding: '8px 0' }}>
          no makes yet
        </Meta>
      ) : null}
      {teams
        ? recent.map((s) => (
            <LedgerRow
              key={s.id}
              shot={s}
              teams={teams}
              dense
              scale={0.9}
              onAssign={(team) => socket.resolveShot(s.id, { team })}
              onPoints={(points) => socket.resolveShot(s.id, { points })}
              onVoid={() => socket.resolveShot(s.id, { voided: true })}
            />
          ))
        : null}
    </BbPlate>
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
        {!narrow && rig.live ? (
          <StatusPill tone='onair'>ON AIR</StatusPill>
        ) : null}
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
        {manualPointsPlate}
        {viewPlate}
        {programPlate}
        {rigPlate}
        {camerasPlate}
        {ledgerPlate}
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
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          alignItems: 'start',
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {refCallPlate}
          {scoreFlowPlate}
          {manualPointsPlate}
          {rigPlate}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {programPlate}
          {ledgerPlate}
          {camerasPlate}
        </div>
      </div>
    </div>
  );
}
