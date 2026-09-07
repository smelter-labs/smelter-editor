'use client';

import React from 'react';
import type { BbShotEvent, BbTeamId, BbTeamStats } from '@smelter-editor/types';
import { BB_TEAM_COLOR_PRESETS } from '@smelter-editor/types';
import { colorsTooClose } from '@/lib/arcade/color';
import {
  ChipButton,
  DisplayText,
  KBT,
  Label,
  KbtButton,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';

/*
 * Blacktop additions on top of the kb_design kit (kbt-kit.tsx): the
 * basketball screens reuse the same plates, buttons and typography — same
 * asphalt + ember palette as the broadcast HUD — and add the team-colour
 * pieces (swatches, picker, badges) and ledger rows.
 */

export { colorsTooClose };

/** Small square swatch of a team colour. */
export function TeamSwatch({
  color,
  size = 14,
  style,
}: {
  color: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        background: color,
        border: `1px solid rgba(255,255,255,.18)`,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/** Team name with its colour bar (host screens / panel). */
export function TeamBadge({
  name,
  color,
  size = 20,
  style,
}: {
  name: string;
  color: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}>
      <span
        style={{
          width: Math.round(size * 0.35),
          height: size,
          background: color,
          flexShrink: 0,
        }}
      />
      <DisplayText size={size} weight={700} tracking={1.5}>
        {name.toUpperCase()}
      </DisplayText>
    </span>
  );
}

/**
 * Team colour picker: eight preset bibs that stay apart on camera, plus a
 * native colour input for anything else. Values are `#rrggbb`.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
      }}>
      {BB_TEAM_COLOR_PRESETS.map((p) => (
        <button
          key={p.id}
          type='button'
          className='kbt-btn'
          title={p.label}
          onClick={() => onChange(p.color)}
          style={{
            width: 26,
            height: 26,
            background: p.color,
            border:
              value.toLowerCase() === p.color
                ? `2px solid ${KBT.cream}`
                : '1px solid rgba(255,255,255,.18)',
            padding: 0,
          }}
        />
      ))}
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: kbtMonoFont,
          fontSize: 10,
          letterSpacing: 1.5,
          color: KBT.dim,
        }}>
        <input
          type='color'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 26,
            height: 26,
            padding: 0,
            border: 'none',
            background: 'none',
          }}
        />
        CUSTOM
      </label>
    </div>
  );
}

/** Two-line score readout: A score : B score, in team colours. */
export function ScoreLine({
  teams,
  size = 44,
}: {
  teams: Record<BbTeamId, BbTeamStats>;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <TeamBadge
        name={teams.A.name}
        color={teams.A.color}
        size={Math.round(size * 0.45)}
      />
      <DisplayText size={size} weight={800} color={teams.A.color}>
        {String(teams.A.score)}
      </DisplayText>
      <Label size={12} tracking={2}>
        :
      </Label>
      <DisplayText size={size} weight={800} color={teams.B.color}>
        {String(teams.B.score)}
      </DisplayText>
      <TeamBadge
        name={teams.B.name}
        color={teams.B.color}
        size={Math.round(size * 0.45)}
      />
    </div>
  );
}

/** Format an AI attribution for a ledger row ("AI: A 92%" / "AI: ? 31%"). */
export function aiGuessLabel(shot: BbShotEvent): string {
  if (shot.source === 'manual') return 'MANUAL';
  const pct = Math.round(shot.aiConfidence * 100);
  return `AI: ${shot.aiTeam ?? '?'} ${pct}%`;
}

/**
 * One ledger entry with the moderator's controls: assign A / B, value 1↔2,
 * void. `teams` colour the buttons; `dense` packs it for the phone panel.
 */
export function ShotRow({
  shot,
  teams,
  onAssign,
  onPoints,
  onVoid,
  dense = false,
}: {
  shot: BbShotEvent;
  teams: Record<BbTeamId, { name: string; color: string }>;
  onAssign?: (team: BbTeamId) => void;
  onPoints?: (points: 1 | 2) => void;
  onVoid?: () => void;
  dense?: boolean;
}) {
  const pending = shot.status === 'pending';
  const voided = shot.status === 'voided';
  const teamColor = shot.team ? teams[shot.team].color : KBT.amber;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: dense ? 8 : 12,
        padding: dense ? '6px 8px' : '8px 12px',
        background: pending ? `rgba(255,184,0,.08)` : KBT.fill,
        border: `1px solid ${pending ? KBT.amber : KBT.border}`,
        opacity: voided ? 0.5 : 1,
        flexWrap: 'wrap',
      }}>
      <TeamSwatch color={teamColor} size={dense ? 12 : 16} />
      <DisplayText
        size={dense ? 18 : 22}
        weight={800}
        color={voided ? KBT.dim : KBT.cream}
        style={{
          textDecoration: voided ? 'line-through' : undefined,
          minWidth: 40,
        }}>
        +{shot.points}
      </DisplayText>
      <Label
        size={dense ? 9 : 10}
        tracking={1.5}
        color={KBT.cream}
        style={{ minWidth: 90 }}>
        {shot.team
          ? teams[shot.team].name.toUpperCase()
          : pending
            ? 'WHO?'
            : '—'}
      </Label>
      <Label size={9} tracking={1} style={{ flex: 1, minWidth: 80 }}>
        #{shot.index} · {aiGuessLabel(shot)}
        {shot.period === 'ot' ? ' · OT' : ''}
        {voided ? ' · VOID' : pending ? ' · PENDING' : ''}
      </Label>
      {onAssign ? (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['A', 'B'] as const).map((t) => (
            <KbtButton
              key={t}
              dense
              label={teams[t].name.toUpperCase()}
              variant={shot.team === t && !voided ? 'solid' : 'outline'}
              active={shot.team === t && !voided}
              onClick={() => onAssign(t)}
              style={{ borderColor: teams[t].color }}
            />
          ))}
        </div>
      ) : null}
      {onPoints ? (
        <div style={{ display: 'flex', gap: 4 }}>
          <ChipButton
            dense
            label='1'
            active={shot.points === 1}
            onClick={() => onPoints(1)}
          />
          <ChipButton
            dense
            label='2'
            active={shot.points === 2}
            onClick={() => onPoints(2)}
          />
        </div>
      ) : null}
      {onVoid && !voided ? (
        <ChipButton dense tone='danger' label='VOID' onClick={onVoid} />
      ) : null}
    </div>
  );
}
