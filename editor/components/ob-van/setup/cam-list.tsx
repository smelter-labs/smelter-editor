'use client';

import React, { useEffect, useState } from 'react';
import {
  OB_MAX_CAMS,
  type ObCam,
  type ObCamRole,
  type ObOperatorCommand,
  type ObSignalSummary,
} from '@smelter-editor/types';
import {
  FIXED_ROLES,
  ROLE_LABEL,
  customRoleName,
  isCustomRole,
  toRole,
} from '@/lib/ob-van/roles';
import {
  Chip,
  Display,
  Meta,
  Mono,
  OB,
  ObSelect,
  RADIUS,
  SignalMeter,
  SourceTag,
  TallyBadge,
  TextField,
  useArmed,
} from '../ob-kit';

/** A text cell that commits on blur / Enter (one command per edit, not per key). */
function CommitField({
  value,
  placeholder,
  label,
  display = false,
  maxLength,
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  display?: boolean;
  maxLength: number;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v !== value.trim()) onCommit(v);
  };
  return (
    <TextField
      value={draft}
      onChange={setDraft}
      placeholder={placeholder}
      label={label}
      display={display}
      maxLength={maxLength}
      height={28}
      fontSize={display ? 15 : 11}
      onBlur={commit}
      onEnter={commit}
    />
  );
}

function RoleSelect({
  role,
  onChange,
}: {
  role: ObCamRole;
  onChange: (role: ObCamRole) => void;
}) {
  return (
    <ObSelect
      value={role}
      height={28}
      onChange={(v) => onChange(toRole(v, role))}
      style={{ width: 118, flexShrink: 0 }}>
      {FIXED_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
      {isCustomRole(role) ? (
        <option value={role}>{customRoleName(role).toUpperCase()}</option>
      ) : null}
    </ObSelect>
  );
}

function CamRow({
  cam,
  signals,
  armed,
  onArm,
  onKick,
  onCmd,
}: {
  cam: ObCam;
  signals: ObSignalSummary | undefined;
  armed: boolean;
  onArm: () => void;
  onKick: () => void;
  onCmd: (cmd: ObOperatorCommand) => void;
}) {
  const status = !cam.connected
    ? { text: 'OFFLINE', color: OB.dim2 }
    : !cam.live
      ? { text: 'NO SIGNAL', color: OB.amber }
      : { text: 'LIVE', color: OB.preview };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        background: OB.plate2,
        border: `1px solid ${cam.tally === 'program' ? OB.program : cam.tally === 'preview' ? OB.preview : OB.rule}`,
        borderRadius: RADIUS,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 2,
            background: OB.fillStrong,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Display size={20} weight={800}>
            {cam.number}
          </Display>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CommitField
            value={cam.name}
            placeholder={`CAM ${cam.number}`}
            label={`Camera ${cam.number} name`}
            display
            maxLength={24}
            onCommit={(value) =>
              onCmd({ op: 'cam', action: 'name', camId: cam.id, value })
            }
          />
        </div>
        <RoleSelect
          role={cam.role}
          onChange={(value) =>
            onCmd({ op: 'cam', action: 'role', camId: cam.id, value })
          }
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CommitField
            value={cam.talent ?? ''}
            placeholder='talent (lower third)'
            label={`Camera ${cam.number} talent`}
            maxLength={40}
            onCommit={(value) =>
              onCmd({ op: 'cam', action: 'talent', camId: cam.id, value })
            }
          />
        </div>
        <SourceTag cam={cam} />
        <Mono size={9} weight={600} tracking={0.14} color={status.color}>
          {status.text}
        </Mono>
        <TallyBadge tally={cam.tally} size={9} />
        <Chip
          dense
          tone='danger'
          active={armed}
          label={armed ? 'SURE?' : 'KICK'}
          title={
            cam.kind === 'whip'
              ? 'Remove this phone from the event'
              : 'Remove this camera from the event'
          }
          onClick={armed ? onKick : onArm}
        />
      </div>
      {cam.live && signals ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <SignalMeter
            label='SPEECH'
            value={signals.speechProb}
            active={signals.speech}
            tone='preview'
            stale={signals.stale}
            compact
            style={{ flex: 1 }}
          />
          <SignalMeter
            label='MOTION'
            value={signals.motion}
            tone='accent'
            stale={signals.stale}
            compact
            text={String(signals.people)}
            style={{ flex: 1 }}
          />
        </div>
      ) : null}
      {cam.fileName ? (
        <Meta
          size={8.5}
          tracking={0.06}
          color={OB.dim2}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {cam.fileName}
        </Meta>
      ) : null}
    </div>
  );
}

/**
 * CAMERAS on SETUP: every seat with its number, editable name / role /
 * talent (committed on blur), source, live state, tally and a two-press
 * KICK. Edits go through the operator command vocabulary (`op:'cam'`).
 */
export function CamList({
  cams,
  signals,
  onCmd,
  onKick,
}: {
  cams: ObCam[];
  signals: Record<string, ObSignalSummary>;
  onCmd: (cmd: ObOperatorCommand) => void;
  onKick: (camId: string) => void;
}) {
  const { armed, arm, disarm } = useArmed(4000);
  const sorted = [...cams].sort((a, b) => a.number - b.number);
  if (sorted.length === 0) {
    return (
      <div
        style={{
          padding: '18px 12px',
          border: `1px dashed ${OB.rule2}`,
          borderRadius: RADIUS,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          alignItems: 'center',
          textAlign: 'center',
        }}>
        <Display size={18} weight={700} color={OB.dim}>
          NO CAMERAS YET
        </Display>
        <Mono size={10.5} tracking={0.04} uppercase={false} color={OB.dim2}>
          Scan the QR with a phone, add a file camera, or adopt a room input. Up
          to {OB_MAX_CAMS} cameras.
        </Mono>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map((cam) => (
        <CamRow
          key={cam.id}
          cam={cam}
          signals={signals[cam.id]}
          armed={armed === cam.id}
          onArm={() => arm(cam.id)}
          onKick={() => {
            disarm();
            onKick(cam.id);
          }}
          onCmd={onCmd}
        />
      ))}
    </div>
  );
}
