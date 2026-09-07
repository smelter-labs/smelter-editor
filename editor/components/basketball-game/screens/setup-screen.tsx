'use client';

import React from 'react';
import type { BbTeamId } from '@smelter-editor/types';
import {
  ChipButton,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  KbtSelect,
  KbtTextInput,
  Label,
  Num,
  Plate,
  PlateTitle,
  WarnPlate,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';
import type { BbUiConfig } from '../use-bb-room';
import { ColorPicker, TeamSwatch, colorsTooClose } from '../bb-kit';

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
      onClick={() =>
        onChange(
          Math.round(Math.min(max, Math.max(min, value + delta)) * 1000) / 1000,
        )
      }
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
      <Num size={19} style={{ minWidth: 64, textAlign: 'center' }}>
        {render ? render(value) : `${value}`}
      </Num>
      {btn('+', step, value >= max)}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 34,
      }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Label size={10} tracking={2} color={KBT.cream}>
          {label}
        </Label>
        {hint ? (
          <Label size={9} tracking={1}>
            {hint}
          </Label>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function TeamEditor({
  team,
  config,
  onConfig,
}: {
  team: BbTeamId;
  config: BbUiConfig;
  onConfig: (c: BbUiConfig) => void;
}) {
  const t = config.teams[team];
  const set = (patch: Partial<{ name: string; color: string }>) =>
    onConfig({
      ...config,
      teams: { ...config.teams, [team]: { ...t, ...patch } },
    });
  return (
    <Plate
      cutPx={14}
      accentBar
      accentColor={t.color}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
      }}>
      <PlateTitle
        right={
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TeamSwatch color={t.color} />
            <Label size={9} tracking={1.5}>
              JERSEY / BIB
            </Label>
          </span>
        }>
        TEAM {team}
      </PlateTitle>
      <KbtTextInput
        value={t.name}
        onChange={(v) => set({ name: v })}
        placeholder={team === 'A' ? 'E.G. BLACKTOP' : 'E.G. CHALK CREW'}
        maxLength={16}
        autoCapitalize='characters'
      />
      <ColorPicker value={t.color} onChange={(hex) => set({ color: hex })} />
    </Plate>
  );
}

/** Rules, teams, AI referee and output settings before the court opens. */
export function SetupScreen({
  config,
  onConfig,
  onConfirm,
  onBack,
}: {
  config: BbUiConfig;
  onConfig: (c: BbUiConfig) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  useArcadeKeys({ confirm: onConfirm, back: onBack });
  const tooClose = colorsTooClose(config.teams.A.color, config.teams.B.color);
  const det = config.detector;
  const setDet = (patch: Partial<BbUiConfig['detector']>) =>
    onConfig({ ...config, detector: { ...det, ...patch } });
  const setPerf = (patch: Partial<BbUiConfig['perf']>) =>
    onConfig({ ...config, perf: { ...config.perf, ...patch } });

  return (
    <Frame
      title='MATCH SETUP'
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <FooterHint
            hints={[
              { key: 'ESC', label: 'BACK' },
              { key: 'ENTER', label: 'OPEN THE COURT' },
            ]}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <KbtButton label='BACK' variant='outline' onClick={onBack} />
            <KbtButton label='OPEN THE COURT' active onClick={onConfirm} />
          </div>
        </div>
      }>
      <div
        className='kbt-scroll'
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: 4,
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TeamEditor team='A' config={config} onConfig={onConfig} />
          <TeamEditor team='B' config={config} onConfig={onConfig} />
          {tooClose ? (
            <WarnPlate>
              TEAM COLOURS ARE TOO CLOSE — the AI tells shooters apart by jersey
              colour. Pick two contrasting bibs.
            </WarnPlate>
          ) : null}
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
            }}>
            <PlateTitle>RULES · FIBA 3x3</PlateTitle>
            <Row label='FORMAT'>
              <div style={{ display: 'flex', gap: 6 }}>
                {([1, 2, 3] as const).map((n) => (
                  <ChipButton
                    key={n}
                    label={`${n}v${n}`}
                    active={config.teamSize === n}
                    onClick={() => onConfig({ ...config, teamSize: n })}
                  />
                ))}
              </div>
            </Row>
            <Row label='FIRST TO' hint='points that end the game'>
              <Stepper
                value={config.targetPoints}
                min={5}
                max={51}
                onChange={(v) => onConfig({ ...config, targetPoints: v })}
              />
            </Row>
            <Row label='GAME CLOCK' hint='overtime if tied at the buzzer'>
              <Stepper
                value={config.durationSec}
                min={60}
                max={1800}
                step={60}
                onChange={(v) => onConfig({ ...config, durationSec: v })}
                render={(v) => `${Math.round(v / 60)} MIN`}
              />
            </Row>
            <Row label='OVERTIME' hint='first team to score this many'>
              <Stepper
                value={config.otWinPoints}
                min={1}
                max={5}
                onChange={(v) => onConfig({ ...config, otWinPoints: v })}
                render={(v) => `+${v}`}
              />
            </Row>
            <Row label='BEYOND THE ARC' hint='the moderator marks a long one'>
              <div style={{ display: 'flex', gap: 6 }}>
                {([1, 2] as const).map((n) => (
                  <ChipButton
                    key={n}
                    label={`${n} PT`}
                    active={config.arcPoints === n}
                    onClick={() => onConfig({ ...config, arcPoints: n })}
                  />
                ))}
              </div>
            </Row>
          </Plate>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
            }}>
            <PlateTitle>AI REFEREE</PlateTitle>
            <Row
              label='AUTO-CALL ABOVE'
              hint='below this the make waits for the moderator'>
              <Stepper
                value={config.autoAssignMinConf}
                min={0.3}
                max={0.95}
                step={0.05}
                onChange={(v) => onConfig({ ...config, autoAssignMinConf: v })}
                render={(v) => `${Math.round(v * 100)}%`}
              />
            </Row>
            <Row
              label='SHOT STILLS'
              hint='release + make frames on air and in the queue'>
              <ChipButton
                label={config.shotFrames ? 'ON' : 'OFF'}
                active={config.shotFrames}
                onClick={() =>
                  onConfig({ ...config, shotFrames: !config.shotFrames })
                }
              />
            </Row>
            <Row label='BALL DETECTOR'>
              <KbtSelect
                label=''
                value={det.ballDetector}
                onChange={(v) =>
                  setDet({ ballDetector: v as typeof det.ballDetector })
                }>
                <option value='auto'>YOLO + HSV FALLBACK</option>
                <option value='yolo'>YOLO ONLY</option>
                <option value='hsv'>HSV BLOB ONLY (TEST CLIPS)</option>
              </KbtSelect>
            </Row>
            <Row label='YOLO WEIGHTS'>
              <KbtSelect
                label=''
                value={det.yoloWeights}
                onChange={(v) =>
                  setDet({ yoloWeights: v as typeof det.yoloWeights })
                }>
                <option value='auto'>AUTO (GPU → SMALL, CPU → NANO)</option>
                <option value='yolo11n.pt'>NANO</option>
                <option value='yolo11s.pt'>SMALL</option>
                <option value='yolo11m.pt'>MEDIUM</option>
              </KbtSelect>
            </Row>
            <Row
              label='INFERENCE SIZE'
              hint='bigger catches a far ball, slower on CPU'>
              <Stepper
                value={det.imgsz}
                min={320}
                max={1280}
                step={160}
                onChange={(v) => setDet({ imgsz: v })}
              />
            </Row>
            <Row label='ANALYSIS FPS'>
              <Stepper
                value={det.analysisFps}
                min={8}
                max={30}
                onChange={(v) => setDet({ analysisFps: v })}
              />
            </Row>
            <Row label='BALL CONFIDENCE'>
              <Stepper
                value={det.ballConf}
                min={0.05}
                max={0.9}
                step={0.05}
                onChange={(v) => setDet({ ballConf: v })}
                render={(v) => v.toFixed(2)}
              />
            </Row>
          </Plate>
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
            }}>
            <PlateTitle>OUTPUT</PlateTitle>
            <Row label='RESOLUTION' hint='fixed once the court opens'>
              <div style={{ display: 'flex', gap: 6 }}>
                {OUTPUT_RESOLUTIONS.filter(
                  (r) => r.value in RESOLUTION_PRESETS,
                ).map((r) => (
                  <ChipButton
                    key={r.value}
                    label={r.label}
                    active={config.resolution === r.value}
                    onClick={() => onConfig({ ...config, resolution: r.value })}
                  />
                ))}
              </div>
            </Row>
            <Row label='HUD PUBLISH' hint='Hz'>
              <div style={{ display: 'flex', gap: 6 }}>
                {([10, 5, 2] as const).map((hz) => (
                  <ChipButton
                    key={hz}
                    label={String(hz)}
                    active={config.perf.hudPublishHz === hz}
                    onClick={() => setPerf({ hudPublishHz: hz })}
                  />
                ))}
              </div>
            </Row>
            <Row label='RECORDING PRESET'>
              <KbtSelect
                label=''
                value={config.perf.recordingPreset}
                onChange={(v) =>
                  setPerf({
                    recordingPreset: v as BbUiConfig['perf']['recordingPreset'],
                  })
                }>
                {['ultrafast', 'superfast', 'veryfast', 'fast', 'medium'].map(
                  (p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ),
                )}
              </KbtSelect>
            </Row>
            <Row label='RECORDING SCALE'>
              <div style={{ display: 'flex', gap: 6 }}>
                {([1, 0.75, 0.5] as const).map((s) => (
                  <ChipButton
                    key={s}
                    label={`${Math.round(s * 100)}%`}
                    active={config.perf.recordingScale === s}
                    onClick={() => setPerf({ recordingScale: s })}
                  />
                ))}
              </div>
            </Row>
          </Plate>
        </div>
      </div>
    </Frame>
  );
}
