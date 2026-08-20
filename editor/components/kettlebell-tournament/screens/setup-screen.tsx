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

const EXERCISES: { key: KbtExerciseKey; label: string; hint: string }[] = [
  { key: 'swing', label: 'SWING', hint: 'two hands, hip snap' },
  { key: 'clean', label: 'CLEAN', hint: 'bell to the rack' },
  { key: 'snatch', label: 'SNATCH', hint: 'one move overhead' },
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
        width: 34,
        height: 34,
        background: KBT.fillStrong,
        border: `1px solid ${KBT.border}`,
        color: disabled ? KBT.dim : KBT.cream,
        fontFamily: kbtMonoFont,
        fontWeight: 600,
        fontSize: 15,
      }}>
      {glyph}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {btn('-', -step, value <= min)}
      <Num size={22} style={{ minWidth: 64, textAlign: 'center' }}>
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
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
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
                  gap: 16,
                  padding: '14px 18px',
                  opacity: rule.enabled ? 1 : 0.55,
                }}>
                <div
                  style={{
                    width: 150,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}>
                  <DisplayText size={22} weight={700} tracking={2}>
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
          <Plate
            cutPx={14}
            accentBar={config.strictTechnique}
            accentColor={KBT.amber}
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 18px',
            }}>
            <div
              style={{
                width: 260,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}>
              <DisplayText
                size={20}
                weight={700}
                tracking={2}
                color={config.strictTechnique ? KBT.cream : KBT.dim}>
                STRICT JUDGING
              </DisplayText>
              <Label size={10} tracking={1.5}>
                sloppy reps pay half points
              </Label>
            </div>
            <ToggleChip
              on={config.strictTechnique}
              onToggle={() =>
                onConfig({
                  ...config,
                  strictTechnique: !config.strictTechnique,
                })
              }
            />
          </Plate>
        </div>

        <div
          style={{
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <Label size={11}>HEAT FORMAT</Label>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '16px 18px',
            }}>
            <DisplayText size={18} weight={700} tracking={2}>
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
              gap: 10,
              padding: '16px 18px',
            }}>
            <DisplayText size={18} weight={700} tracking={2}>
              LIFTERS PER HEAT
            </DisplayText>
            <div style={{ display: 'flex', gap: 10 }}>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type='button'
                  className='kbt-btn'
                  onClick={() => onConfig({ ...config, heatSize: n })}
                  style={{
                    width: 52,
                    height: 44,
                    fontFamily: kbtMonoFont,
                    fontWeight: 600,
                    fontSize: 16,
                    background:
                      config.heatSize === n ? KBT.accent : KBT.fillStrong,
                    color: config.heatSize === n ? KBT.dark : KBT.dim,
                    border: `1px solid ${
                      config.heatSize === n ? KBT.accent : KBT.border
                    }`,
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <Label size={10} tracking={1.5} style={{ textTransform: 'none' }}>
              Side-by-side camera tiles; more lifters = smaller tiles and a
              busier AI referee.
            </Label>
          </Plate>
          <Plate cutPx={14} innerStyle={{ padding: '14px 18px' }}>
            <span
              style={{
                fontFamily: kbtMonoFont,
                fontSize: 11,
                lineHeight: 1.7,
                letterSpacing: 0.5,
                color: KBT.dim,
              }}>
              Defaults pay 1 / 2 / 3 points for swing / clean / snatch — harder
              lifts pay more. Everyone lifts once; the best board scores meet in
              the final.
            </span>
          </Plate>
        </div>
      </div>
    </Frame>
  );
}
