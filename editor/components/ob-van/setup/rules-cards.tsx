'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  OB_RULESET_LIMITS,
  obPresetRuleset,
  type ObPresetId,
  type ObRule,
  type ObRuleset,
} from '@smelter-editor/types';
import {
  isRuleEnabled,
  parseRulesetJson,
  ruleOrigin,
  ruleSummary,
  rulesetToJson,
  setRuleCooldown,
  setRulePriority,
  toggleRule,
  type RuleOrigin,
} from '@/lib/ob-van/rules-editor';
import { formatSeconds } from '@/lib/ob-van/pacing';
import { TRANSITION_LABEL } from '@/lib/ob-van/view-labels';
import {
  Chip,
  Display,
  Meta,
  Mono,
  OB,
  ObButton,
  RADIUS,
  Stepper,
  TagChip,
  TextArea,
  Toggle,
  WarnPlate,
  type TagTone,
} from '../ob-kit';
import { describeObError, type ObRoom } from '../use-ob-room';

const APPLY_DEBOUNCE_MS = 450;

const ORIGIN_TAG: Record<RuleOrigin, { label: string; tone: TagTone }> = {
  preset: { label: 'PRESET', tone: 'dim' },
  edited: { label: 'EDITED', tone: 'amber' },
  llm: { label: 'LLM', tone: 'accent' },
  custom: { label: 'CUSTOM', tone: 'chalk' },
};

function RuleCard({
  rule,
  origin,
  onToggle,
  onPriority,
  onCooldown,
}: {
  rule: ObRule;
  origin: RuleOrigin;
  onToggle: () => void;
  onPriority: (p: number) => void;
  onCooldown: (ms: number) => void;
}) {
  const enabled = isRuleEnabled(rule);
  const summary = ruleSummary(rule);
  const tag = ORIGIN_TAG[origin];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        background: OB.plate2,
        border: `1px solid ${OB.rule}`,
        borderLeft: `3px solid ${enabled ? (rule.priority >= 80 ? OB.program : OB.accent) : OB.rule2}`,
        borderRadius: RADIUS,
        opacity: enabled ? 1 : 0.55,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle on={enabled} tone='accent' onChange={onToggle} />
        <Display
          size={15}
          weight={700}
          uppercase={false}
          tracking={0.01}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {rule.name}
        </Display>
        <TagChip tone={tag.tone}>{tag.label}</TagChip>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr',
          gap: '3px 6px',
        }}>
        <Meta size={8.5} color={OB.dim2}>
          WHEN
        </Meta>
        <Mono size={10} tracking={0.02} uppercase={false} color={OB.chalk}>
          {summary.when}
        </Mono>
        <Meta size={8.5} color={OB.dim2}>
          THEN
        </Meta>
        <Mono size={10} tracking={0.02} uppercase={false} color={OB.accent}>
          {summary.then}
        </Mono>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Meta size={8.5}>PRIORITY</Meta>
        <Stepper
          label={`${rule.name} priority`}
          value={rule.priority}
          min={OB_RULESET_LIMITS.priority.min}
          max={OB_RULESET_LIMITS.priority.max}
          step={5}
          height={24}
          onChange={onPriority}
          style={{ width: 86 }}
        />
        <Meta size={8.5} style={{ marginLeft: 6 }}>
          COOLDOWN
        </Meta>
        <Stepper
          label={`${rule.name} cooldown`}
          value={Math.round((rule.cooldownMs ?? 0) / 1000)}
          min={0}
          max={Math.round(OB_RULESET_LIMITS.cooldownMs.max / 1000)}
          step={5}
          height={24}
          render={(v) => `${v} s`}
          onChange={(s) => onCooldown(s * 1000)}
          style={{ width: 92 }}
        />
        {rule.holdMs ? (
          <Meta size={8.5} tracking={0.06} color={OB.dim2}>
            hold {formatSeconds(rule.holdMs)}
          </Meta>
        ) : null}
      </div>
    </div>
  );
}

/** RAW JSON drawer: edit the whole ruleset, APPLY validates on the server. */
function RawDrawer({
  initial,
  presetId,
  room,
  onApplied,
  onClose,
}: {
  initial: ObRuleset;
  presetId: ObPresetId;
  room: ObRoom;
  onApplied: (ruleset: ObRuleset, warnings: string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => rulesetToJson(initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setErrors([]);
    setWarnings([]);
    // Local pass first: a JSON syntax error never needs a round trip.
    const local = parseRulesetJson(text, obPresetRuleset(presetId));
    if (local.errors.some((e) => e.startsWith('JSON:'))) {
      setErrors(local.errors);
      return;
    }
    setBusy(true);
    const raw: unknown = JSON.parse(text);
    const res = await room.applyRuleset(raw);
    setBusy(false);
    if (!res.ok) {
      setErrors(
        res.error.errors?.length
          ? res.error.errors
          : [describeObError(res.error)],
      );
      return;
    }
    setWarnings(res.value.warnings);
    setText(rulesetToJson(res.value.ruleset));
    onApplied(res.value.ruleset, res.value.warnings);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        background: OB.well,
        border: `1px solid ${OB.rule2}`,
        borderRadius: RADIUS,
      }}>
      <TextArea
        value={text}
        onChange={setText}
        label='Ruleset JSON'
        rows={14}
        fontSize={10.5}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ObButton
          size='sm'
          variant='primary'
          label={busy ? 'CHECKING…' : 'APPLY'}
          locked={busy}
          onClick={() => void apply()}
        />
        <ObButton size='sm' label='CLOSE' onClick={onClose} />
        <Meta size={8.5} tracking={0.06} color={OB.dim2}>
          the server clamps numbers and drops rules it cannot read
        </Meta>
      </div>
      {errors.length ? (
        <WarnPlate tone='bad' title='NOT APPLIED'>
          {errors.slice(0, 4).join(' · ')}
        </WarnPlate>
      ) : null}
      {warnings.length ? (
        <WarnPlate title='APPLIED WITH WARNINGS'>
          {warnings.slice(0, 4).join(' · ')}
        </WarnPlate>
      ) : null}
    </div>
  );
}

/**
 * RULES on SETUP: the effective ruleset as cards (enable, priority,
 * cooldown, WHEN / THEN in words, where each rule came from) plus the RAW
 * JSON drawer. Every edit goes through the server's `ruleset` route.
 */
export function RulesCards({
  room,
  ruleset,
  presetId,
  custom,
  rulesOrigin,
  onRulesetApplied,
  onResetToPreset,
}: {
  room: ObRoom;
  /** Effective ruleset (the server's, or the preset's before it answers). */
  ruleset: ObRuleset;
  presetId: ObPresetId;
  /** The event runs a custom ruleset (not the preset's). */
  custom: boolean;
  rulesOrigin: 'llm' | 'custom';
  onRulesetApplied: (ruleset: ObRuleset, origin: 'llm' | 'custom') => void;
  onResetToPreset: () => void;
}) {
  const [local, setLocal] = useState<ObRuleset | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const view = local ?? ruleset;
  const preset = presetId === 'custom' ? null : obPresetRuleset(presetId);
  const origin = custom ? rulesOrigin : 'custom';

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const edit = (next: ObRuleset) => {
    setLocal(next);
    setError(null);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void room.applyRuleset(next).then((res) => {
        setLocal(null);
        if (!res.ok) {
          setError(describeObError(res.error));
          return;
        }
        onRulesetApplied(res.value.ruleset, origin);
      });
    }, APPLY_DEBOUNCE_MS);
  };

  const enabledCount = view.rules.filter(isRuleEnabled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
          <Display
            size={15}
            weight={700}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {view.name}
          </Display>
          <Meta size={8.5} tracking={0.08}>
            {enabledCount}/{view.rules.length} rules · hold{' '}
            {formatSeconds(view.pacing.minHoldMs)}–
            {formatSeconds(view.pacing.maxHoldMs)} ·{' '}
            {TRANSITION_LABEL[view.pacing.transition]}
          </Meta>
        </div>
        {custom ? (
          <Chip dense label='RESET TO PRESET' onClick={onResetToPreset} />
        ) : null}
        <Chip
          dense
          active={rawOpen}
          label='RAW JSON'
          onClick={() => setRawOpen((o) => !o)}
        />
      </div>
      {error ? <WarnPlate tone='bad'>{error}</WarnPlate> : null}
      {rawOpen ? (
        <RawDrawer
          key={JSON.stringify(ruleset)}
          initial={view}
          presetId={presetId}
          room={room}
          onApplied={(rs) =>
            onRulesetApplied(rs, custom ? rulesOrigin : 'custom')
          }
          onClose={() => setRawOpen(false)}
        />
      ) : null}
      {view.rules.length === 0 ? (
        <Meta size={9.5} tracking={0.06}>
          no rules — the auto pilot cuts on scoring alone
        </Meta>
      ) : null}
      {view.rules.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          origin={custom ? ruleOrigin(rule, preset, rulesOrigin) : 'preset'}
          onToggle={() => edit(toggleRule(view, rule.id))}
          onPriority={(p) => edit(setRulePriority(view, rule.id, p))}
          onCooldown={(ms) => edit(setRuleCooldown(view, rule.id, ms))}
        />
      ))}
    </div>
  );
}
