'use client';

import { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, RotateCcw, PanelTop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LAYOUT_PRESETS,
  PANEL_DEFINITIONS,
  ALL_PANEL_IDS,
  type PanelId,
  type MutableLayout,
  type LayoutPreset,
} from './panel-registry';

interface LayoutToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onApplyPreset: (layout: MutableLayout) => void;
  onReset: () => void;
  visiblePanels: Set<PanelId>;
  onTogglePanel: (panelId: PanelId) => void;
}

export default function LayoutToolbar({
  isEditMode,
  onToggleEditMode,
  onApplyPreset,
  onReset,
  visiblePanels,
  onTogglePanel,
}: LayoutToolbarProps) {
  const [showPanelMenu, setShowPanelMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPanelMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowPanelMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPanelMenu]);

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

          <div className='relative' ref={menuRef}>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setShowPanelMenu((prev) => !prev)}
              className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200 gap-1.5'>
              <PanelTop className='w-3.5 h-3.5' />
              Panels
            </Button>
            {showPanelMenu && (
              <div className='absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg py-1'>
                {ALL_PANEL_IDS.map((panelId) => {
                  const def = PANEL_DEFINITIONS[panelId];
                  const isVisible = visiblePanels.has(panelId);
                  return (
                    <button
                      key={panelId}
                      onClick={() => onTogglePanel(panelId)}
                      className='flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-800 transition-colors cursor-pointer'>
                      <span
                        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                          isVisible
                            ? 'border-blue-500 bg-blue-500/20'
                            : 'border-neutral-600 bg-transparent'
                        }`}>
                        {isVisible && (
                          <svg
                            width='10'
                            height='10'
                            viewBox='0 0 10 10'
                            fill='none'>
                            <path
                              d='M2 5L4 7L8 3'
                              stroke='#60a5fa'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        )}
                      </span>
                      <span
                        className={
                          isVisible ? 'text-neutral-200' : 'text-neutral-500'
                        }>
                        {def.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
