'use client';

import React from 'react';
import {
  OB_TRANSITION_LIMITS,
  OB_TRANSITION_TYPES,
  type ObAudioPolicy,
  type ObCam,
  type ObRuleset,
} from '@smelter-editor/types';
import {
  PACING_BLURB,
  PACING_OPTIONS,
  RESUME_AFTER_S,
  dialHold,
  formatSeconds,
} from '@/lib/ob-van/pacing';
import {
  AUDIO_BLURB,
  AUDIO_LABEL,
  TRANSITION_LABEL,
  captionsNote,
} from '@/lib/ob-van/view-labels';
import type { ObUiConfig } from '@/lib/ob-van/ui-config';
import {
  Field,
  Meta,
  OB,
  ObSelect,
  Segment,
  Stepper,
  Toggle,
  WarnPlate,
} from '../ob-kit';

const AUDIO_MODES: ObAudioPolicy['mode'][] = ['follow', 'master', 'mix'];

/**
 * DIRECTOR on SETUP: pacing dial, audio policy, auto pilot + resume,
 * captions (event-wide delay), the TAKE transition.
 */
export function DirectorPlate({
  config,
  onConfig,
  cams,
  ruleset,
}: {
  config: ObUiConfig;
  onConfig: (update: (c: ObUiConfig) => ObUiConfig) => void;
  cams: ObCam[];
  ruleset: ObRuleset;
}) {
  const hold = dialHold(ruleset, config.pacingDial);
  const liveCams = [...cams].sort((a, b) => a.number - b.number);
  const masterCam =
    config.audio.mode === 'master' ? config.audio.cam : (liveCams[0]?.id ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field
        label='PACING'
        hint={`${PACING_BLURB[config.pacingDial]} · hold ${formatSeconds(hold.minHoldMs)}–${formatSeconds(hold.maxHoldMs)}`}>
        <Segment
          options={PACING_OPTIONS}
          value={config.pacingDial}
          onChange={(pacingDial) => onConfig((c) => ({ ...c, pacingDial }))}
        />
      </Field>

      <Field label='AUDIO' hint={AUDIO_BLURB[config.audio.mode]}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Segment
            options={AUDIO_MODES.map((m) => ({
              value: m,
              label: AUDIO_LABEL[m],
              disabled: m === 'master' && liveCams.length === 0,
              title:
                m === 'master' && liveCams.length === 0
                  ? 'Needs a camera first'
                  : undefined,
            }))}
            value={config.audio.mode}
            onChange={(mode) =>
              onConfig((c) => ({
                ...c,
                audio: mode === 'master' ? { mode, cam: masterCam } : { mode },
              }))
            }
            style={{ flex: 1 }}
          />
          {config.audio.mode === 'master' ? (
            <ObSelect
              value={masterCam}
              height={34}
              onChange={(cam) =>
                onConfig((c) => ({ ...c, audio: { mode: 'master', cam } }))
              }
              style={{ width: 130 }}>
              {liveCams.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  CAM {cam.number} · {cam.name}
                </option>
              ))}
            </ObSelect>
          ) : null}
        </div>
      </Field>

      <Field label='AUTO PILOT' hint='a manual cut pauses it, then it resumes'>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle
            on={config.autoPilot.enabled}
            tone='accent'
            label={config.autoPilot.enabled ? 'ON AT GO LIVE' : 'MANUAL'}
            onChange={(enabled) =>
              onConfig((c) => ({
                ...c,
                autoPilot: { ...c.autoPilot, enabled },
              }))
            }
          />
          <div style={{ flex: 1 }} />
          <Meta size={9}>RESUME AFTER</Meta>
          <Stepper
            label='resume after'
            value={Math.round(config.autoPilot.resumeAfterMs / 1000)}
            min={RESUME_AFTER_S.min}
            max={RESUME_AFTER_S.max}
            step={RESUME_AFTER_S.step}
            render={(v) => `${v} s`}
            onChange={(s) =>
              onConfig((c) => ({
                ...c,
                autoPilot: { ...c.autoPilot, resumeAfterMs: s * 1000 },
              }))
            }
            style={{ width: 112 }}
          />
        </div>
      </Field>

      <Field label='TAKE TRANSITION'>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Segment
            options={OB_TRANSITION_TYPES.map((t) => ({
              value: t,
              label: TRANSITION_LABEL[t],
            }))}
            value={config.transition.type}
            onChange={(type) =>
              onConfig((c) => ({
                ...c,
                transition: { ...c.transition, type },
              }))
            }
            height={30}
            fontSize={10}
            gap={3}
            style={{ flex: 1 }}
          />
          <Stepper
            label='transition duration'
            value={config.transition.durationMs}
            min={OB_TRANSITION_LIMITS.durationMs.min}
            max={OB_TRANSITION_LIMITS.durationMs.max}
            step={100}
            disabled={config.transition.type === 'cut'}
            render={(v) => `${v} ms`}
            onChange={(durationMs) =>
              onConfig((c) => ({
                ...c,
                transition: { ...c.transition, durationMs },
              }))
            }
            style={{ width: 118 }}
          />
        </div>
      </Field>

      <Field label='CAPTIONS'>
        <Toggle
          on={config.captions}
          tone='accent'
          label={
            config.captions
              ? 'TRANSCRIBE SPEAKER / GUEST / WIDE'
              : 'OFF — SIGNALS + TALENT FIELDS ONLY'
          }
          onChange={(captions) => onConfig((c) => ({ ...c, captions }))}
        />
        <WarnPlate tone={config.captions ? 'amber' : 'accent'}>
          {captionsNote(config.captions)}
        </WarnPlate>
      </Field>
      <Meta size={8.5} tracking={0.06} color={OB.dim2}>
        cameras rejoin when captions change — the side-channel delay is set at
        registration
      </Meta>
    </div>
  );
}
