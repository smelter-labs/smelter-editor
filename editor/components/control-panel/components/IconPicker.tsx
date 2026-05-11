'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  TRACK_ICON_KEYS,
  TRACK_ICON_REGISTRY,
  type TrackIconKey,
} from './track-icons';

type IconPickerProps = {
  value: string | undefined;
  onChange: (key: TrackIconKey) => void;
  /** Optional icon shown when `value` is unset. */
  fallbackKey?: TrackIconKey;
  className?: string;
  ariaLabel?: string;
  /** When true, renders as a small button with no extra padding. */
  compact?: boolean;
};

export function IconPicker({
  value,
  onChange,
  fallbackKey = 'layers',
  className,
  ariaLabel = 'Change icon',
  compact = true,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const activeKey: TrackIconKey =
    value && (TRACK_ICON_KEYS as string[]).includes(value)
      ? (value as TrackIconKey)
      : fallbackKey;
  const ActiveIcon = TRACK_ICON_REGISTRY[activeKey];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer',
            compact ? 'h-5 w-5' : 'h-6 w-6 p-0.5',
            className,
          )}>
          <ActiveIcon className='w-3.5 h-3.5' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='p-2 w-[228px]'
        onClick={(e) => e.stopPropagation()}>
        <div className='grid grid-cols-6 gap-1'>
          {TRACK_ICON_KEYS.map((key) => {
            const Icon = TRACK_ICON_REGISTRY[key];
            const selected = key === activeKey;
            return (
              <button
                key={key}
                type='button'
                aria-label={key}
                title={key}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={cn(
                  'h-7 w-7 inline-flex items-center justify-center rounded transition-colors cursor-pointer',
                  selected
                    ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/50'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}>
                <Icon className='w-4 h-4' />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
