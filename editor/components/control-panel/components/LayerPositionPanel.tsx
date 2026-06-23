'use client';

import type { Layer } from '@/lib/types';
import { AbsolutePositionController } from './AbsolutePositionController';
import { CollapsibleSection } from './block-clip/CollapsibleSection';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  panelInputStyles,
  panelSectionStyles,
  labelStyles,
} from '../styles/panel-primitives';

type LayerPositionPanelProps = {
  layer: Layer;
  resolution: { width: number; height: number };
  onChange: (patch: Partial<Layer>) => void;
};

export function LayerPositionPanel({
  layer,
  resolution,
  onChange,
}: LayerPositionPanelProps) {
  const top = layer.offsetTop ?? 0;
  const left = layer.offsetLeft ?? 0;
  const width = layer.offsetWidth ?? resolution.width;
  const height = layer.offsetHeight ?? resolution.height;

  return (
    <div className='space-y-3'>
      <h3 className='text-sm font-semibold text-neutral-200'>Layer Position</h3>
      <CollapsibleSection title='Position' className={panelSectionStyles()}>
        <AbsolutePositionController
          resolution={resolution}
          top={top}
          left={left}
          width={width}
          height={height}
          onChange={(pos) =>
            onChange({
              offsetTop: pos.top,
              offsetLeft: pos.left,
              offsetWidth: pos.width,
              offsetHeight: pos.height,
            })
          }
          onCropChange={() => {}}
        />
        <div className='grid grid-cols-2 gap-2 mt-2'>
          <div>
            <label className={labelStyles({ block: true })}>Duration (ms)</label>
            <NumberInput
              min={0}
              step={50}
              className={panelInputStyles({ fullWidth: true })}
              value={layer.offsetTransitionDurationMs ?? 300}
              onChange={(e) =>
                onChange({
                  offsetTransitionDurationMs: Math.max(
                    0,
                    Number(e.target.value) || 0,
                  ),
                })
              }
            />
          </div>
          <div>
            <label className={labelStyles({ block: true })}>Easing</label>
            <Select
              value={layer.offsetTransitionEasing ?? 'linear'}
              onValueChange={(v) => onChange({ offsetTransitionEasing: v })}>
              <SelectTrigger
                className={panelInputStyles({
                  fullWidth: true,
                  compact: true,
                })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='linear'>Linear</SelectItem>
                <SelectItem value='cubic_bezier_ease_in_out'>
                  Ease in-out
                </SelectItem>
                <SelectItem value='bounce'>Bounce</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
