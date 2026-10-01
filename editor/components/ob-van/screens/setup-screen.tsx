'use client';

import React from 'react';
import {
  OB_CONFIG_LIMITS,
  OB_MAX_CAMS,
  obPresetRuleset,
  type ObOperatorCommand,
  type ObRuleset,
} from '@smelter-editor/types';
import { presetCards } from '@/lib/ob-van/presets-meta';
import type { ObUiConfig } from '@/lib/ob-van/ui-config';
import {
  Chip,
  Display,
  Field,
  Meta,
  Mono,
  OB,
  ObButton,
  ObPlate,
  RADIUS,
  StatusPill,
  Stepper,
  TextField,
  Toggle,
  HostFrame,
  useArmed,
} from '../ob-kit';
import type { ObJoinLinks } from '../arcade';
import type { ObFeed } from '../use-ob-feed';
import type { ObRoom } from '../use-ob-room';
import { CamList } from '../setup/cam-list';
import { FileCamPicker } from '../setup/file-cam-picker';
import { AdoptInputRow } from '../setup/adopt-input-row';
import { JoinPlate } from '../setup/join-plate';
import { DirectorPlate } from '../setup/director-plate';
import { AiBriefPlate } from '../setup/ai-brief-plate';
import { HostPlate } from '../setup/host-plate';
import { RulesCards } from '../setup/rules-cards';
import { RundownEditor } from '../setup/rundown-editor';

const COLUMN: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: 4,
};

function PresetGrid({
  value,
  onPick,
}: {
  value: ObUiConfig['presetId'];
  onPick: (id: ObUiConfig['presetId']) => void;
}) {
  return (
    <div
      role='radiogroup'
      aria-label='Preset'
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
      }}>
      {presetCards().map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type='button'
            role='radio'
            aria-checked={active}
            className='ob-btn'
            data-variant='card'
            onClick={() => onPick(p.id)}
            title={p.blurb}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: '8px 10px',
              textAlign: 'left',
              background: active ? OB.accentDim : OB.plate2,
              border: `1px solid ${active ? OB.accent : OB.rule}`,
              borderRadius: RADIUS,
              color: OB.chalk,
            }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                width: '100%',
              }}>
              <Display
                size={20}
                weight={800}
                color={active ? OB.accent : OB.chalk}>
                {p.label}
              </Display>
              <Mono size={9} tracking={0.1} color={OB.dim}>
                {p.sub}
              </Mono>
            </div>
            <Mono size={8.5} tracking={0.08} color={OB.dim2}>
              {p.rules} RULES · {p.hold} · {p.transition}
            </Mono>
          </button>
        );
      })}
    </div>
  );
}

/**
 * SETUP: the event exists already (phones and file cams need the room).
 * Left: event + preset, output. Middle: cameras and how they join. Right:
 * the director — pacing, audio, auto pilot, captions — the AI brief, the
 * rules and the rundown. GO LIVE starts the show.
 */
export function SetupScreen({
  room,
  feed,
  config,
  onConfig,
  onRulesetApplied,
  joinLinks,
  onGoLive,
  onExit,
}: {
  room: ObRoom;
  feed: ObFeed;
  config: ObUiConfig;
  onConfig: React.Dispatch<React.SetStateAction<ObUiConfig>>;
  onRulesetApplied: (
    ruleset: ObRuleset | null,
    origin: 'llm' | 'custom',
  ) => void;
  joinLinks: ObJoinLinks;
  onGoLive: () => void;
  onExit: () => void;
}) {
  const { armed, arm, disarm } = useArmed(4000);
  const state = feed.state;
  const cams = state?.cams ?? [];
  const liveCams = cams.filter((c) => c.live);
  const ruleset: ObRuleset =
    state?.ruleset ?? config.ruleset ?? obPresetRuleset(config.presetId);
  const operate = (cmd: ObOperatorCommand) => void room.operate(cmd);

  return (
    <HostFrame
      title='SETUP'
      meta={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusPill tone={liveCams.length ? 'chalk' : 'idle'} size={9}>
            {liveCams.length}/{cams.length} CAMS LIVE
          </StatusPill>
          {armed === 'exit' ? (
            <>
              <ObButton
                size='sm'
                variant='dangerSolid'
                label='DELETE EVENT'
                onClick={() => {
                  disarm();
                  onExit();
                }}
              />
              <ObButton size='sm' label='KEEP' onClick={disarm} />
            </>
          ) : (
            <ObButton
              size='sm'
              variant='ghost'
              label='EXIT'
              onClick={() => arm('exit')}
            />
          )}
          <ObButton
            size='sm'
            variant='program'
            label='GO LIVE'
            keyBadge='ENTER'
            active={liveCams.length > 0}
            disabled={cams.length === 0}
            title={
              cams.length === 0
                ? 'Add a camera first'
                : 'Start the show: program on air, auto pilot armed'
            }
            onClick={onGoLive}
          />
        </div>
      }
      hints={[{ key: 'ENTER', label: 'GO LIVE (in a field: commit)' }]}
      hintsRight={
        <Mono size={9.5} tracking={0.14} color={OB.dim2}>
          ROOM {room.roomId ?? '—'}
        </Mono>
      }
      contentStyle={{ padding: '12px 16px' }}>
      <GoLiveKey enabled={cams.length > 0} onGoLive={onGoLive} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '360px 440px 1fr',
          gap: 12,
        }}>
        {/* ── event + output ── */}
        <div className='ob-scroll' style={COLUMN}>
          <ObPlate title='EVENT' gap={10}>
            <Field label='EVENT NAME' hint='on the title bug'>
              <TextField
                value={config.eventName}
                onChange={(eventName) => onConfig((c) => ({ ...c, eventName }))}
                maxLength={OB_CONFIG_LIMITS.eventName.max}
                display
                height={36}
                fontSize={20}
                label='Event name'
              />
            </Field>
            <Field
              label='PRESET'
              hint={config.ruleset ? 'custom rules active' : undefined}>
              <PresetGrid
                value={config.presetId}
                onPick={(presetId) =>
                  onConfig((c) => ({
                    ...c,
                    presetId,
                    ruleset: null,
                    // FOLLOW lives on a grid of every camera, which puts no
                    // camera "on air" for audio-follow — force the mix — and
                    // is pointless without host recognition.
                    ...(presetId === 'follow'
                      ? {
                          audio: { mode: 'mix' as const },
                          host: { ...c.host, enabled: true },
                        }
                      : {}),
                  }))
                }
              />
            </Field>
          </ObPlate>
          <ObPlate title='OUTPUT' gap={10}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Meta size={9}>RESOLUTION</Meta>
              <Mono size={11} weight={600}>
                {config.resolution.toUpperCase()}
              </Mono>
              <Meta size={8.5} tracking={0.06} color={OB.dim2}>
                set when the event opened
              </Meta>
            </div>
            <Toggle
              on={config.record}
              tone='program'
              label='RECORD FROM GO LIVE'
              onChange={(record) => onConfig((c) => ({ ...c, record }))}
            />
            <Toggle
              on={config.titleBugVisible}
              label='TITLE BUG (EVENT · SEGMENT)'
              onChange={(titleBugVisible) =>
                onConfig((c) => ({ ...c, titleBugVisible }))
              }
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Meta size={9} style={{ flex: 1 }}>
                LOWER THIRD HOLDS
              </Meta>
              <Stepper
                label='lower third duration'
                value={Math.round(config.lowerThirdMs / 1000)}
                min={OB_CONFIG_LIMITS.lowerThirdMs.min / 1000}
                max={OB_CONFIG_LIMITS.lowerThirdMs.max / 1000}
                render={(v) => `${v} s`}
                onChange={(s) =>
                  onConfig((c) => ({ ...c, lowerThirdMs: s * 1000 }))
                }
                style={{ width: 110 }}
              />
            </div>
          </ObPlate>
          <ObPlate
            title='RUNDOWN'
            right={<Meta size={9}>{config.rundown.length}</Meta>}>
            <RundownEditor
              items={config.rundown}
              onChange={(rundown) => onConfig((c) => ({ ...c, rundown }))}
            />
          </ObPlate>
        </div>

        {/* ── cameras ── */}
        <div className='ob-scroll' style={COLUMN}>
          <ObPlate
            title='CAMERAS'
            right={
              <Meta size={9}>
                {cams.length}/{OB_MAX_CAMS}
              </Meta>
            }>
            <CamList
              cams={cams}
              signals={feed.signals}
              onCmd={operate}
              onKick={(camId) => void room.control('kick_cam', camId)}
            />
          </ObPlate>
          <ObPlate title='JOIN'>
            <JoinPlate links={joinLinks} />
          </ObPlate>
          <ObPlate title='FILE CAMERA'>
            <FileCamPicker room={room} cams={cams} />
          </ObPlate>
          <ObPlate title='ADOPT A ROOM INPUT'>
            <AdoptInputRow room={room} cams={cams} />
          </ObPlate>
        </div>

        {/* ── director + AI ── */}
        <div className='ob-scroll' style={COLUMN}>
          <ObPlate title='DIRECTOR'>
            <DirectorPlate
              config={config}
              onConfig={onConfig}
              cams={cams}
              ruleset={ruleset}
            />
          </ObPlate>
          <ObPlate
            title='AI BRIEF'
            bar={OB.accent}
            right={
              state?.llm.available === false ? (
                <Chip dense label='LLM OFF' disabled />
              ) : null
            }>
            <AiBriefPlate
              room={room}
              brief={config.brief}
              onBrief={(brief) => onConfig((c) => ({ ...c, brief }))}
              llm={state?.llm ?? null}
              onRulesetApplied={onRulesetApplied}
            />
          </ObPlate>
          <ObPlate
            title='HOST RECOGNITION'
            bar={OB.accent}
            right={
              state?.llm.available === false ? (
                <Chip dense label='LLM OFF' disabled />
              ) : null
            }>
            <HostPlate config={config} onConfig={onConfig} />
          </ObPlate>
          <ObPlate title='RULES'>
            <RulesCards
              room={room}
              ruleset={ruleset}
              presetId={config.presetId}
              custom={config.ruleset != null}
              rulesOrigin={config.rulesOrigin}
              onRulesetApplied={onRulesetApplied}
              onResetToPreset={() => onConfig((c) => ({ ...c, ruleset: null }))}
            />
          </ObPlate>
        </div>
      </div>
    </HostFrame>
  );
}

/** Enter (outside a field) = GO LIVE. */
function GoLiveKey({
  enabled,
  onGoLive,
}: {
  enabled: boolean;
  onGoLive: () => void;
}) {
  const ref = React.useRef({ enabled, onGoLive });
  ref.current = { enabled, onGoLive };
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLButtonElement
      )
        return;
      if (!ref.current.enabled) return;
      e.preventDefault();
      ref.current.onGoLive();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return null;
}
