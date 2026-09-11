'use client';

import React from 'react';
import type { BbTeamId } from '@smelter-editor/types';
import { BB_DETECTOR_PRESETS } from '@smelter-editor/types';
import {
  BB,
  BbButton,
  BbPlate,
  BbSelect,
  Display,
  HostFrame,
  JerseyGrid,
  Meta,
  Mono,
  NameField,
  PlateHead,
  ProgressBar,
  Segment,
  Stepper,
  TeamStripe,
  WarnPlate,
  colorsTooClose,
} from '../bb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';
import type { BbUiConfig } from '../use-bb-room';

const OUTPUT_RESOLUTIONS: { value: ResolutionPreset; label: string }[] = [
  { value: '720p', label: '720' },
  { value: '1080p', label: '1080' },
  { value: '1440p', label: '1440' },
  { value: '4k', label: '4K' },
];

/* host = design × 2/3 */
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

/** key · value row with a hairline under it (AI referee plate). */
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
        borderBottom: `1px solid ${BB.rule}`,
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
  team: BbTeamId;
  config: BbUiConfig;
  onConfig: (c: BbUiConfig) => void;
}) {
  const t = config.teams[team];
  const other = config.teams[team === 'A' ? 'B' : 'A'];
  const set = (patch: Partial<{ name: string; color: string }>) =>
    onConfig({
      ...config,
      teams: { ...config.teams, [team]: { ...t, ...patch } },
    });
  return (
    <BbPlate
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
          TEAM {team}
        </Display>
      </div>
      <Field label='NAME · 16 MAX'>
        <NameField
          value={t.name}
          onChange={(v) => set({ name: v })}
          placeholder={team === 'A' ? 'E.G. FURNACE' : 'E.G. DOCKSIDE'}
          maxLength={16}
          counter
          height={43}
          fontSize={25}
        />
      </Field>
      <Field label='JERSEY / BIB'>
        <JerseyGrid
          value={t.color}
          taken={other.color}
          onChange={(hex) => set({ color: hex })}
          gap={5}
        />
      </Field>
    </BbPlate>
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
    <HostFrame
      title='MATCH SETUP'
      meta={
        <Meta size={10} tracking={0.22}>
          ROOM · NEW
        </Meta>
      }
      actions={
        <>
          <BbButton
            variant='outline'
            label='BACK'
            onClick={onBack}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <BbButton
            active
            label='OPEN THE COURT'
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
        className='bb-scroll'
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 19,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
        {/* ── teams + rules ── */}
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
              TEAM COLOURS ARE TOO CLOSE · THE AI MAY CONFUSE JERSEYS
            </WarnPlate>
          ) : null}
          <BbPlate
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
                  FIBA 3X3
                </Meta>
              }>
              RULES
            </PlateHead>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '9px 19px',
              }}>
              <Field label='FORMAT'>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 1, label: '1V1' },
                    { value: 2, label: '2V2' },
                    { value: 3, label: '3V3' },
                  ]}
                  value={config.teamSize}
                  onChange={(n) =>
                    onConfig({ ...config, teamSize: n as 1 | 2 | 3 })
                  }
                />
              </Field>
              <Field label='FIRST TO'>
                <Stepper
                  height={CONTROL_H}
                  fontSize={20}
                  value={config.targetPoints}
                  min={5}
                  max={51}
                  onChange={(v) => onConfig({ ...config, targetPoints: v })}
                />
              </Field>
              <Field label='GAME CLOCK'>
                <Stepper
                  height={CONTROL_H}
                  font='mono'
                  fontSize={15}
                  value={config.durationSec}
                  min={60}
                  max={1800}
                  step={60}
                  onChange={(v) => onConfig({ ...config, durationSec: v })}
                  render={(v) =>
                    `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
                  }
                />
              </Field>
              <Field label='OVERTIME · FIRST TO'>
                <Stepper
                  height={CONTROL_H}
                  fontSize={20}
                  value={config.otWinPoints}
                  min={1}
                  max={5}
                  onChange={(v) => onConfig({ ...config, otWinPoints: v })}
                  render={(v) => `+${v}`}
                />
              </Field>
              <Field label='BEYOND THE ARC' span={2}>
                <Segment
                  height={CONTROL_H}
                  fontSize={10}
                  options={[
                    { value: 1, label: '1 PT' },
                    { value: 2, label: '2 PT · MODERATOR MARKS' },
                  ]}
                  value={config.arcPoints}
                  onChange={(n) =>
                    onConfig({ ...config, arcPoints: n as 1 | 2 })
                  }
                />
              </Field>
            </div>
          </BbPlate>
        </div>

        {/* ── AI referee + output ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <BbPlate
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
                  color={BB.electric}>
                  ● REFEREE PANEL
                </Mono>
              }>
              AI REFEREE
            </PlateHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}>
                <Meta size={10} tracking={0.22}>
                  AUTO-CALL THRESHOLD
                </Meta>
                <Stepper
                  height={26}
                  font='mono'
                  fontSize={13}
                  style={{ width: 120 }}
                  value={config.autoAssignMinConf}
                  min={0.3}
                  max={0.95}
                  step={0.05}
                  onChange={(v) =>
                    onConfig({ ...config, autoAssignMinConf: v })
                  }
                  render={(v) => v.toFixed(2)}
                />
              </div>
              <div
                style={{
                  position: 'relative',
                  paddingTop: 4,
                  paddingBottom: 4,
                }}>
                <ProgressBar
                  value={config.autoAssignMinConf}
                  height={4}
                  color={BB.electric}
                />
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `${config.autoAssignMinConf * 100}%`,
                    top: 0,
                    width: 3,
                    height: 12,
                    marginLeft: -1,
                    background: BB.chalk,
                  }}
                />
              </div>
              <Meta size={9} tracking={0.1} color={BB.dim2}>
                BELOW THRESHOLD → REF CALL ON THE MODERATOR PANEL
              </Meta>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0 16px',
              }}>
              <KvRow label='SHOT STILLS'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 90 }}
                  options={[
                    { value: 'on', label: 'ON' },
                    { value: 'off', label: 'OFF' },
                  ]}
                  value={config.shotFrames ? 'on' : 'off'}
                  onChange={(v) =>
                    onConfig({ ...config, shotFrames: v === 'on' })
                  }
                />
              </KvRow>
              <KvRow label='PRESET'>
                <Segment
                  height={22}
                  fontSize={9}
                  style={{ width: 170 }}
                  options={BB_DETECTOR_PRESETS.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  value={
                    BB_DETECTOR_PRESETS.find((p) =>
                      (Object.keys(p.detector) as (keyof typeof det)[]).every(
                        (k) => det[k] === p.detector[k],
                      ),
                    )?.id ?? ''
                  }
                  onChange={(id) => {
                    const p = BB_DETECTOR_PRESETS.find((x) => x.id === id);
                    if (p) setDet({ ...p.detector });
                  }}
                />
              </KvRow>
              <KvRow label='DETECTOR'>
                <BbSelect
                  value={det.ballDetector}
                  height={24}
                  style={{ width: 150 }}
                  onChange={(v) =>
                    setDet({ ballDetector: v as typeof det.ballDetector })
                  }>
                  <option value='auto'>YOLO + HSV</option>
                  <option value='yolo'>YOLO ONLY</option>
                  <option value='hsv'>HSV BLOB (TEST CLIPS)</option>
                </BbSelect>
              </KvRow>
              <KvRow label='WEIGHTS'>
                <BbSelect
                  value={det.yoloWeights}
                  height={24}
                  style={{ width: 150 }}
                  onChange={(v) =>
                    setDet({ yoloWeights: v as typeof det.yoloWeights })
                  }>
                  <option value='auto'>AUTO (GPU → S, CPU → N)</option>
                  <option value='yolo11n.pt'>yolo11n.pt</option>
                  <option value='yolo11s.pt'>yolo11s.pt</option>
                  <option value='yolo11m.pt'>yolo11m.pt</option>
                  <option value='bb-ball.pt'>
                    bb-ball.pt (HALL FINE-TUNE)
                  </option>
                </BbSelect>
              </KvRow>
              <KvRow label='INFERENCE'>
                <Stepper
                  height={24}
                  font='mono'
                  fontSize={12}
                  style={{ width: 110 }}
                  value={det.imgsz}
                  min={320}
                  max={1280}
                  step={160}
                  onChange={(v) => setDet({ imgsz: v })}
                  render={(v) => `${v} PX`}
                />
              </KvRow>
              <KvRow label='FPS'>
                <Stepper
                  height={24}
                  font='mono'
                  fontSize={12}
                  style={{ width: 90 }}
                  value={det.analysisFps}
                  min={8}
                  max={30}
                  onChange={(v) => setDet({ analysisFps: v })}
                />
              </KvRow>
              <KvRow label='CONFIDENCE'>
                <Stepper
                  height={24}
                  font='mono'
                  fontSize={12}
                  style={{ width: 90 }}
                  value={det.ballConf}
                  min={0.05}
                  max={0.9}
                  step={0.05}
                  onChange={(v) => setDet({ ballConf: v })}
                  render={(v) => v.toFixed(2)}
                />
              </KvRow>
            </div>
          </BbPlate>
          <BbPlate
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
                  FIXED ONCE THE COURT OPENS
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
                <BbSelect
                  value={config.perf.recordingPreset}
                  height={CONTROL_H}
                  onChange={(v) =>
                    setPerf({
                      recordingPreset:
                        v as BbUiConfig['perf']['recordingPreset'],
                    })
                  }>
                  {['ultrafast', 'superfast', 'veryfast', 'fast', 'medium'].map(
                    (p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ),
                  )}
                </BbSelect>
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
          </BbPlate>
        </div>
      </div>
    </HostFrame>
  );
}
