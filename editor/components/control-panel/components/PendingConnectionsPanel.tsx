'use client';

import { useEffect, useState } from 'react';
import { PendingWhipInputs } from './PendingWhipInputs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { PendingWhipInput } from './ConfigurationSection';

export const PENDING_WHIP_AUTO_MODAL_KEY = 'smelter-pending-whip-auto-modal';

export function loadAutoModalSetting(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(PENDING_WHIP_AUTO_MODAL_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function saveAutoModalSetting(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PENDING_WHIP_AUTO_MODAL_KEY, String(enabled));
  } catch {
    // storage unavailable
  }
}

type PendingConnectionsPanelProps = {
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  colorMap: Record<string, string>;
};

export function PendingConnectionsPanel({
  pendingWhipInputs,
  setPendingWhipInputs,
  colorMap,
}: PendingConnectionsPanelProps) {
  const [autoModal, setAutoModal] = useState(true);

  useEffect(() => {
    setAutoModal(loadAutoModalSetting());
  }, []);

  const handleToggle = (checked: boolean) => {
    setAutoModal(checked);
    saveAutoModalSetting(checked);
  };

  if (pendingWhipInputs.length === 0) {
    return (
      <div className='h-full flex flex-col p-3'>
        <p className='text-xs text-neutral-500 m-auto text-center'>
          No pending connections
        </p>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col p-3 overflow-y-auto'>
      <PendingWhipInputs
        pendingInputs={pendingWhipInputs}
        setPendingInputs={setPendingWhipInputs}
        colorMap={colorMap}
      />

      <div className='flex items-center gap-2 mt-3 pt-3 border-t border-neutral-800'>
        <Switch
          id='pending-auto-modal'
          checked={autoModal}
          onCheckedChange={handleToggle}
          className='cursor-pointer'
        />
        <Label
          htmlFor='pending-auto-modal'
          className='text-xs text-neutral-400 cursor-pointer select-none'>
          Show connect modal on project open
        </Label>
      </div>
    </div>
  );
}
