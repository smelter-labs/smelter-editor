'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LayerBehaviorConfig } from '@smelter-editor/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const BEHAVIOR_OPTIONS: {
  label: string;
  type: LayerBehaviorConfig['type'] | 'manual';
}[] = [
  { label: 'Equal Grid', type: 'equal-grid' },
  { label: 'Approx. Aspect Grid', type: 'approximate-aspect-grid' },
  { label: 'Exact Aspect Grid', type: 'exact-aspect-grid' },
  { label: 'Picture in Picture', type: 'picture-in-picture' },
  { label: 'Manual', type: 'manual' },
];

interface BehaviorSelectorProps {
  behavior: LayerBehaviorConfig | undefined;
  onChange: (behavior: LayerBehaviorConfig | undefined) => void;
}

export function BehaviorSelector({
  behavior,
  onChange,
}: BehaviorSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const currentType = behavior?.type ?? 'manual';
  const activeOption = useMemo(
    () => BEHAVIOR_OPTIONS.find((opt) => opt.type === currentType),
    [currentType],
  );

  const handleSelect = (type: LayerBehaviorConfig['type'] | 'manual') => {
    if (type === 'manual') {
      onChange(undefined);
    } else if (type !== currentType) {
      onChange({ type } as LayerBehaviorConfig);
    }
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border border-blue-500/50 bg-blue-500/15 text-blue-400 transition-colors hover:bg-blue-500/20'
          aria-label='Select layer behavior'>
          <span>{activeOption?.label ?? 'Manual'}</span>
          <ChevronDown className='w-3.5 h-3.5' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[220px] p-1 border-neutral-700 bg-neutral-900'>
        <div className='flex flex-col gap-0.5'>
          {BEHAVIOR_OPTIONS.map((opt) => {
            const active = currentType === opt.type;
            return (
              <button
                key={opt.type}
                type='button'
                onClick={() => handleSelect(opt.type)}
                className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                  active
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                }`}>
                <span>{opt.label}</span>
                {active ? <Check className='w-3.5 h-3.5' /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
