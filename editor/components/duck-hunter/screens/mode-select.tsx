'use client';

import { useEffect, useMemo, useState } from 'react';
import { getMP4Suggestions } from '@/app/actions/actions';
import type { MatchSetup } from '../arcade';
import type { ArcadeCharacter } from '../characters';
import type { DuckHunterSliderConfig } from '../use-duck-hunter-room';
import {
  ACCENT_LINE,
  ACCENT_RGB,
  LedText,
  PanelTitle,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

const TIME_PRESETS_MS = [60_000, 120_000] as const;
const POINT_PRESETS = [10, 25] as const;

// Slider bounds — mirror the server clamps (DuckHunterController/RoomState),
// same as the dashboard DuckHunterPanel.
const SLIDER_DEFS: Array<{
  key: keyof DuckHunterSliderConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = [
  { key: 'maxAmmo', label: 'ROUNDS', min: 1, max: 12, step: 1, format: (v) => String(v) },
  { key: 'reloadSec', label: 'RELOAD', min: 1, max: 30, step: 0.5, format: (v) => `${v.toFixed(1)}S` },
  { key: 'duckScale', label: 'DUCK SIZE', min: 0.25, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}X` },
  { key: 'fleeSec', label: 'FLY OFF', min: 0, max: 10, step: 0.1, format: (v) => `${v.toFixed(1)}S` },
  { key: 'flySpeed', label: 'FLY SPEED', min: 0.1, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}X` },
];

/**
 * Mode + config: pick TIME ATTACK or SCORE RUSH (with presets), the hunt
 * stage video (any mp4 from the server library — this is where ducks are
 * detected and spawned) and the room tuning sliders.
 */
export function ModeSelect({
  character,
  setup,
  onSetup,
  sliders,
  onSliders,
  stageFile,
  onStageFile,
  onConfirm,
  onBack,
}: {
  character: ArcadeCharacter;
  setup: MatchSetup;
  onSetup: (s: MatchSetup) => void;
  sliders: DuckHunterSliderConfig;
  onSliders: (s: DuckHunterSliderConfig) => void;
  stageFile: string;
  onStageFile: (f: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [mp4s, setMp4s] = useState<string[]>([]);

  useEffect(() => {
    void getMP4Suggestions()
      .then((s) => setMp4s(s.mp4s))
      .catch(() => setMp4s([]));
  }, []);

  // The character select-screen clips are menu assets, not hunting grounds.
  const stages = useMemo(() => {
    const list = mp4s.filter((f) => !f.startsWith('duck-hunter-characters/'));
    // Keep the default stage visible even before the suggestions load.
    return list.includes(stageFile) || !stageFile
      ? list
      : [stageFile, ...list];
  }, [mp4s, stageFile]);

  const stageIdx = Math.max(0, stages.indexOf(stageFile));

  useArcadeKeys({
    left: () => onSetup({ ...setup, mode: 'time' }),
    right: () => onSetup({ ...setup, mode: 'points' }),
    up: () => {
      if (stages.length > 0) {
        onStageFile(stages[(stageIdx - 1 + stages.length) % stages.length]);
      }
    },
    down: () => {
      if (stages.length > 0) {
        onStageFile(stages[(stageIdx + 1) % stages.length]);
      }
    },
    confirm: onConfirm,
    back: onBack,
  });

  const modeCard = (
    mode: MatchSetup['mode'],
    title: string,
    desc: string,
    presets: React.ReactNode,
  ) => {
    const active = setup.mode === mode;
    const accent = active ? 'yellow' : 'blue';
    // A div, not a <button>: the preset chips inside are buttons themselves
    // and buttons must not nest.
    return (
      <div
        role='button'
        tabIndex={0}
        className='r5-btn'
        onClick={() => onSetup({ ...setup, mode })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSetup({ ...setup, mode });
        }}
        style={{ display: 'block', width: '100%' }}>
        <PixelPanel
          accent={accent}
          cut={10}
          glow={active ? 0.7 : 0}
          fill={active ? `rgba(${ACCENT_RGB.yellow},0.08)` : undefined}
          innerStyle={{
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 13,
              letterSpacing: 1.5,
              color: active ? R5.yellow : R5.ink,
              textShadow: active
                ? `0 0 10px rgba(${R5.yellowRgb},0.6)`
                : undefined,
            }}>
            {title}
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
            {desc}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>{presets}</div>
        </PixelPanel>
      </div>
    );
  };

  const presetChip = (
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={label}
      type='button'
      className='r5-btn'
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        fontFamily: pixelFont,
        fontSize: 10,
        letterSpacing: 1,
        padding: '6px 10px',
        color: active ? R5.bgDeep : R5.inkMuted,
        background: active ? R5.yellow : 'rgba(120,150,200,0.12)',
        boxShadow: active
          ? `0 0 8px rgba(${R5.yellowRgb},0.6)`
          : 'inset 0 0 0 1px rgba(120,150,200,0.25)',
      }}>
      {label}
    </button>
  );

  return (
    <RetroFrame
      title='GAME SETUP'
      eyebrow='DUCK HUNTER'
      subtitle={`HUNTER: ${character.name}`}
      titleSize={26}
      footer={
        <RetroFooter
          tip='◀ ▶ mode · ▲ ▼ stage · enter lobby'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton accent='red' glyph='B' label='BACK' onClick={onBack} />
              <PixelButton
                accent='green'
                glyph='A'
                label='OPEN LOBBY'
                active
                onClick={onConfirm}
              />
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        {/* Mode */}
        <div
          style={{
            width: 330,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>MODE</PanelTitle>
          {modeCard(
            'time',
            'TIME ATTACK',
            'Fixed clock. Most ducks when the timer hits zero wins.',
            TIME_PRESETS_MS.map((ms) =>
              presetChip(`${ms / 1000}S`, setup.mode === 'time' && setup.durationMs === ms, () =>
                onSetup({ ...setup, mode: 'time', durationMs: ms }),
              ),
            ),
          )}
          {modeCard(
            'points',
            'SCORE RUSH',
            'No clock. First hunter to the target score wins.',
            POINT_PRESETS.map((n) =>
              presetChip(`${n} PTS`, setup.mode === 'points' && setup.targetScore === n, () =>
                onSetup({ ...setup, mode: 'points', targetScore: n }),
              ),
            ),
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              justifyContent: 'center',
              marginTop: 4,
            }}>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 11,
                color: R5.inkMuted,
                textTransform: 'uppercase',
              }}>
              round
            </span>
            <LedText size={26}>
              {setup.mode === 'time'
                ? `${setup.durationMs / 1000}s`
                : `${setup.targetScore} pts`}
            </LedText>
          </div>
        </div>

        {/* Hunting grounds (stage mp4) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>HUNTING GROUNDS</PanelTitle>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingRight: 6,
            }}>
            {stages.length === 0 ? (
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 12,
                  color: R5.inkMuted,
                }}>
                No mp4s on the server yet — drop files into data/mp4s.
              </span>
            ) : (
              stages.map((f) => {
                const active = f === stageFile;
                return (
                  <button
                    key={f}
                    type='button'
                    className='r5-btn'
                    onClick={() => onStageFile(f)}
                    style={{ display: 'block', width: '100%' }}>
                    <PixelPanel
                      accent={active ? 'yellow' : 'blue'}
                      cut={8}
                      glow={active ? 0.6 : 0}
                      innerStyle={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 8,
                      }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/mp4-thumbnail?fileName=${encodeURIComponent(f)}`}
                        alt=''
                        width={92}
                        height={52}
                        style={{
                          width: 92,
                          height: 52,
                          objectFit: 'cover',
                          background: R5.panelDark,
                          imageRendering: 'auto',
                          flexShrink: 0,
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.visibility =
                            'hidden';
                        }}
                      />
                      <span
                        style={{
                          fontFamily: monoFont,
                          fontSize: 12,
                          color: active ? R5.yellow : R5.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                        {f}
                      </span>
                    </PixelPanel>
                  </button>
                );
              })
            )}
          </div>
          <span
            style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
            Ducks are detected in this footage and turned into targets.
          </span>
        </div>

        {/* Tuning sliders */}
        <div
          style={{
            width: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle color={ACCENT_LINE[character.accent]}>TUNING</PanelTitle>
          <PixelPanel
            cut={10}
            innerStyle={{
              padding: '16px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}>
            {SLIDER_DEFS.map((def) => (
              <label key={def.key} style={{ display: 'block' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 4,
                  }}>
                  <span
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 8,
                      letterSpacing: 1,
                      color: R5.ink,
                    }}>
                    {def.label}
                  </span>
                  <LedText size={16}>{def.format(sliders[def.key])}</LedText>
                </div>
                <input
                  type='range'
                  className='r5-range'
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={sliders[def.key]}
                  onChange={(e) =>
                    onSliders({
                      ...sliders,
                      [def.key]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </PixelPanel>
        </div>
      </div>
    </RetroFrame>
  );
}
