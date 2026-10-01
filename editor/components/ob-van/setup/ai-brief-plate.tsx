'use client';

import React, { useRef, useState } from 'react';
import {
  OB_CONFIG_LIMITS,
  type ObLlmStatus,
  type ObRuleset,
} from '@smelter-editor/types';
import { generateObRuleset } from '@/app/actions/actions';
import { Copy, Meta, OB, ObButton, TextArea, WarnPlate } from '../ob-kit';
import { describeObError, type ObRoom } from '../use-ob-room';

const BRIEF_PLACEHOLDER =
  'e.g. A 40-minute panel: Anna (cam 2) moderates, two guests on cams 3 and 4. ' +
  'Stay on whoever talks, split on a back-and-forth, audience on questions, ' +
  'slides only when someone refers to them.';

/**
 * AI BRIEF on SETUP: the host describes the event in plain words, Claude
 * turns it into a ruleset (the rules cards below), the server validates it.
 * Greyed out when the server has no API key — presets still work.
 */
export function AiBriefPlate({
  room,
  brief,
  onBrief,
  llm,
  onRulesetApplied,
}: {
  room: ObRoom;
  brief: string;
  onBrief: (brief: string) => void;
  llm: ObLlmStatus | null;
  onRulesetApplied: (ruleset: ObRuleset, origin: 'llm') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const available = llm?.available === true;

  const generate = async () => {
    const roomId = room.roomId;
    if (!roomId || busyRef.current || !brief.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setRationale(null);
    setWarnings([]);
    try {
      const res = await generateObRuleset(roomId, brief.trim());
      if (!res.ok) {
        setError(describeObError(res.error));
        return;
      }
      // The brief route proposes; the ruleset route is what makes it the
      // event's rules (and re-validates it).
      const applied = await room.applyRuleset(res.value.ruleset);
      if (!applied.ok) {
        setError(describeObError(applied.error));
        return;
      }
      onRulesetApplied(applied.value.ruleset, 'llm');
      setRationale(res.value.rationale || null);
      setWarnings([...res.value.warnings, ...applied.value.warnings]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: available ? 1 : 0.75,
      }}>
      <TextArea
        value={brief}
        onChange={onBrief}
        placeholder={BRIEF_PLACEHOLDER}
        label='AI brief'
        maxLength={OB_CONFIG_LIMITS.brief.max}
        rows={4}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ObButton
          size='sm'
          variant='ai'
          label={busy ? 'THINKING…' : 'GENERATE RULES'}
          locked={busy}
          disabled={!available || !brief.trim() || !room.roomId}
          onClick={() => void generate()}
          title={
            available
              ? 'Claude turns the brief into rules; they replace the current ones'
              : 'The server has no ANTHROPIC_API_KEY'
          }
        />
        <Meta size={9} tracking={0.08} color={available ? OB.dim : OB.amber}>
          {available
            ? `${llm?.model ?? 'claude'} · ${brief.length}/${OB_CONFIG_LIMITS.brief.max}`
            : 'LLM OFF — set ANTHROPIC_API_KEY on the server'}
        </Meta>
      </div>
      {error ? <WarnPlate tone='bad'>{error}</WarnPlate> : null}
      {rationale ? (
        <div
          style={{
            borderLeft: `3px solid ${OB.accent}`,
            padding: '4px 0 4px 10px',
          }}>
          <Copy size={11} color='rgba(230,233,239,.85)' lineHeight={1.5}>
            {rationale}
          </Copy>
        </div>
      ) : null}
      {warnings.length ? (
        <WarnPlate>
          {warnings.slice(0, 3).join(' · ')}
          {warnings.length > 3 ? ` · +${warnings.length - 3} more` : ''}
        </WarnPlate>
      ) : null}
    </div>
  );
}
