'use client';

import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';
import { useActions } from '../contexts/actions-context';
import { parseRoomConfig, type RoomConfig } from '@/lib/room-config';

type SaveConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveLocal: () => void;
  onSaveRemote: (name: string) => Promise<string | null>;
  isExporting: boolean;
};

export function SaveConfigModal({
  open,
  onOpenChange,
  onSaveLocal,
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
