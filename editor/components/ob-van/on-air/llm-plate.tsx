'use client';

import React, { useState } from 'react';
import {
  OB_LLM_MODELS,
  type ObLlmStatus,
  type ObLogEntry,
} from '@smelter-editor/types';
import { killObLlm, setObLlmAnalyst } from '@/app/actions/actions';
import { ANALYST_INTERVAL_S, clampAnalystIntervalS } from '@/lib/ob-van/pacing';
import {
  Chip,
  Copy,
  Meta,
  Mono,
  OB,
  Stepper,
  Toggle,
  useArmed,
} from '../ob-kit';
import { describeObError } from '../use-ob-room';

/** `12.3k` */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
}

/**
 * The LLM on air: the analyst's last notes, usage (tokens / cost / runs),
 * the ANALYST switch + interval, the model picker, and a two-press KILL that
 * stops every LLM call for the rest of the event.
 */
export function LlmPlate({
  roomId,
  llm,
  notes,
  onError,
}: {
  roomId: string | null;
  llm: ObLlmStatus;
  /** LLM log entries, newest first. */
  notes: ObLogEntry[];
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { armed, arm, disarm } = useArmed(4000);
  const interval = clampAnalystIntervalS(llm.intervalS);

  const call = async (fn: () => ReturnType<typeof killObLlm>) => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) onError(describeObError(res.error));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!llm.available)
    return (
      <Meta size={9.5} tracking={0.06} color={OB.amber}>
        LLM OFF — set ANTHROPIC_API_KEY on the server
      </Meta>
    );

  const lastNote = notes[0]?.text ?? llm.lastNote;
  /** `OB_VAN_LLM_MODEL` may pick a model the selector does not list. */
  const customModel =
    llm.model && !OB_LLM_MODELS.some((m) => m.id === llm.model);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle
          on={llm.analyst}
          tone='accent'
          label='ANALYST'
          disabled={busy}
          onChange={(enabled) =>
            void call(() =>
              setObLlmAnalyst(roomId ?? '', { enabled, intervalS: interval }),
            )
          }
        />
        <Stepper
          label='analyst interval'
          value={interval}
          min={ANALYST_INTERVAL_S.min}
          max={ANALYST_INTERVAL_S.max}
          step={ANALYST_INTERVAL_S.step}
          height={24}
          render={(v) => `${v} s`}
          disabled={busy}
          onChange={(intervalS) =>
            void call(() =>
              setObLlmAnalyst(roomId ?? '', {
                enabled: llm.analyst,
                intervalS,
              }),
            )
          }
          style={{ width: 88 }}
        />
        <div style={{ flex: 1 }} />
        <Chip
          dense
          tone='danger'
          active={armed === 'kill'}
          label={armed === 'kill' ? 'SURE?' : 'KILL'}
          title='Stop every LLM call for this event'
          onClick={() => {
            if (armed !== 'kill') return arm('kill');
            disarm();
            void call(() => killObLlm(roomId ?? ''));
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Meta size={9} tracking={0.08} color={OB.dim}>
          MODEL
        </Meta>
        {OB_LLM_MODELS.map((m) => (
          <Chip
            key={m.id}
            dense
            active={llm.model === m.id}
            label={m.label}
            title={`${m.id} · ${m.blurb}`}
            disabled={busy}
            onClick={() =>
              llm.model === m.id
                ? undefined
                : void call(() =>
                    setObLlmAnalyst(roomId ?? '', {
                      enabled: llm.analyst,
                      intervalS: interval,
                      model: m.id,
                    }),
                  )
            }
          />
        ))}
        {customModel ? (
          <Mono size={9} tracking={0.04} uppercase={false} color={OB.dim}>
            {llm.model}
          </Mono>
        ) : null}
      </div>
      <Mono size={9} tracking={0.06} color={OB.dim}>
        {llm.busy ? 'THINKING · ' : ''}
        {llm.runs} RUNS · {formatTokens(llm.tokensIn)}/
        {formatTokens(llm.tokensOut)} TOK · ${llm.estCostUsd.toFixed(2)}
        {llm.backoffUntilMs ? ' · BACKING OFF' : ''}
      </Mono>
      {llm.error ? (
        <Mono size={9} tracking={0.04} uppercase={false} color={OB.amber}>
          {llm.error}
        </Mono>
      ) : null}
      {lastNote ? (
        <div
          style={{
            borderLeft: `3px solid ${OB.accent}`,
            paddingLeft: 8,
          }}>
          <Copy size={10.5} color='rgba(230,233,239,.85)' lineHeight={1.45}>
            {lastNote}
          </Copy>
        </div>
      ) : (
        <Meta size={9} tracking={0.06} color={OB.dim2}>
          {llm.analyst
            ? `the analyst reports every ${interval} s`
            : 'analyst off — the rules drive alone'}
        </Meta>
      )}
    </div>
  );
}
