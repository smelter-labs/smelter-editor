'use client';

import { useEffect, useState } from 'react';
import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';
import { Checkbox } from '@/components/ui/checkbox';
import { useActions } from '../contexts/actions-context';
import { parseRoomConfig, type RoomConfig } from '@/lib/room-config';
import { Archive } from 'lucide-react';

type SaveConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveLocal: (includeLayout: boolean) => void;
  onSaveFullProject?: (includeLayout: boolean) => void;
  onSaveRemote: (
    name: string,
    includeLayout: boolean,
  ) => Promise<string | null>;
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
  const [includeLayout, setIncludeLayout] = useState(false);

  useEffect(() => {
    if (!open) setIncludeLayout(false);
  }, [open]);

  return (
    <GenericSaveModal
      open={open}
      onOpenChange={onOpenChange}
      title='Save Configuration'
      description='Choose where to save your room configuration.'
      namePlaceholder='Configuration name...'
      onSaveLocal={() => onSaveLocal(includeLayout)}
      onSaveRemote={(name) => onSaveRemote(name, includeLayout)}
      isExporting={isExporting}
      extraContent={
        <label className='flex items-start gap-2 px-1 py-1 cursor-pointer select-none'>
          <Checkbox
            checked={includeLayout}
            onCheckedChange={(checked) => setIncludeLayout(checked === true)}
            className='mt-0.5'
          />
          <div className='flex flex-col min-w-0'>
            <span className='text-sm font-medium text-white'>
              Include current dashboard layout
            </span>
            <span className='text-xs text-neutral-500'>
              Save panel positions (panel visibility is always saved)
            </span>
          </div>
        </label>
      }
      extraOptions={
        onSaveFullProject
          ? [
              {
                id: 'save-full-project',
                icon: <Archive className='w-5 h-5 text-neutral-400 shrink-0' />,
                label: 'Download full project',
                description: 'Bundle config and local assets into a ZIP file',
                onClick: () => {
                  onSaveFullProject(includeLayout);
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
