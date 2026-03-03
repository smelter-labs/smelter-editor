'use client';

import { Lock, Unlock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LAYOUT_PRESETS,
  type MutableLayout,
  type LayoutPreset,
} from './panel-registry';

interface LayoutToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onApplyPreset: (layout: MutableLayout) => void;
  onReset: () => void;
}

export default function LayoutToolbar({
  isEditMode,
  onToggleEditMode,
  onApplyPreset,
  onReset,
}: LayoutToolbarProps) {
  return (
    <div className='flex items-center gap-2'>
      <Button
        size='sm'
        variant='outline'
        onClick={onToggleEditMode}
        className={`cursor-pointer gap-1.5 text-xs ${
          isEditMode
            ? 'border-amber-600/60 text-amber-400 hover:bg-amber-950/40'
            : 'text-neutral-500 hover:bg-neutral-200'
        }`}>
        {isEditMode ? (
          <Unlock className='w-3.5 h-3.5' />
        ) : (
          <Lock className='w-3.5 h-3.5' />
        )}
        {isEditMode ? 'Lock Layout' : 'Edit Layout'}
      </Button>

      {isEditMode && (
        <>
          {LAYOUT_PRESETS.map((preset: LayoutPreset) => (
            <Button
              key={preset.id}
              size='sm'
              variant='outline'
              onClick={() => onApplyPreset(preset.layout)}
              className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200'>
              {preset.label}
            </Button>
          ))}
          <Button
            size='sm'
            variant='outline'
            onClick={onReset}
            className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200 gap-1.5'>
            <RotateCcw className='w-3.5 h-3.5' />
            Reset
          </Button>
        </>
      )}
    </div>
  );
}
