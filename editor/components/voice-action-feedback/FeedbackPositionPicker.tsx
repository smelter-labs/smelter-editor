'use client';

import {
  FEEDBACK_SIZES,
  type FeedbackPosition,
  type FeedbackSize,
} from '@/lib/voice/macroSettings';
import { cn } from '@/lib/utils';

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  position: FeedbackPosition;
  onPositionChange: (position: FeedbackPosition) => void;
  size: FeedbackSize;
  onSizeChange: (size: FeedbackSize) => void;
  duration: number;
  onDurationChange: (seconds: number) => void;
};

const GRID: FeedbackPosition[][] = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];

const SIZE_LABELS: Record<FeedbackSize, string> = {
  s: 'S',
  m: 'M',
  l: 'L',
};

export function FeedbackPositionPicker({
  enabled,
  onEnabledChange,
  position,
  onPositionChange,
  size,
  onSizeChange,
  duration,
  onDurationChange,
}: Props) {
  return (
    <div className='space-y-2'>
      <label className='flex items-center gap-2 cursor-pointer'>
        <input
          type='checkbox'
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className='accent-white'
        />
        <span className='text-xs text-neutral-400'>
          Voice Command Toast Notifications
        </span>
      </label>
      {enabled && (
        <div className='flex flex-wrap items-end gap-4 pl-5'>
          <div className='space-y-1.5'>
            <span className='text-xs text-neutral-500'>Position</span>
            <div className='inline-grid grid-cols-3 gap-1 rounded-lg border border-neutral-700 bg-neutral-800/50 p-1.5'>
              {GRID.flat().map((pos) => {
                const isActive = pos === position;
                return (
                  <button
                    key={pos}
                    type='button'
                    title={pos}
                    onClick={() => onPositionChange(pos)}
                    className={cn(
                      'w-6 h-6 rounded transition-all duration-150 cursor-pointer',
                      isActive
                        ? 'bg-white shadow-sm'
                        : 'bg-neutral-700 hover:bg-neutral-600',
                    )}
                  />
                );
              })}
            </div>
          </div>
          <div className='space-y-1.5'>
            <span className='text-xs text-neutral-500'>Size</span>
            <div className='flex gap-1 rounded-lg border border-neutral-700 bg-neutral-800/50 p-1'>
              {FEEDBACK_SIZES.map((s) => (
                <button
                  key={s}
                  type='button'
                  onClick={() => onSizeChange(s)}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs font-medium transition-all duration-150 cursor-pointer',
                    s === size
                      ? 'bg-white text-neutral-900'
                      : 'text-neutral-400 hover:bg-neutral-700',
                  )}>
                  {SIZE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className='space-y-1.5'>
            <span className='text-xs text-neutral-500'>
              Duration ({duration}s)
            </span>
            <input
              type='range'
              min={1}
              max={15}
              step={1}
              value={duration}
              onChange={(e) => onDurationChange(Number(e.target.value))}
              className='w-24 accent-white h-2 cursor-pointer'
            />
          </div>
        </div>
      )}
    </div>
  );
}
