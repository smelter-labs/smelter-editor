'use client';

import React from 'react';
import type { KbtExerciseKey } from '@smelter-editor/types';
import {
  ChipButton,
  DisplayText,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  Tab,
  kbtMonoFont,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import type { KbtUiConfig } from '../use-kbt-room';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';

const EXERCISES: { key: KbtExerciseKey; label: string; hint: string }[] = [
  { key: 'swing', label: 'SWING', hint: 'two hands, hip snap' },
  { key: 'clean', label: 'CLEAN', hint: 'bell to the rack' },
  { key: 'snatch', label: 'SNATCH', hint: 'one move overhead' },
];

/** Broadcast sizes on offer — landscape only, the HUD is a landscape scene. */
const OUTPUT_RESOLUTIONS: { value: ResolutionPreset; label: string }[] = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '1440p', label: '1440p' },
  { value: '4k', label: '4K' },
];

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  render,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  render?: (v: number) => string;
}) {
  const btn = (glyph: string, delta: number, disabled: boolean) => (
    <button
      type='button'
      className='kbt-btn'
      disabled={disabled}
      onClick={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      style={{
        width: 30,
        height: 30,
        background: KBT.fillStrong,
        border: `1px solid ${KBT.border}`,
        color: KBT.cream,
        fontFamily: kbtMonoFont,
        fontWeight: 600,
        fontSize: 14,
      }}>
      {glyph}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {btn('-', -step, value <= min)}
      <Num size={19} style={{ minWidth: 56, textAlign: 'center' }}>
        {render ? render(value) : `${value}`}
      </Num>
      {btn('+', step, value >= max)}
    </div>
  );
}

function ToggleChip({
  on,
  onToggle,
  labels = ['ON', 'OFF'],
}: {
  on: boolean;
  onToggle: () => void;
  labels?: [string, string] | string[];
}) {
  return (
    <ChipButton
      label={on ? labels[0] : labels[1]}
      active={on}
      onClick={onToggle}
    />
  );
}

function TogglePlate({
  label,
  hint,
  on,
  onToggle,
  accentColor,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  accentColor?: string;
}) {
  return (
    <Plate
      cutPx={14}
      accentBar={on}
      accentColor={accentColor}
      innerStyle={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        height: '100%',
        boxSizing: 'border-box',
      }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
        <DisplayText
          size={17}
          weight={700}
          tracking={2}
          color={on ? KBT.cream : KBT.dim}>
          {label}
        </DisplayText>
        <Label size={10} tracking={1.5}>
          {hint}
        </Label>
      </div>
      <ToggleChip on={on} onToggle={onToggle} />
    </Plate>
  );
}

/** Scoring rules + heat format, persisted host-side. */
export function SetupScreen({
  config,
  onConfig,
  onConfirm,
  onBack,
}: {
  config: KbtUiConfig;
  onConfig: (c: KbtUiConfig) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  useArcadeKeys({ confirm: onConfirm, back: onBack });

  const patchScoring = (
    key: KbtExerciseKey,
    patch: Partial<{ enabled: boolean; points: number }>,
  ) =>
    onConfig({
      ...config,
      scoring: {
        ...config.scoring,
        [key]: { ...config.scoring[key], ...patch },
      },
    });

  return (
    <Frame
      title='RULES'
      tab={<Tab>SETUP</Tab>}
      footer={
        <FooterHint
          hints={[
            { key: 'ENTER', label: 'OPEN ARENA' },
            { key: 'ESC', label: 'BACK' },
          ]}
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <KbtButton
                variant='outline'
                dense
                label='BACK'
                onClick={onBack}
              />
              <KbtButton
                variant='solid'
                dense
                label='OPEN ARENA'
                active
                onClick={onConfirm}
              />
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        <div
          className='kbt-scroll'
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
          <Label size={11}>SCORING</Label>
          {EXERCISES.map(({ key, label, hint }) => {
            const rule = config.scoring[key];
            return (
              <Plate
                key={key}
                cutPx={14}
                accentBar={rule.enabled}
                innerStyle={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  opacity: rule.enabled ? 1 : 0.55,
                }}>
                <div
                  style={{
                    width: 170,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}>
                  <DisplayText size={19} weight={700} tracking={2}>
                    {label}
                  </DisplayText>
                  <Label size={10} tracking={1.5}>
                    {hint}
                  </Label>
                </div>
                <ToggleChip
                  on={rule.enabled}
                  onToggle={() => patchScoring(key, { enabled: !rule.enabled })}
                  labels={['COUNTS', 'OFF']}
                />
                <div style={{ flex: 1 }} />
                <Label size={10} tracking={2}>
                  PTS/REP
                </Label>
                <Stepper
                  value={rule.points}
                  min={0}
                  max={10}
                  onChange={(points) => patchScoring(key, { points })}
                />
              </Plate>
            );
          })}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}>
            <TogglePlate
              label='STRICT JUDGING'
              hint='sloppy reps pay half points'
              on={config.strictTechnique}
              accentColor={KBT.amber}
              onToggle={() =>
                onConfig({
                  ...config,
                  strictTechnique: !config.strictTechnique,
                })
              }
            />
            <TogglePlate
              label='REP SCREENSHOTS'
              hint='AI snaps each rep at the top of the lift'
              on={config.repScreenshots}
              onToggle={() =>
                onConfig({
                  ...config,
                  repScreenshots: !config.repScreenshots,
                })
              }
            />
            <TogglePlate
              label='MILESTONE FX'
              hint='Every 5th rep fires an aura + camera shake on air'
              on={config.milestoneFx}
              onToggle={() =>
                onConfig({
                  ...config,
                  milestoneFx: !config.milestoneFx,
                })
              }
            />
            <TogglePlate
              label='REP FLOAT TEXT'
              hint='Scored reps float game text up the tile'
              on={config.repFloatText}
              onToggle={() =>
                onConfig({
                  ...config,
                  repFloatText: !config.repFloatText,
                })
              }
            />
            <TogglePlate
              label='COUNT NO REPS'
              hint='off: incorrect reps score nothing and are struck out on air'
              on={config.countIncorrectReps}
              onToggle={() =>
                onConfig({
                  ...config,
                  countIncorrectReps: !config.countIncorrectReps,
                })
              }
            />
          </div>
        </div>

        <div
          className='kbt-scroll'
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: 6,
          }}>
          <Label size={11}>HEAT FORMAT</Label>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
            }}>
            <DisplayText size={16} weight={700} tracking={2}>
              ROUND CLOCK
            </DisplayText>
            <Stepper
              value={config.heatDurationSec}
              min={30}
              max={300}
              step={15}
              onChange={(heatDurationSec) =>
                onConfig({ ...config, heatDurationSec })
              }
              render={(v) =>
                `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
              }
            />
            <Label size={10} tracking={1.5}>
              AMRAP — as many reps as possible before the buzzer.
            </Label>
          </Plate>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
            }}>
            <DisplayText size={16} weight={700} tracking={2}>
              LIFTERS PER HEAT
            </DisplayText>
            <div style={{ display: 'flex', gap: 10 }}>
              {[2, 3, 4].map((n) => (
                <ChipButton
                  key={n}
                  label={String(n)}
                  active={config.heatSize === n}
                  onClick={() => onConfig({ ...config, heatSize: n })}
                  style={{ width: 46, height: 38, fontSize: 14 }}
                />
              ))}
            </div>
            <Label size={10} tracking={1.5} style={{ textTransform: 'none' }}>
              More lifters = smaller tiles, busier AI referee.
            </Label>
          </Plate>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
            }}>
            <DisplayText size={16} weight={700} tracking={2}>
              CAMERA ANGLE
            </DisplayText>
            <div style={{ display: 'flex', gap: 10 }}>
              {(
                [
                  { value: 'front', label: 'FACING CAMERA' },
                  { value: 'side', label: 'SIDE-ON' },
                ] as const
              ).map(({ value, label }) => (
                <ChipButton
                  key={value}
                  label={label}
                  active={config.cameraView === value}
                  onClick={() => onConfig({ ...config, cameraView: value })}
                  style={{ height: 38, padding: '0 14px', fontSize: 12 }}
                />
              ))}
            </div>
            <Label size={10} tracking={1.5} style={{ textTransform: 'none' }}>
              Side-on lets the AI judge full technique; facing the camera judges
              bell height only.
            </Label>
          </Plate>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 14px',
            }}>
            <DisplayText size={16} weight={700} tracking={2}>
              OUTPUT
            </DisplayText>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {OUTPUT_RESOLUTIONS.map(({ value, label }) => (
                <ChipButton
                  key={value}
                  label={label}
                  active={config.resolution === value}
                  onClick={() => onConfig({ ...config, resolution: value })}
                  style={{ height: 38, padding: '0 14px', fontSize: 12 }}
                />
              ))}
            </div>
            <Label size={10} tracking={1.5} style={{ textTransform: 'none' }}>
              {`Broadcast size ${RESOLUTION_PRESETS[config.resolution].width}×${RESOLUTION_PRESETS[config.resolution].height} — set when the arena opens. HD (1080p) is the default.`}
            </Label>
          </Plate>
          <Plate cutPx={14} innerStyle={{ padding: '10px 14px' }}>
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 11,
                lineHeight: 1.7,
                letterSpacing: 0.5,
                color: KBT.dim,
              }}>
              Defaults pay 1 / 2 / 3 pts for swing / clean / snatch. The best
              board scores meet in the final.
            </span>
          </Plate>
        </div>
      </div>
    </Frame>
  );
}
