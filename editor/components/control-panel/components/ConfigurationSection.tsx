'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { Input } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { Button } from '@/components/ui/button';
import { Input as ShadcnInput } from '@/components/ui/input';
import LoadingSpinner from '@/components/ui/spinner';
import { Download, Upload } from 'lucide-react';
import {
  exportRoomConfig,
  downloadRoomConfig,
  parseRoomConfig,
  resolveRoomConfigTimelineState,
  restoreTimelineToStorage,
  computeTimelineStateAtZero,
  buildInputUpdateFromBlockSettings,
  loadOutputPlayerSettings,
  saveOutputPlayerSettings,
  type RoomConfig,
  type RoomConfigInput,
  type RoomConfigTransitionSettings,
} from '@/lib/room-config';
import { streamImportConfig } from '@/lib/import-config-stream';
import type { ViewportProperties, ShaderConfig } from '@smelter-editor/types';
import { toast } from 'sonner';
import {
  ImportProgressDialog,
  type ImportProgressState,
} from './import-progress-dialog';
type ConfigurationSectionProps = {
  inputs: Input[];
  roomId: string;
  resolution?: { width: number; height: number };
  transitionSettings: RoomConfigTransitionSettings;
  viewport?: Partial<ViewportProperties>;
  outputShaders?: ShaderConfig[];
  refreshState: () => Promise<void>;
  pendingWhipInputs?: PendingWhipInput[];
  setPendingWhipInputs?: (inputs: PendingWhipInput[]) => void | Promise<void>;
};

export type PendingWhipInput = {
  id: string;
  title: string;
  config: RoomConfigInput;
  position: number;
};

function ConfigurationSection({
  inputs,
  roomId,
  resolution,
  transitionSettings,
  viewport,
  outputShaders,
  refreshState,
}: ConfigurationSectionProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const timelineState = resolveRoomConfigTimelineState(roomId);
      const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;
      const config = exportRoomConfig(
        inputs,
        'grid',
        resolution,
        transitionSettings,
        timelineState ?? undefined,
        outputPlayer,
        viewport,
        outputShaders,
      );
      downloadRoomConfig(config);
      toast.success('Configuration exported successfully');
    } catch (e: any) {
      console.error('Export failed:', e);
      toast.error(`Export failed: ${e?.message || e}`);
    } finally {
      setIsExporting(false);
    }
  }, [inputs, resolution, transitionSettings, viewport, outputShaders, roomId]);

  useEffect(() => {
    const onVoiceExport = () => {
      handleExport();
    };
    window.addEventListener('smelter:export-configuration', onVoiceExport);
    return () => {
      window.removeEventListener('smelter:export-configuration', onVoiceExport);
    };
  }, [handleExport]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = parseRoomConfig(text);
      await importConfig(config);
      toast.success('Configuration imported successfully');
    } catch (e: any) {
      console.error('Import failed:', e);
      toast.error(`Import failed: ${e?.message || e}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const importConfig = async (config: RoomConfig) => {
    setIsImporting(true);
    setImportProgress({ phase: 'Starting import', current: 0, total: 1 });

    try {
      const oldInputIds = inputs.map((i) => i.inputId);

      // Pre-compute timeline-at-zero so the server can apply hide/blockSettings
      let timelineAtZero:
        | {
            hiddenInputIds: number[];
            blockSettingsEntries: [number, Record<string, unknown>][];
          }
        | undefined;

      if (config.timeline) {
        const tempIndexMap = new Map<number, string>();
        config.inputs.forEach((_, idx) =>
          tempIndexMap.set(idx, `__temp_${idx}__`),
        );
        const atZero = computeTimelineStateAtZero(
          config.timeline,
          tempIndexMap,
        );

        const hiddenIndices: number[] = [];
        for (const hiddenId of atZero.hiddenInputIds) {
          const match = hiddenId.match(/^__temp_(\d+)__$/);
          if (match) hiddenIndices.push(Number(match[1]));
        }

        const blockEntries: [number, Record<string, unknown>][] = [];
        for (const [tempId, bs] of atZero.activeBlockSettings) {
          const match = tempId.match(/^__temp_(\d+)__$/);
          if (match) {
            blockEntries.push([
              Number(match[1]),
              buildInputUpdateFromBlockSettings(bs) as Record<string, unknown>,
            ]);
          }
        }

        if (hiddenIndices.length > 0 || blockEntries.length > 0) {
          timelineAtZero = {
            hiddenInputIds: hiddenIndices,
            blockSettingsEntries: blockEntries,
          };
        }
      }

      const result = await streamImportConfig(
        roomId,
        { config, oldInputIds, timelineAtZero },
        {
          onProgress: (event) => {
            setImportProgress({
              phase: event.phase,
              current: event.current,
              total: event.total,
            });
          },
        },
      );

      if (result.errors.length > 0) {
        console.warn('[import-config] Errors:', result.errors);
      }

      // Client-side: restore timeline to localStorage
      if (config.timeline) {
        const indexToInputId = new Map<number, string>();
        for (const [idx, inputId] of Object.entries(result.indexToInputId)) {
          indexToInputId.set(Number(idx), inputId);
        }
        for (const pw of result.pendingWhipData) {
          indexToInputId.set(pw.position, `__pending-whip-${pw.position}__`);
        }
        restoreTimelineToStorage(roomId, config.timeline, indexToInputId);
      }

      if (config.outputPlayer) {
        saveOutputPlayerSettings(roomId, config.outputPlayer);
      }

      await refreshState();
    } finally {
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <Button
        size='lg'
        variant='outline'
        className='cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] sm:px-7'
        disabled={isExporting}
        onClick={handleExport}>
        {isExporting ? (
          <span className='flex items-center gap-2'>
            <LoadingSpinner size='sm' variant='spinner' />
            Exporting...
          </span>
        ) : (
          <span className='flex items-center gap-2'>
            <Download className='w-4 h-4' />
            Export Configuration
          </span>
        )}
      </Button>
      <Button
        size='lg'
        variant='outline'
        className='cursor-pointer px-4 py-0 h-[48px] sm:h-[52px] sm:px-7'
        disabled={isImporting}
        onClick={handleImportClick}>
        {isImporting ? (
          <span className='flex items-center gap-2'>
            <LoadingSpinner size='sm' variant='spinner' />
            Importing...
          </span>
        ) : (
          <span className='flex items-center gap-2'>
            <Upload className='w-4 h-4' />
            Import Configuration
          </span>
        )}
      </Button>
      <ShadcnInput
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleFileChange}
      />
      <ImportProgressDialog progress={importProgress} />
    </div>
  );
}
