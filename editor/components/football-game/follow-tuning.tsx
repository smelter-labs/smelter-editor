'use client';

import { Fragment, type ReactNode } from 'react';
import type { FbDirectorConfig } from '@smelter-editor/types';
import { FB_DIRECTOR_LIMITS } from '@smelter-editor/types';
import { Segment, Stepper } from './fb-kit';
import { FB_FOLLOW_PRESETS, fbFollowPresetOf } from './use-fb-room';

const KNOBS: {
  key: keyof typeof FB_DIRECTOR_LIMITS;
  label: string;
  unit: string;
}[] = [
  { key: 'smoothTimeMs', label: 'SMOOTH TIME', unit: 'MS' },
  { key: 'deadZonePx', label: 'DEAD ZONE', unit: 'PX' },
  { key: 'maxSpeedPxS', label: 'MAX SPEED', unit: 'PX/S' },
  { key: 'averageMs', label: 'BALL AVERAGE', unit: 'MS' },
  { key: 'lookaheadMs', label: 'LOOK-AHEAD', unit: 'MS' },
];

/**
 * The follow window's feel: a preset that fills the numeric knobs, then the
 * knobs themselves. Shared by the host setup and the moderator panel — `row`
 * lays one labelled control out in the caller's own style.
 */
export function FollowTuningRows({
  director,
  onChange,
  row,
  disabled,
  controlHeight = 24,
  presetWidth = 230,
  stepperWidth = 130,
  presetOnly,
}: {
  director: FbDirectorConfig;
  onChange: (patch: Partial<FbDirectorConfig>) => void;
  row: (label: string, control: ReactNode) => ReactNode;
  disabled?: boolean;
  controlHeight?: number;
  presetWidth?: number;
  stepperWidth?: number;
  /** Just the FEEL preset — the host setup; the numbers are tuned live from the panel. */
  presetOnly?: boolean;
}) {
  const lock = disabled
    ? ({ pointerEvents: 'none', opacity: 0.5 } as const)
    : undefined;
  return (
    <>
      {row(
        'FEEL',
        <Segment
          height={controlHeight - 2}
          fontSize={9}
          style={{ width: presetWidth, ...lock }}
          options={FB_FOLLOW_PRESETS.map((p) => ({
            value: p.id,
            label: p.label,
          }))}
          value={fbFollowPresetOf(director) ?? ''}
          onChange={(id) => {
            const preset = FB_FOLLOW_PRESETS.find((p) => p.id === id);
            if (preset) onChange(preset.values);
          }}
        />,
      )}
      {presetOnly
        ? null
        : KNOBS.map(({ key, label, unit }) => {
            const lim = FB_DIRECTOR_LIMITS[key];
            return (
              <Fragment key={key}>
                {row(
                  label,
                  <Stepper
                    height={controlHeight}
                    font='mono'
                    fontSize={12}
                    style={{ width: stepperWidth, ...lock }}
                    value={director[key]}
                    min={lim.min}
                    max={lim.max}
                    step={lim.step}
                    onChange={(v) => onChange({ [key]: v })}
                    render={(v) => `${v} ${unit}`}
                  />,
                )}
              </Fragment>
            );
          })}
      {presetOnly
        ? null
        : row(
            'CATCH-UP',
            <Segment
              height={controlHeight - 2}
              fontSize={9}
              style={{ width: 90, ...lock }}
              options={[
                { value: 'on', label: 'ON' },
                { value: 'off', label: 'OFF' },
              ]}
              value={director.catchUp ? 'on' : 'off'}
              onChange={(v) => onChange({ catchUp: v === 'on' })}
            />,
          )}
    </>
  );
}
