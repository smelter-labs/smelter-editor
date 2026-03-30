'use client';

import type { TransitionType, TransitionConfig } from '@/lib/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

const TRANSITION_TYPES: { value: TransitionType | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'wipe-left', label: 'Wipe Left' },
  { value: 'wipe-right', label: 'Wipe Right' },
  { value: 'dissolve', label: 'Dissolve' },
];

export function TransitionRow({
  label,
  transition,
  maxDurationMs,
  onChange,
}: {
  label: string;
  transition?: TransitionConfig;
  maxDurationMs: number;
  onChange: (t: TransitionConfig | undefined) => void;
}) {
  const type = transition?.type ?? 'none';
  const durationMs = transition?.durationMs ?? 500;
  const clampedMax = Math.max(100, maxDurationMs);

  return (
    <div className='mb-2'>
      <span className='text-[11px] text-muted-foreground block mb-1'>
        {label}
      </span>
      <div className='flex items-center gap-2'>
        <Select
          value={type}
          onValueChange={(val: TransitionType | 'none') => {
            if (val === 'none') {
              onChange(undefined);
            } else {
              onChange({ type: val, durationMs });
            }
          }}>
          <SelectTrigger className='flex-1 bg-card border border-border text-foreground text-xs px-2 py-1 rounded h-auto'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSITION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {type !== 'none' && (
          <div className='flex items-center gap-1.5'>
            <Slider
              min={100}
              max={Math.min(2000, clampedMax)}
              step={50}
              className='w-20'
              value={[Math.min(durationMs, clampedMax)]}
              onValueChange={(v) => {
                const ms = v[0];
                onChange({ type: type as TransitionType, durationMs: ms });
              }}
            />
            <span className='text-[10px] text-muted-foreground w-10 text-right tabular-nums'>
              {durationMs}ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
