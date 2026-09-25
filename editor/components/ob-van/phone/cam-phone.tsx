'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ObCamRole } from '@smelter-editor/types';
import {
  HazardStrip,
  ObConnectStep,
  ObPhoneShell,
} from '@/components/ob-van/ob-kit';
import {
  customRole,
  customRoleName,
  isCustomRole,
  roleLabel,
} from '@/lib/ob-van/roles';
import { CamLiveHud, type HudStatus } from './cam-live-hud';
import { CamRigStep } from './cam-rig-step';
import { CamSetupStep, type RoleChoice } from './cam-setup-step';
import { type CamStep, useCamSocket } from './use-cam-socket';
import { useTallyVibration } from './use-tally-vibration';
import '@/components/ob-van/ob-kit.css';

// /ob-van/cam?room=<roomId>&server=<api> — connect → seat (name, role,
// talent) → camera rig → live tally. The socket + WHIP machine lives in
// useCamSocket; this component routes the steps and owns the seat form.

const STEP_META: Record<CamStep, { index: number; label: string }> = {
  connect: { index: 0, label: 'CONNECTING' },
  setup: { index: 1, label: 'CAMERA SEAT' },
  rig: { index: 2, label: 'CAMERA RIG' },
  live: { index: 3, label: 'ON AIR' },
};

export function CamPhone() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('room') ?? '';
  const cam = useCamSocket(roomId, searchParams.get('server'));
  const { media } = cam;

  const [name, setName] = useState('');
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('wide');
  const [customName, setCustomName] = useState('');
  const [talent, setTalent] = useState('');

  // Prefill the seat form once from the stored session.
  const prefilledRef = useRef(false);
  useEffect(() => {
    const s = cam.restored;
    if (!s || prefilledRef.current) return;
    prefilledRef.current = true;
    if (s.name) setName(s.name);
    if (s.talent) setTalent(s.talent);
    if (s.role) {
      if (isCustomRole(s.role)) {
        setRoleChoice('custom');
        setCustomName(customRoleName(s.role));
      } else {
        setRoleChoice(s.role);
      }
    }
  }, [cam.restored]);

  useTallyVibration(cam.tally);

  const role: ObCamRole | null =
    roleChoice === 'custom' ? customRole(customName) : roleChoice;
  const canContinue = name.trim().length > 0 && role != null;

  const { join } = cam;
  const onContinue = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !role) return;
    join({ name: trimmed, role, talent: talent.trim() || null });
  }, [join, name, role, talent]);

  const seatLabel = cam.seat
    ? `CAM ${cam.seat.number} · ${roleLabel(cam.seat.role)} · ${cam.seat.name}`
    : null;

  if (cam.step === 'live') {
    const status: HudStatus = !cam.connected
      ? { text: 'RECONNECTING…', tone: 'warn' }
      : cam.notice
        ? { text: cam.notice, tone: 'warn' }
        : !cam.live
          ? { text: 'RESTORING VIDEO…', tone: 'warn' }
          : cam.sendFps == null
            ? { text: 'LINK OK', tone: 'ok' }
            : cam.sendFps > 0
              ? { text: `LINK OK · SENDING ${cam.sendFps} FPS`, tone: 'ok' }
              : { text: 'NO SIGNAL OUT', tone: 'warn' };
    return (
      <CamLiveHud
        tally={cam.tally}
        camNumber={cam.seat?.number ?? null}
        name={cam.seat?.name ?? name.trim()}
        roleText={roleLabel(cam.seat?.role ?? role ?? 'wide')}
        talent={cam.seat ? cam.seat.talent : talent.trim() || null}
        facing={media.facing}
        attachVideo={media.attachPreview}
        status={status}
        camErr={media.camErr}
        muted={media.muted}
        micLevel={media.micLevel}
        onToggleMute={media.toggleMute}
        onStopVideo={cam.stopVideo}
        onLeave={cam.leave}
      />
    );
  }

  const restoring =
    media.camOn &&
    !cam.live &&
    cam.wantsCam &&
    !(cam.step === 'rig' && cam.publishing);
  const statusStrip =
    cam.step === 'connect' ? null : !cam.connected ? (
      <HazardStrip text='RECONNECTING…' />
    ) : cam.notice ? (
      <HazardStrip text={cam.notice} />
    ) : restoring ? (
      <HazardStrip text='RESTORING VIDEO…' />
    ) : null;

  const meta = STEP_META[cam.step];

  return (
    <>
      {statusStrip}
      <ObPhoneShell
        title='CAMERA'
        stepIndex={meta.index}
        stepCount={Object.keys(STEP_META).length}
        stepLabel={meta.label}>
        {cam.step === 'connect' ? (
          <ObConnectStep
            roomStatus={cam.roomStatus}
            wsConnected={cam.connected}
            wsError={
              roomId ? cam.wsDbg : 'this link has no room — scan the QR again'
            }
            onRetry={cam.retryConnect}
          />
        ) : cam.step === 'setup' ? (
          <CamSetupStep
            name={name}
            onName={setName}
            roleChoice={roleChoice}
            onRoleChoice={setRoleChoice}
            customName={customName}
            onCustomName={setCustomName}
            talent={talent}
            onTalent={setTalent}
            canContinue={canContinue}
            onContinue={onContinue}
            camNumber={cam.seat?.number ?? null}
          />
        ) : (
          <CamRigStep
            camOn={media.camOn}
            camErr={media.camErr}
            facing={media.facing}
            publishing={cam.publishing}
            live={cam.live}
            sendFps={cam.sendFps}
            micLevel={media.micLevel}
            attachVideo={media.attachPreview}
            seatLabel={seatLabel}
            onEnable={() => void media.enableCamera()}
            onFlip={media.flipCamera}
            onGoLive={cam.requestCam}
            onEditSeat={cam.editSeat}
          />
        )}
      </ObPhoneShell>
    </>
  );
}
