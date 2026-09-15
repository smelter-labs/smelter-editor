'use client';

import React from 'react';
import type { FbEventKind, FbTeamId } from '@smelter-editor/types';
import {
  FB,
  FbButton,
  FbPlate,
  FbSelect,
  Chip,
  Display,
  HostFrame,
  JerseyGrid,
  Meta,
  Mono,
  NameField,
  PlateHead,
  Segment,
  Stepper,
  TeamStripe,
  WarnPlate,
  colorsTooClose,
} from '../fb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';
import type { FbUiConfig } from '../use-fb-room';
import { eventLabel } from '../fb-kit-helpers';

const OUTPUT_RESOLUTIONS: { value: ResolutionPreset; label: string }[] = [
  { value: '720p', label: '720' },
  { value: '1080p', label: '1080' },
  { value: '1440p', label: '1440' },
  { value: '4k', label: '4K' },
];

const AI_KINDS: FbEventKind[] = [
  'goal',
  'chance',
  'shot',
  'corner',
  'goal_kick',
  'sprint',
  'attack',
];
const REPLAY_KINDS: FbEventKind[] = ['goal', 'shot', 'chance', 'corner'];

const PLATE_PAD = '16px 19px';
const CONTROL_H = 30;

function Field({
  label,
  span = 1,
  children,
}: {
  label: string;
  span?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        gridColumn: span > 1 ? `span ${span}` : undefined,
        minWidth: 0,
      }}>
      <Meta size={10} tracking={0.22}>
        {label}
      </Meta>
      {children}
    </div>
  );
}

function KvRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        borderBottom: `1px solid ${FB.rule}`,
        padding: '5px 0',
        minHeight: 34,
      }}>
      <Meta size={10} tracking={0.14}>
        {label}
      </Meta>
      {children}
    </div>
  );
}

function TeamPlate({
  team,
  config,
  onConfig,
}: {
  team: FbTeamId;
  config: FbUiConfig;
  onConfig: (c: FbUiConfig) => void;
}) {
  const t = config.teams[team];
  const other = config.teams[team === 'A' ? 'B' : 'A'];
  const set = (
    patch: Partial<{ name: string; short: string; color: string }>,
  ) =>
    onConfig({
      ...config,
      teams: { ...config.teams, [team]: { ...t, ...patch } },
    });
  return (
    <FbPlate
      cutPx={12}
      style={{
        padding: PLATE_PAD,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TeamStripe color={t.color} w={8} h={15} />
        <Display size={19} weight={800} tracking={0.06}>
          {team === 'A' ? 'HOME · TAGGED' : 'AWAY'}
        </Display>
      </div>
      <Field label='NAME · 16 MAX'>
        <NameField
          value={t.name}
          onChange={(v) => set({ name: v })}
          placeholder={team === 'A' ? 'E.G. TROMSØ' : 'E.G. TOTTENHAM'}
          maxLength={16}
          counter
          height={43}
          fontSize={25}
        />
      </Field>
      <Field label='SHORT · 3–4 LETTERS'>
        <NameField
          value={t.short}
          onChange={(v) => set({ short: v.toUpperCase().slice(0, 4) })}
          placeholder='TIL'
          maxLength={4}
          height={36}
          fontSize={18}
        />
      </Field>
      <Field label='KIT COLOUR'>
        <JerseyGrid
          value={t.color}
          taken={other.color}
          onChange={(hex) => set({ color: hex })}
          gap={5}
        />
      </Field>
    </FbPlate>
  );
}

/** Match, director, AI events and output settings before the match opens. */
export function SetupScreen({
  config,
  onConfig,
  onConfirm,
  onBack,
}: {
  config: FbUiConfig;
  onConfig: (c: FbUiConfig) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  useArcadeKeys({ confirm: onConfirm, back: onBack });
  const tooClose = colorsTooClose(config.teams.A.color, config.teams.B.color);
  const setDirector = (patch: Partial<FbUiConfig['director']>) =>
    onConfig({ ...config, director: { ...config.director, ...patch } });
  const setAi = (patch: Partial<FbUiConfig['ai']>) =>
    onConfig({ ...config, ai: { ...config.ai, ...patch } });
  const setPerf = (patch: Partial<FbUiConfig['perf']>) =>
    onConfig({ ...config, perf: { ...config.perf, ...patch } });
  const toggleKind = (list: FbEventKind[], kind: FbEventKind) =>
    list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind];

  return (
    <HostFrame
      title='MATCH SETUP'
      meta={
        <Meta size={10} tracking={0.22}>
          ROOM · NEW
        </Meta>
      }
      actions={
        <>
          <FbButton
            variant='outline'
            label='BACK'
            onClick={onBack}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <FbButton
            active
            label='OPEN THE MATCH'
            keyBadge='ENTER'
            onClick={onConfirm}
            style={{ height: 43, fontSize: 20, padding: '0 24px' }}
          />
        </>
      }
      hints={[
        { key: 'ENTER', label: 'OPEN' },
        { key: 'ESC', label: 'BACK' },
        { key: 'TAB', label: 'NEXT FIELD' },
      ]}>
      <div
        className='fb-scroll'
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 19,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 13,
            }}>
            <TeamPlate team='A' config={config} onConfig={onConfig} />
            <TeamPlate team='B' config={config} onConfig={onConfig} />
          </div>
          {tooClose ? (
            <WarnPlate cutPx={0} style={{ padding: '7px 12px' }}>
              TEAM COLOURS ARE TOO CLOSE · THE HUD STRIPES WILL BLUR
            </WarnPlate>
          ) : null}
          <FbPlate
            cutPx={12}
            style={{
              padding: PLATE_PAD,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              flex: 1,
            }}>
            <PlateHead
              size={19}
              tracking={0.06}
              right={
                <Meta size={10} tracking={0.22}>
                  2 HALVES
                </Meta>
              }>
              MATCH
            </PlateHead>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '9px 19px',
              }}>
              <Field label='HALF LENGTH'>
                <Stepper
                  height={CONTROL_H}
                  font='mono'
                  fontSize={15}
                  value={config.halfMin}
                  min={1}
                  max={60}
                  onChange={(v) => onConfig({ ...config, halfMin: v })}
                  render={(v) => `${v} MIN`}
                />
              </Field>
              <Field label='MATCH CLOCK'>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 'clip', label: 'FROM THE CLIP' },
                    { value: 'wall', label: 'FROM KICK-OFF' },
                  ]}
                  value={config.clockFromClip ? 'clip' : 'wall'}
                  onChange={(v) =>
                    onConfig({ ...config, clockFromClip: v === 'clip' })
                  }
                />
              </Field>
              <Field label='ATTACKS THE LEFT GOAL (1ST HALF)' span={2}>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 'auto', label: 'FROM THE CLIP' },
                    { value: 'A', label: config.teams.A.short || 'HOME' },
                    { value: 'B', label: config.teams.B.short || 'AWAY' },
                  ]}
                  value={config.attacksLeft ?? 'auto'}
                  onChange={(v) =>
                    onConfig({
                      ...config,
                      attacksLeft: v === 'A' || v === 'B' ? v : null,
                    })
                  }
                />
              </Field>
            </div>
          </FbPlate>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <FbPlate
            cutPx={12}
            texture='lines'
            style={{
              padding: PLATE_PAD,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: 1,
            }}>
            <PlateHead
              size={19}
              tracking={0.06}
              right={
                <Mono
                  size={10}
                  weight={600}
                  tracking={0.22}
                  color={FB.electric}>
                  ● TELEMETRY
                </Mono>
              }>
              DIRECTOR · AI EVENTS
            </PlateHead>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0 16px',
              }}>
              <KvRow label='FOLLOW ZOOM'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 170 }}
                  options={[
                    { value: 'tight', label: 'TIGHT' },
                    { value: 'normal', label: 'NORMAL' },
                    { value: 'wide', label: 'WIDE' },
                  ]}
                  value={config.director.zoom}
                  onChange={(v) =>
                    setDirector({ zoom: v as FbUiConfig['director']['zoom'] })
                  }
                />
              </KvRow>
              <KvRow label='SMOOTHING'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 130 }}
                  options={[
                    { value: 'snappy', label: 'SNAPPY' },
                    { value: 'smooth', label: 'SMOOTH' },
                  ]}
                  value={config.director.smoothing}
                  onChange={(v) =>
                    setDirector({
                      smoothing: v as FbUiConfig['director']['smoothing'],
                    })
                  }
                />
              </KvRow>
              <KvRow label='VIEW SWITCH'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 130 }}
                  options={[
                    { value: 'glide', label: 'GLIDE' },
                    { value: 'cut', label: 'CUT' },
                  ]}
                  value={config.director.switchStyle}
                  onChange={(v) =>
                    setDirector({
                      switchStyle: v as FbUiConfig['director']['switchStyle'],
                    })
                  }
                />
              </KvRow>
              <KvRow label='LOOK-AHEAD'>
                <Stepper
                  height={24}
                  font='mono'
                  fontSize={12}
                  style={{ width: 110 }}
                  value={config.director.lookaheadMs}
                  min={0}
                  max={2000}
                  step={100}
                  onChange={(v) => setDirector({ lookaheadMs: v })}
                  render={(v) => `${v} MS`}
                />
              </KvRow>
              <KvRow label='AI EVENTS'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 90 }}
                  options={[
                    { value: 'on', label: 'ON' },
                    { value: 'off', label: 'OFF' },
                  ]}
                  value={config.ai.events ? 'on' : 'off'}
                  onChange={(v) => setAi({ events: v === 'on' })}
                />
              </KvRow>
              <KvRow label='MINIMAP'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 90 }}
                  options={[
                    { value: 'on', label: 'ON' },
                    { value: 'off', label: 'OFF' },
                  ]}
                  value={config.minimap ? 'on' : 'off'}
                  onChange={(v) => onConfig({ ...config, minimap: v === 'on' })}
                />
              </KvRow>
            </div>
            <Field label='EVENT KINDS'>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {AI_KINDS.map((k) => (
                  <Chip
                    key={k}
                    dense
                    label={eventLabel(k)}
                    active={config.ai.kinds.includes(k)}
                    onClick={() =>
                      setAi({ kinds: toggleKind(config.ai.kinds, k) })
                    }
                  />
                ))}
              </div>
            </Field>
            <Field label='INSTANT REPLAY ON'>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 90 }}
                  options={[
                    { value: 'on', label: 'ON' },
                    { value: 'off', label: 'OFF' },
                  ]}
                  value={config.replay ? 'on' : 'off'}
                  onChange={(v) => onConfig({ ...config, replay: v === 'on' })}
                />
                {REPLAY_KINDS.map((k) => (
                  <Chip
                    key={k}
                    dense
                    label={eventLabel(k)}
                    active={config.ai.replayOn.includes(k)}
                    disabled={!config.replay}
                    onClick={() =>
                      setAi({ replayOn: toggleKind(config.ai.replayOn, k) })
                    }
                  />
                ))}
              </div>
            </Field>
          </FbPlate>
          <FbPlate
            cutPx={12}
            style={{
              padding: PLATE_PAD,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
            <PlateHead
              size={19}
              tracking={0.06}
              right={
                <Meta size={10} tracking={0.22}>
                  FIXED ONCE THE MATCH OPENS
                </Meta>
              }>
              OUTPUT
            </PlateHead>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr',
                gap: 13,
              }}>
              <Field label='RESOLUTION'>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={OUTPUT_RESOLUTIONS.filter(
                    (r) => r.value in RESOLUTION_PRESETS,
                  )}
                  value={config.resolution}
                  onChange={(v) => onConfig({ ...config, resolution: v })}
                />
              </Field>
              <Field label='HUD HZ'>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 10, label: '10' },
                    { value: 5, label: '5' },
                    { value: 2, label: '2' },
                  ]}
                  value={config.perf.hudPublishHz}
                  onChange={(hz) => setPerf({ hudPublishHz: hz as 10 | 5 | 2 })}
                />
              </Field>
              <Field label='RECORDING'>
                <FbSelect
                  value={config.perf.recordingPreset}
                  height={CONTROL_H}
                  onChange={(v) =>
                    setPerf({
                      recordingPreset:
                        v as FbUiConfig['perf']['recordingPreset'],
                    })
                  }>
                  {['ultrafast', 'superfast', 'veryfast', 'fast', 'medium'].map(
                    (p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ),
                  )}
                </FbSelect>
              </Field>
              <Field label='RECORDING SCALE' span={3}>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 1, label: '100 %' },
                    { value: 0.75, label: '75 %' },
                    { value: 0.5, label: '50 %' },
                  ]}
                  value={config.perf.recordingScale}
                  onChange={(s) =>
                    setPerf({ recordingScale: s as 1 | 0.75 | 0.5 })
                  }
                />
              </Field>
            </div>
          </FbPlate>
        </div>
      </div>
    </HostFrame>
  );
}
