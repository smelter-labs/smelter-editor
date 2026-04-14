'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/spinner';
import { FxCanvas, FX_PRESET_MODAL } from '@/lib/fx';
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
  onActionClose?: () => void;
  onApplyAtPlayhead?: () => Promise<void>;
  onConnectAndPlay?: () => Promise<void>;
  onConnectAndRecord?: () => Promise<void>;
  canConnectAndPlay?: boolean;
  canConnectAndRecord?: boolean;
  welcomeTextBefore?: string;
  welcomeTextAfter?: string;
};

type PendingModalAction = 'connect' | 'play' | 'record' | null;

export function PendingConnectionsModal({
  pendingWhipInputs,
  setPendingWhipInputs,
  colorMap,
  open,
  onOpenChange,
  onActionClose,
  onApplyAtPlayhead,
  onConnectAndPlay,
  onConnectAndRecord,
  canConnectAndPlay = false,
  canConnectAndRecord = false,
  welcomeTextBefore,
  welcomeTextAfter,
}: PendingConnectionsModalProps) {
  const [dontShow, setDontShow] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingModalAction>(null);
  const [isConnectAllReady, setIsConnectAllReady] = useState(false);
  const isShowcase = !!(welcomeTextBefore || welcomeTextAfter);
  const connectAllRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    if (open) {
      setDontShow(!loadAutoModalSetting());
      setPendingAction(null);
      setIsConnectAllReady(false);
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
    if (open && pendingWhipInputs.length === 0 && pendingAction === null) {
      onOpenChange(false);
    }
  }, [open, pendingAction, pendingWhipInputs.length, onOpenChange]);

  const handleConnectAction = async (
    action: Exclude<PendingModalAction, null>,
  ) => {
    const connectAll = connectAllRef.current;
    if (!connectAll) {
      return;
    }

    setPendingAction(action);
    try {
      const connectedAll = await connectAll();
      if (!connectedAll) {
        return;
      }

      if (action === 'connect') {
        await onApplyAtPlayhead?.();
      } else if (action === 'play') {
        await onConnectAndPlay?.();
      } else {
        await onConnectAndRecord?.();
      }

      if (onActionClose) {
        onActionClose();
      } else {
        onOpenChange(false);
      }
    } finally {
      setPendingAction(null);
    }
  };

  const isRunningAction = pendingAction !== null;
  const canConnectAll = isConnectAllReady && connectAllRef.current !== null;
  const isConnecting = pendingAction === 'connect';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg overflow-hidden border-cyan-400/20 bg-neutral-950/70 shadow-[0_0_60px_rgba(8,145,178,0.12)]'>
        <FxCanvas
          config={FX_PRESET_MODAL}
          isActive={open}
        />
        <DialogHeader className='relative'>
          <DialogTitle>
            {isConnecting
              ? 'Connecting inputs'
              : isShowcase
                ? 'Welcome'
                : 'Pending Connections'}
          </DialogTitle>
          {!isShowcase && !isConnecting && (
            <DialogDescription>
              The following WHIP inputs need to be connected. Choose camera or
              screen for each one.
            </DialogDescription>
          )}
        </DialogHeader>

        {welcomeTextBefore && !isConnecting && (
          <div
            className='relative rich-text-content text-sm text-neutral-300'
            dangerouslySetInnerHTML={{ __html: welcomeTextBefore }}
          />
        )}

        <div className='relative'>
          <div
            className={`max-h-[70vh] overflow-y-auto ${isConnecting ? 'pointer-events-none opacity-60' : ''}`}>
            <PendingWhipInputs
              pendingInputs={pendingWhipInputs}
              setPendingInputs={setPendingWhipInputs}
              colorMap={colorMap}
              connectAllRef={connectAllRef}
              onConnectAllReadyChange={setIsConnectAllReady}
            />
          </div>
          {isConnecting && (
            <div className='absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 py-8 bg-black/30'>
              <LoadingSpinner size='lg' variant='spinner' />
              <p className='text-sm text-neutral-300'>Connecting inputs...</p>
            </div>
          )}
        </div>

        {welcomeTextAfter && !isConnecting && (
          <div
            className='relative rich-text-content text-sm text-neutral-300'
            dangerouslySetInnerHTML={{ __html: welcomeTextAfter }}
          />
        )}

        {!isConnecting && (
          <div className='relative border-t border-neutral-800 pt-3 space-y-2'>
            <Button
              size='lg'
              className={`w-full cursor-pointer ${canConnectAll && !isRunningAction ? 'animate-pulse-cyan' : ''}`}
              disabled={
                !canConnectAll || !canConnectAndPlay || isRunningAction
              }
              onClick={() => void handleConnectAction('play')}>
              {pendingAction === 'play' ? (
                <LoadingSpinner size='sm' variant='spinner' />
              ) : (
                'Connect & Play'
              )}
            </Button>
            <div className='grid grid-cols-2 gap-2'>
              <Button
                variant='outline'
                className='cursor-pointer'
                size='sm'
                disabled={!canConnectAll || isRunningAction}
                onClick={() => void handleConnectAction('connect')}>
                Connect
              </Button>
              <Button
                variant='outline'
                className='cursor-pointer'
                size='sm'
                disabled={
                  !canConnectAll || !canConnectAndRecord || isRunningAction
                }
                onClick={() => void handleConnectAction('record')}>
                {pendingAction === 'record' ? (
                  <LoadingSpinner size='sm' variant='spinner' />
                ) : (
                  'Connect & Record'
                )}
              </Button>
            </div>
          </div>
        )}

        {!isConnecting && (
          <div className='relative flex items-center gap-2 pt-3 border-t border-neutral-800'>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
