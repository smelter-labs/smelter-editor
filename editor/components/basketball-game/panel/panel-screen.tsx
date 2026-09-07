'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  BbSceneName,
  BbTeamId,
  BbViewOverride,
} from '@smelter-editor/types';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  pointToVideoNorm,
  sampleVideoColorAt,
} from '@/lib/arcade/color-sample';
import {
  Bar,
  ChipButton,
  ConfirmRail,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import type { CommentatorRig } from '@/components/kettlebell-tournament/panel/use-commentator-rig';
import type { CamRecovery } from '@/components/kettlebell-tournament/panel/use-cam-recovery';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import { RecordingPlate } from '@/components/kettlebell-tournament/recording-control';
import { ScoreLine, ShotRow, TeamSwatch } from '../bb-kit';
import { formatClock, remainingNow } from '../use-bb-feed';
import type { BbPanelSocket } from './use-bb-panel-socket';

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
        background: '#000',
        border: `1px solid ${sampling ? KBT.amber : KBT.border}`,
        cursor: sampling ? 'crosshair' : undefined,
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
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <Tab size={10} color={KBT.amber} textColor={KBT.dark}>
            TAP A TEAM {sampling} JERSEY
          </Tab>
        </div>
      ) : null}
    </div>
  );
}

const VIEWS: { key: BbSceneName | 'auto'; label: string; sub: string }[] = [
  { key: 'auto', label: 'AUTO', sub: 'follows the game' },
  { key: 'live', label: 'COURT + HOOP', sub: 'the live layout' },
  { key: 'hoop', label: 'HOOP CAM', sub: 'fullscreen' },
  { key: 'court', label: 'COURT CAM', sub: 'fullscreen' },
  { key: 'caster', label: 'MY CAMERA', sub: 'you, fullscreen' },
  { key: 'split', label: 'COURT + ME', sub: 'side by side' },
];

function overrideFor(key: BbSceneName | 'auto'): BbViewOverride {
  if (key === 'auto' || key === 'lobby' || key === 'ended' || key === 'score')
    return { mode: 'auto' };
  return { mode: 'scene', scene: key };
}

/**
 * The courtside panel: pending calls on top (big A / B / VOID targets),
 * then score + clock + match flow, manual points, views, the rig (when on
 * air), colour sampling and the ledger. Single column on phones, a 2-column
 * grid on wider screens.
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
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  const [sampling, setSampling] = useState<BbTeamId | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(!narrow);

  // Keyboard shortcuts for the newest pending call: A / B / V.
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
      else if (e.key === 'v' || e.key === 'V')
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
          ? '—'
          : formatClock(remaining);
  const pending = state?.pending ?? [];
  const recent = state?.recent ?? [];
  const activeView: BbSceneName | 'auto' =
    state?.viewOverride?.mode === 'scene' ? state.viewOverride.scene : 'auto';
  const casterReady = state?.commentator?.camConnected ?? false;
  const arc = (state?.config.arcPoints ?? 2) as 1 | 2;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
        gap: 10,
        alignItems: 'start',
        paddingBottom: 24,
      }}>
      {/* ── pending calls ── */}
      <Plate
        cutPx={14}
        accentBar
        accentColor={pending.length ? KBT.amber : KBT.border}
        style={{ gridColumn: narrow ? undefined : '1 / -1' }}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
        }}>
        <PlateTitle
          color={pending.length ? KBT.amber : undefined}
          right={
            <Label size={9} tracking={1.5}>
              keys: A · B · V(oid)
            </Label>
          }>
          {pending.length
            ? `REF CALL · ${pending.length} WAITING`
            : 'NO CALLS WAITING'}
        </PlateTitle>
        {teams
          ? pending.map((s) => (
              <div
                key={s.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ShotRow shot={s} teams={teams} dense />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8,
                  }}>
                  {(['A', 'B'] as const).map((t) => (
                    <button
                      key={t}
                      type='button'
                      className='kbt-btn'
                      onClick={() => socket.resolveShot(s.id, { team: t })}
                      style={{
                        minHeight: 56,
                        background: teams[t].color,
                        color: '#141416',
                        fontFamily: 'var(--font-kbt-display)',
                        fontWeight: 800,
                        fontSize: 20,
                        letterSpacing: 1.5,
                        border: 'none',
                      }}>
                      {teams[t].name.toUpperCase()}
                    </button>
                  ))}
                  <KbtButton
                    variant='danger'
                    label='NO BASKET'
                    sub='void this call'
                    onClick={() => socket.resolveShot(s.id, { voided: true })}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Label size={9} tracking={1.5}>
                    VALUE
                  </Label>
                  <ChipButton
                    dense
                    label='1 PT'
                    active={s.points === 1}
                    onClick={() => socket.resolveShot(s.id, { points: 1 })}
                  />
                  <ChipButton
                    dense
                    label='2 PT · ARC'
                    active={s.points === 2}
                    onClick={() => socket.resolveShot(s.id, { points: 2 })}
                  />
                  {s.releaseFrameUrl || s.frameUrl ? (
                    <Label size={9} tracking={1}>
                      · stills saved
                    </Label>
                  ) : null}
                </div>
              </div>
            ))
          : null}
      </Plate>

      {/* ── score, clock, flow ── */}
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '10px 12px',
        }}>
        <PlateTitle
          right={
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 22,
                fontWeight: 600,
                color: phase === 'paused' ? KBT.amber : KBT.cream,
              }}>
              {clock}
            </span>
          }>
          {phase.toUpperCase()}
          {match?.period === 'ot' ? ' · OT' : ''}
        </PlateTitle>
        {teams ? <ScoreLine teams={teams} size={40} /> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {phase === 'lobby' ? (
            <KbtButton
              active
              label='TIP-OFF'
              sub='start the clock'
              onClick={() => socket.sendMatch('start')}
            />
          ) : null}
          {phase === 'live' || phase === 'overtime' ? (
            <KbtButton
              variant='outline'
              label='PAUSE'
              onClick={() => socket.sendMatch('pause')}
            />
          ) : null}
          {phase === 'paused' ? (
            <KbtButton
              active
              label='RESUME'
              onClick={() => socket.sendMatch('resume')}
            />
          ) : null}
          {phase === 'live' || phase === 'paused' ? (
            <KbtButton
              variant='outline'
              label='OVERTIME'
              onClick={() => socket.sendMatch('start_overtime')}
            />
          ) : null}
          {phase === 'ended' ? (
            <KbtButton
              active
              label='NEW MATCH'
              onClick={() => socket.sendMatch('reset')}
            />
          ) : null}
        </div>
        <ConfirmRail
          align='flex-start'
          actions={[
            ...(phase === 'live' || phase === 'paused' || phase === 'overtime'
              ? [
                  {
                    id: 'end',
                    label: 'END MATCH',
                    prompt: 'end the match now?',
                  },
                ]
              : []),
            { id: 'reset', label: 'RESET', prompt: 'wipe the score?' },
          ]}
          onConfirm={(id) => socket.sendMatch(id === 'end' ? 'end' : 'reset')}
        />
      </Plate>

      {/* ── manual points ── */}
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
            <Label size={9} tracking={1.5}>
              the AI missed one · a long one · corrections
            </Label>
          }>
          MANUAL POINTS
        </PlateTitle>
        {teams ? (
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['A', 'B'] as const).map((t) => (
              <div
                key={t}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TeamSwatch color={teams[t].color} />
                  <Label size={10} tracking={1.5} color={KBT.cream}>
                    {teams[t].name.toUpperCase()}
                  </Label>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <KbtButton
                    dense
                    label='+1'
                    onClick={() => socket.addShot(t, 1)}
                    style={{ flex: 1 }}
                  />
                  <KbtButton
                    dense
                    label={`+${arc} ARC`}
                    onClick={() => socket.addShot(t, arc)}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <KbtButton
          dense
          variant='danger'
          label='UNDO LAST MAKE'
          onClick={() => socket.undoShot()}
        />
      </Plate>

      {/* ── views ── */}
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
            <Label size={9} tracking={1.5}>
              on air: {state?.scene ?? '—'}
            </Label>
          }>
          VIEW
        </PlateTitle>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {VIEWS.map((v) => {
            const needsCaster = v.key === 'caster' || v.key === 'split';
            const needsHoop = v.key === 'hoop';
            const needsCourt = v.key === 'court';
            const disabled =
              (needsCaster && !casterReady) ||
              (needsHoop && !state?.cams.hoop.joined) ||
              (needsCourt && !state?.cams.court.joined);
            return (
              <KbtButton
                key={v.key}
                dense
                label={v.label}
                sub={v.sub}
                active={activeView === v.key}
                disabled={disabled}
                onClick={() => socket.sendView(overrideFor(v.key))}
              />
            );
          })}
        </div>
        <ChipButton
          dense
          label={state?.casterPip ? 'MY CAM PIP: ON' : 'MY CAM PIP: OFF'}
          active={!!state?.casterPip}
          disabled={!casterReady}
          onClick={() => socket.setCasterPip(!state?.casterPip)}
        />
      </Plate>

      {/* ── program + colour sampling ── */}
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
            <ChipButton
              dense
              label={monitorOpen ? 'HIDE' : 'SHOW'}
              onClick={() => setMonitorOpen((o) => !o)}
            />
          }>
          PROGRAM · JERSEY COLOURS
        </PlateTitle>
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
            <div
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}>
              <Label size={9} tracking={1.5}>
                SAMPLE FROM THE PICTURE
              </Label>
              {teams
                ? (['A', 'B'] as const).map((t) => (
                    <ChipButton
                      key={t}
                      dense
                      leading={<TeamSwatch color={teams[t].color} size={10} />}
                      label={sampling === t ? 'TAP THE JERSEY…' : `TEAM ${t}`}
                      active={sampling === t}
                      onClick={() => setSampling(sampling === t ? null : t)}
                    />
                  ))
                : null}
              <Label size={9} tracking={1}>
                (switch to HOOP CAM view first for the sharpest sample)
              </Label>
            </div>
          </>
        ) : null}
      </Plate>

      {/* ── rig ── */}
      {rig.camOn ? (
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
              <Tab
                size={10}
                color={
                  rig.live ? KBT.good : recovery.restoring ? KBT.amber : KBT.bad
                }
                textColor={KBT.dark}>
                {rig.live
                  ? 'ON AIR'
                  : recovery.restoring
                    ? 'RESTORING…'
                    : 'OFFLINE'}
              </Tab>
            }>
            {name.toUpperCase()}
          </PlateTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <video
              autoPlay
              playsInline
              muted
              ref={rig.attachPreview}
              style={{
                width: 128,
                height: 72,
                objectFit: 'cover',
                border: `1px solid ${KBT.border}`,
                background: '#000',
                transform: 'scaleX(-1)',
              }}
            />
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Label size={9} tracking={2}>
                  MIC
                </Label>
                {rig.muted ? (
                  <Label size={9} tracking={2} color={KBT.bad}>
                    MUTED
                  </Label>
                ) : (
                  <Bar
                    value={rig.micLevel}
                    max={1}
                    color={rig.micLevel > 0.03 ? KBT.good : KBT.amber}
                    style={{ flex: 1 }}
                  />
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <KbtButton
                  dense
                  variant={rig.muted ? 'danger' : 'outline'}
                  label={rig.muted ? 'UNMUTE' : 'MUTE'}
                  active={rig.muted}
                  onClick={rig.toggleMute}
                />
                <KbtButton
                  dense
                  variant='outline'
                  label='RESTART CAM'
                  onClick={recovery.restartCamera}
                />
              </div>
            </div>
          </div>
          {rig.camErr ? (
            <Label size={9} tracking={1} color={KBT.bad}>
              {rig.camErr}
            </Label>
          ) : null}
        </Plate>
      ) : null}

      {/* ── cams + recording ── */}
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
        }}>
        <PlateTitle>CAMERAS</PlateTitle>
        {(['hoop', 'court'] as const).map((role) => {
          const cam = state?.cams[role];
          return (
            <div
              key={role}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot
                state={
                  !cam?.joined ? 'idle' : cam.camConnected ? 'good' : 'warn'
                }
                pulse={!!cam?.joined && !cam.camConnected}
              />
              <Label
                size={10}
                tracking={1.5}
                color={KBT.cream}
                style={{ minWidth: 80 }}>
                {role.toUpperCase()} CAM
              </Label>
              <Label size={9} tracking={1} style={{ flex: 1 }}>
                {!cam?.joined
                  ? 'waiting'
                  : cam.camConnected
                    ? `live · ${cam.name}`
                    : `connecting · ${cam.name}`}
                {role === 'hoop'
                  ? cam?.calibrated
                    ? ' · rim set'
                    : ' · RIM NOT CALIBRATED'
                  : ''}
                {role === 'hoop' && cam?.ballTracked ? ' · ball' : ''}
              </Label>
              {cam?.joined ? (
                <ChipButton
                  dense
                  tone='danger'
                  label='KICK'
                  onClick={() => socket.sendMatch('kick_cam', role)}
                />
              ) : null}
            </div>
          );
        })}
        <RecordingPlate rec={rec} />
      </Plate>

      {/* ── ledger ── */}
      <Plate
        cutPx={14}
        style={{ gridColumn: narrow ? undefined : '1 / -1' }}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '10px 12px',
        }}>
        <PlateTitle
          right={
            <Label size={9} tracking={1.5}>
              newest first
            </Label>
          }>
          LEDGER
        </PlateTitle>
        {recent.length === 0 ? (
          <Label size={10} tracking={1.5}>
            no makes yet
          </Label>
        ) : null}
        {teams
          ? recent.map((s) => (
              <ShotRow
                key={s.id}
                shot={s}
                teams={teams}
                dense
                onAssign={(team) => socket.resolveShot(s.id, { team })}
                onPoints={(points) => socket.resolveShot(s.id, { points })}
                onVoid={() => socket.resolveShot(s.id, { voided: true })}
              />
            ))
          : null}
      </Plate>
    </div>
  );
}
