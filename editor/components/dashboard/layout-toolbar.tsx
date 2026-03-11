'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Lock,
  Unlock,
  RotateCcw,
  PanelTop,
  Save,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LAYOUT_PRESETS,
  type PanelDefinition,
  type MutableLayout,
  type LayoutPreset,
} from './panel-registry';
import type { DashboardLayoutSavedData } from './dashboard-layout';
import type { StorageClient } from '@/lib/storage-client';
import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';

interface LayoutToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onApplyPreset: (layout: MutableLayout) => void;
  onReset: () => void;
  allPanelIds: string[];
  visiblePanels: Set<string>;
  onTogglePanel: (panelId: string) => void;
  getPanelDefinition: (id: string) => PanelDefinition;
  dashboardLayoutStorage: StorageClient<object>;
  getCurrentLayoutData: () => DashboardLayoutSavedData;
  onApplyLoadedLayout: (data: DashboardLayoutSavedData) => void;
}

export default function LayoutToolbar({
  isEditMode,
  onToggleEditMode,
  onApplyPreset,
  onReset,
  allPanelIds,
  visiblePanels,
  onTogglePanel,
  getPanelDefinition,
  dashboardLayoutStorage,
  getCurrentLayoutData,
  onApplyLoadedLayout,
}: LayoutToolbarProps) {
  const [showPanelMenu, setShowPanelMenu] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
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

  const handleSaveRemote = useCallback(
    async (name: string): Promise<string | null> => {
      const data = getCurrentLayoutData();
      const result = await dashboardLayoutStorage.save(name, data);
      if (!result.ok) return result.error;
      return null;
    },
    [dashboardLayoutStorage, getCurrentLayoutData],
  );

  const handleSaveLocal = useCallback(() => {
    const data = getCurrentLayoutData();
    const name = `dashboard-layout-${Date.now()}`;
    const blob = new Blob([JSON.stringify({ name, layout: data }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getCurrentLayoutData]);

  const handleLoadRemote = useCallback(
    (data: object) => {
      onApplyLoadedLayout(data as DashboardLayoutSavedData);
    },
    [onApplyLoadedLayout],
  );

  return (
    <>
      <div className='flex items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={onToggleEditMode}
          aria-pressed={isEditMode}
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
              onClick={() => setShowSaveModal(true)}
              className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200 gap-1.5'>
              <Save className='w-3.5 h-3.5' />
              Save
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setShowLoadModal(true)}
              className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200 gap-1.5'>
              <FolderOpen className='w-3.5 h-3.5' />
              Load
            </Button>

            <div className='relative' ref={menuRef}>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setShowPanelMenu((prev) => !prev)}
                aria-expanded={showPanelMenu}
                aria-haspopup='menu'
                aria-controls='dashboard-panel-menu'
                className='cursor-pointer text-xs text-neutral-500 hover:bg-neutral-200 gap-1.5'>
                <PanelTop className='w-3.5 h-3.5' />
                Panels
              </Button>
              {showPanelMenu && (
                <div
                  id='dashboard-panel-menu'
                  role='menu'
                  className='absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg py-1'>
                  {allPanelIds.map((panelId) => {
                    const def = getPanelDefinition(panelId);
                    const isVisible = visiblePanels.has(panelId);
                    return (
                      <button
                        type='button'
                        key={panelId}
                        onClick={() => onTogglePanel(panelId)}
                        role='menuitemcheckbox'
                        aria-checked={isVisible}
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

      <GenericSaveModal
        open={showSaveModal}
        onOpenChange={setShowSaveModal}
        title='Save Dashboard Layout'
        description='Choose where to save your dashboard layout.'
        namePlaceholder='Layout name...'
        onSaveLocal={handleSaveLocal}
        onSaveRemote={handleSaveRemote}
      />
      <GenericLoadModal<object>
        open={showLoadModal}
        onOpenChange={setShowLoadModal}
        title='Load Dashboard Layout'
        description='Choose where to load your dashboard layout from.'
        storage={dashboardLayoutStorage}
        onLoadRemote={handleLoadRemote}
        emptyMessage='No saved dashboard layouts found.'
      />
    </>
  );
}
