'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PendingWhipInputs } from './PendingWhipInputs';
import {
  loadAutoModalSetting,
  PENDING_WHIP_AUTO_MODAL_KEY,
} from './PendingConnectionsPanel';
import type { PendingWhipInput } from './ConfigurationSection';

type PendingConnectionsModalProps = {
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  colorMap: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  welcomeTextBefore?: string;
  welcomeTextAfter?: string;
};

export function PendingConnectionsModal({
  pendingWhipInputs,
  setPendingWhipInputs,
  colorMap,
  open,
  onOpenChange,
  welcomeTextBefore,
  welcomeTextAfter,
}: PendingConnectionsModalProps) {
  const [dontShow, setDontShow] = useState(false);
  const isShowcase = !!(welcomeTextBefore || welcomeTextAfter);

  useEffect(() => {
    if (open) {
      setDontShow(!loadAutoModalSetting());
    }
  }, [open]);

  const handleDontShowChange = (checked: boolean) => {
    setDontShow(checked);
    try {
      localStorage.setItem(PENDING_WHIP_AUTO_MODAL_KEY, String(!checked));
    } catch {
      // storage unavailable
    }
  };

  useEffect(() => {
    if (open && pendingWhipInputs.length === 0) {
      onOpenChange(false);
    }
  }, [open, pendingWhipInputs.length, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{isShowcase ? 'Welcome' : 'Pending Connections'}</DialogTitle>
          {!isShowcase && (
            <DialogDescription>
              The following WHIP inputs need to be connected. Choose camera or
              screen for each one.
            </DialogDescription>
          )}
        </DialogHeader>

        {welcomeTextBefore && (
          <p className='text-sm text-neutral-300 whitespace-pre-wrap'>
            {welcomeTextBefore}
          </p>
        )}

        <div className='max-h-80 overflow-y-auto'>
          <PendingWhipInputs
            pendingInputs={pendingWhipInputs}
            setPendingInputs={setPendingWhipInputs}
            colorMap={colorMap}
          />
        </div>

        {welcomeTextAfter && (
          <p className='text-sm text-neutral-300 whitespace-pre-wrap'>
            {welcomeTextAfter}
          </p>
        )}

        <div className='flex items-center gap-2 pt-3 border-t border-neutral-800'>
          <Switch
            id='pending-modal-dont-show'
            checked={dontShow}
            onCheckedChange={handleDontShowChange}
            className='cursor-pointer'
          />
          <Label
            htmlFor='pending-modal-dont-show'
            className='text-xs text-neutral-400 cursor-pointer select-none'>
            Don&apos;t show this on project open
          </Label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
