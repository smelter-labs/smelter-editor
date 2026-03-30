'use client';

import type { LayerBehaviorConfig } from '@smelter-editor/types';

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
  const currentType = behavior?.type ?? 'manual';

  return (
    <div className='flex flex-wrap gap-1.5'>
      {BEHAVIOR_OPTIONS.map((opt) => {
        const active = currentType === opt.type;
        return (
          <button
            key={opt.type}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${
              active
                ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                : 'border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600'
            }`}
            onClick={() => {
              if (opt.type === 'manual') {
                onChange(undefined);
              } else if (opt.type !== currentType) {
                onChange({ type: opt.type } as LayerBehaviorConfig);
              }
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
