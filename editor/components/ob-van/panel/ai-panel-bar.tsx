'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { Chip, Meta, Mono, OB, TagChip } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * The AI PANEL desk (preset `panel` only). One row of panelist status chips
 * plus the AUTO / VOICE toggles, and — while a question is out — a card with
 * the question and each model's answer. The host asks by voice; there are no
 * manual ask controls (AUTO off just ignores closed questions).
 */
export function AiPanelBar({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  const panel = state.panel;
  if (!panel) return null;
  const autoCmd: ObOperatorCommand = {
    op: 'panel_set',
    auto: !state.config.panel.auto,
  };
  const ttsCmd: ObOperatorCommand = {
    op: 'panel_set',
    tts: !state.config.panel.tts,
  };
  return (
    <div
      role='group'
      aria-label='ai panel desk'
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          minWidth: 0,
        }}>
        <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
          PANEL
        </Meta>
        {panel.speakers.length === 0 ? (
          <Meta size={9} color={OB.dim2}>
            no panelists — add GUEST cameras with talents OPUS / GPT
          </Meta>
        ) : null}
        {panel.speakers.map((s) => (
          <Chip
            key={s.camId}
            dense
            tone={s.status === 'speaking' ? 'amber' : 'default'}
            active={s.status === 'speaking'}
            title={
              s.lastText ? `${s.name}: “${s.lastText}”` : `${s.name} is seated`
            }
            label={
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <span>{s.name.toUpperCase()}</span>
                <span style={{ color: OB.accent, fontSize: 9 }}>
                  {s.status === 'thinking'
                    ? 'THINKING…'
                    : s.status === 'speaking'
                      ? 'ON AIR'
                      : s.status === 'done'
                        ? 'ANSWERED'
                        : 'AI'}
                </span>
              </span>
            }
            style={{ maxWidth: 280 }}
          />
        ))}
        <TagChip tone={panel.phase === 'idle' ? 'outline' : 'amber'}>
          {panel.phase.toUpperCase()}
        </TagChip>
        <Chip
          dense
          label='AUTO'
          active={state.config.panel.auto}
          tone={state.config.panel.auto ? 'amber' : 'default'}
          pending={pending.isPending(autoCmd)}
          onClick={() => pending.send(autoCmd)}
          title='Closed host questions go to the models by themselves (off = ignored)'
        />
        <Chip
          dense
          label='VOICE'
          active={state.config.panel.tts}
          tone={state.config.panel.tts ? 'amber' : 'default'}
          pending={pending.isPending(ttsCmd)}
          onClick={() => pending.send(ttsCmd)}
          title='ElevenLabs voices for the panelists (needs ELEVENLABS_API_KEY on the server)'
        />
      </div>
      {panel.question ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            background: OB.well,
            border: `1px solid ${OB.rule2}`,
            borderRadius: 3,
            minWidth: 0,
          }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}>
            <TagChip tone='amber'>Q{panel.seq} · HOST</TagChip>
            <Mono size={12} weight={600} style={{ minWidth: 0 }}>
              {panel.question}
            </Mono>
          </div>
          {panel.speakers
            .filter((s) => s.lastText)
            .map((s) => (
              <Mono
                key={s.camId}
                size={11}
                weight={600}
                style={{ color: OB.accent, minWidth: 0 }}>
                {s.name.toUpperCase()}
                {s.status === 'speaking' ? ' (on air)' : ''}: “{s.lastText}”
              </Mono>
            ))}
          {panel.pendingQuestion ? (
            <Meta size={9} color={OB.dim2}>
              NEXT: “{panel.pendingQuestion}”
            </Meta>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
