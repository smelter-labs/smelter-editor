'use client';

import React from 'react';
import type { KbtExerciseKey } from '@smelter-editor/types';
import {
  LedText,
  PanelTitle,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
} from '../../duck-hunter/retro-kit';
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
      className='r5-btn'
      disabled={disabled}
      onClick={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      style={{
        width: 34,
        height: 34,
        background: disabled
          ? 'rgba(120,150,200,0.10)'
          : 'rgba(120,150,200,0.2)',
        color: disabled ? R5.inkMuted : R5.ink,
        fontFamily: pixelFont,
        fontSize: 13,
      }}>
      {glyph}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {btn('-', -step, value <= min)}
      <LedText size={22} style={{ minWidth: 64, textAlign: 'center' }}>
        {render ? render(value) : `${value}`}
      </LedText>
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
    <button
      type='button'
      className='r5-btn'
      onClick={onToggle}
      style={{
        fontFamily: pixelFont,
        fontSize: 10,
        letterSpacing: 1,
        padding: '9px 14px',
        background: on ? `rgba(${R5.greenRgb},0.22)` : 'rgba(120,150,200,0.12)',
        color: on ? R5.green : R5.inkMuted,
        border: `1px solid ${on ? R5.green : 'rgba(120,150,200,0.35)'}`,
      }}>
      {on ? labels[0] : labels[1]}
    </button>
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
    <RetroFrame
      title='TOURNAMENT RULES'
      eyebrow='KETTLEBELL TOURNAMENT'
      subtitle='WHAT COUNTS · WHAT PAYS'
      titleSize={26}
      footer={
        <RetroFooter
          tip='enter to open the arena · esc back'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='BACK'
                onClick={onBack}
              />
              <PixelButton
                accent='green'
                glyph='A'
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
          <PanelTitle>SCORING</PanelTitle>
          {EXERCISES.map(({ key, label, hint }) => {
            const rule = config.scoring[key];
            return (
              <PixelPanel
                key={key}
                accent={rule.enabled ? 'cyan' : 'blue'}
                cut={10}
                innerStyle={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  opacity: rule.enabled ? 1 : 0.55,
                }}>
                <div style={{ width: 150 }}>
                  <div
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 13,
                      letterSpacing: 1.5,
                      color: rule.enabled ? R5.cyan : R5.inkMuted,
                    }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: monoFont,
                      fontSize: 10,
                      color: R5.inkMuted,
                    }}>
                    {hint}
                  </div>
                </div>
                <ToggleChip
                  on={rule.enabled}
                  onToggle={() => patchScoring(key, { enabled: !rule.enabled })}
                  labels={['COUNTS', 'OFF']}
                />
                <div style={{ flex: 1 }} />
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 11,
                    color: R5.inkMuted,
                  }}>
                  PTS/REP
                </span>
                <Stepper
                  value={rule.points}
                  min={0}
                  max={10}
                  onChange={(points) => patchScoring(key, { points })}
                />
              </PixelPanel>
            );
          })}
          <PixelPanel
            accent={config.strictTechnique ? 'orange' : 'blue'}
            cut={10}
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '12px 16px',
            }}>
            <div style={{ width: 260 }}>
              <div
                style={{
                  fontFamily: pixelFont,
                  fontSize: 12,
                  letterSpacing: 1.5,
                  color: config.strictTechnique ? R5.orangeBright : R5.inkMuted,
                }}>
                STRICT JUDGING
              </div>
              <div
                style={{
                  fontFamily: monoFont,
                  fontSize: 10,
                  color: R5.inkMuted,
                }}>
                sloppy reps pay half points
              </div>
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
          </PixelPanel>
        </div>

        <div
          style={{
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>HEAT FORMAT</PanelTitle>
          <PixelPanel
            accent='yellow'
            cut={10}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 16px',
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 11,
                letterSpacing: 1.5,
                color: R5.yellow,
              }}>
              ROUND CLOCK
            </span>
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
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
              }}>
              AMRAP — as many reps as possible before the buzzer.
            </span>
          </PixelPanel>
          <PixelPanel
            accent='yellow'
            cut={10}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 16px',
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 11,
                letterSpacing: 1.5,
                color: R5.yellow,
              }}>
              LIFTERS PER HEAT
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type='button'
                  className='r5-btn'
                  onClick={() => onConfig({ ...config, heatSize: n })}
                  style={{
                    width: 52,
                    height: 44,
                    fontFamily: pixelFont,
                    fontSize: 15,
                    background:
                      config.heatSize === n
                        ? `rgba(${R5.yellowRgb},0.25)`
                        : 'rgba(120,150,200,0.12)',
                    color: config.heatSize === n ? R5.yellow : R5.inkMuted,
                    border: `1px solid ${
                      config.heatSize === n
                        ? R5.yellow
                        : 'rgba(120,150,200,0.35)'
                    }`,
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
              }}>
              Side-by-side camera tiles; more lifters = smaller tiles and a
              busier AI referee.
            </span>
          </PixelPanel>
          <PixelPanel
            accent='blue'
            cut={10}
            innerStyle={{ padding: '12px 16px' }}>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 11,
                lineHeight: 1.6,
                color: R5.inkMuted,
              }}>
              Defaults pay 1 / 2 / 3 points for swing / clean / snatch — harder
              lifts pay more. Everyone lifts once; the best board scores meet in
              the final.
            </span>
          </PixelPanel>
        </div>
      </div>
    </RetroFrame>
  );
}
