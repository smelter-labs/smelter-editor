'use client';

import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';
import { useActions } from '../contexts/actions-context';
import { parseRoomConfig, type RoomConfig } from '@/lib/room-config';
import { Archive } from 'lucide-react';

type SaveConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveLocal: () => void;
  onSaveFullProject?: () => void;
  onSaveRemote: (name: string) => Promise<string | null>;
  isExporting: boolean;
};

export function SaveConfigModal({
  open,
  onOpenChange,
  onSaveLocal,
  onSaveFullProject,
  onSaveRemote,
  isExporting,
}: SaveConfigModalProps) {
  return (
    <GenericSaveModal
      open={open}
      onOpenChange={onOpenChange}
      title='Save Configuration'
      description='Choose where to save your room configuration.'
      namePlaceholder='Configuration name...'
      onSaveLocal={onSaveLocal}
      onSaveRemote={onSaveRemote}
      isExporting={isExporting}
      extraOptions={
        onSaveFullProject
          ? [
              {
                id: 'save-full-project',
                icon: <Archive className='w-5 h-5 text-neutral-400 shrink-0' />,
                label: 'Download full project',
                description: 'Bundle config and local assets into a ZIP file',
                onClick: () => {
                  onSaveFullProject();
                  onOpenChange(false);
                },
              },
            ]
          : undefined
      }
    />
  );
}

type LoadConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadLocal: () => void;
  onLoadRemote: (config: RoomConfig) => Promise<void>;
};

export function LoadConfigModal({
  open,
  onOpenChange,
  onLoadLocal,
  onLoadRemote,
}: LoadConfigModalProps) {
  const { configStorage } = useActions();

  return (
    <GenericLoadModal<object>
      open={open}
      onOpenChange={onOpenChange}
      title='Load Configuration'
      description='Choose where to load your room configuration from.'
      storage={configStorage}
      onLoadLocal={onLoadLocal}
      onLoadRemote={async (data) => {
        onOpenChange(false);
        await onLoadRemote(parseRoomConfig(JSON.stringify(data)));
      }}
      emptyMessage='No saved configurations found.'
    />
  );
}
