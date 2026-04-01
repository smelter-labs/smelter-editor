'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { Input, Layout } from '@/lib/types';
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
import type { ViewportProperties, ShaderConfig } from '@smelter-editor/types';
import { toast } from 'sonner';
import {
  ImportProgressDialog,
  type ImportProgressState,
} from './import-progress-dialog';
type ConfigurationSectionProps = {
  inputs: Input[];
  layout: Layout;
  roomId: string;
  resolution?: { width: number; height: number };
  transitionSettings: RoomConfigTransitionSettings;
  viewport?: Partial<ViewportProperties>;
  outputShaders?: ShaderConfig[];
  refreshState: () => Promise<void>;
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
};

export type PendingWhipInput = {
  id: string;
  title: string;
  config: RoomConfigInput;
  position: number;
};

export function ConfigurationSection({
  inputs,
  layout,
  roomId,
  resolution,
  transitionSettings,
  viewport,
  outputShaders,
  refreshState,
  pendingWhipInputs,
  setPendingWhipInputs,
}: ConfigurationSectionProps) {
  const {
    addTwitchInput,
    addKickInput,
    addHlsInput,
    addMP4Input,
    addAudioInput,
    addImageInput,
    addTextInput,
    addSnakeGameInput,
    addCameraInput,
    updateInput,
    updateRoom,
    removeInput,
    hideInput,
  } = useActions();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const countImportAddRequests = useCallback(
    (configInputs: RoomConfigInput[]) => {
      let count = 0;

      for (const input of configInputs) {
        switch (input.type) {
          case 'twitch-channel':
          case 'kick-channel':
            if (input.channelId) count += 1;
            break;
          case 'hls':
            if (input.url) count += 1;
            break;
          case 'local-mp4':
            if (input.audioFileName || input.mp4FileName) count += 1;
            break;
          case 'image':
            if (input.imageId) count += 1;
            break;
          case 'text-input':
            if (input.text) count += 1;
            break;
          case 'game':
            count += 1;
            break;
          case 'whip':
            break;
        }
      }

      return count;
    },
    [],
  );

  const startImportProgress = useCallback((total: number, phase: string) => {
    setImportProgress({
      phase,
      current: 0,
      total: Math.max(total, 1),
    });
  }, []);

  const setImportPhase = useCallback((phase: string) => {
    setImportProgress((prev) => (prev ? { ...prev, phase } : prev));
  }, []);

  const advanceImportProgress = useCallback((phase?: string) => {
    setImportProgress((prev) =>
      prev
        ? {
            ...prev,
            phase: phase ?? prev.phase,
            current: Math.min(prev.total, prev.current + 1),
          }
        : prev,
    );
  }, []);

  const adjustImportTotal = useCallback((delta: number) => {
    if (delta === 0) {
      return;
    }

    setImportProgress((prev) => {
      if (!prev) {
        return prev;
      }

      const total = Math.max(prev.current, prev.total + delta, 1);
      return { ...prev, total };
    });
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const timelineState = resolveRoomConfigTimelineState(roomId);
      const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;
      const config = exportRoomConfig(
        inputs,
        layout,
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
  }, [
    inputs,
    layout,
    resolution,
    transitionSettings,
    viewport,
    outputShaders,
    roomId,
  ]);

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

    const plannedAddRequests = countImportAddRequests(config.inputs);
    const oldInputIds = inputs.map((i) => i.inputId);
    const newPendingWhipInputs: PendingWhipInput[] = [];
    const createdInputIds: {
      inputId: string;
      config: RoomConfigInput;
      position: number;
    }[] = [];

    startImportProgress(
      plannedAddRequests * 2 + oldInputIds.length + 5,
      'Adding inputs',
    );

    try {
      for (let i = 0; i < config.inputs.length; i++) {
        const inputConfig = config.inputs[i];
        try {
          let inputId: string | null = null;
          let attemptedAdd = false;

          if (inputConfig.type === 'whip') {
            newPendingWhipInputs.push({
              id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              title: inputConfig.title,
              config: inputConfig,
              position: i,
            });
            continue;
          }

          switch (inputConfig.type) {
            case 'twitch-channel':
              if (inputConfig.channelId) {
                attemptedAdd = true;
                const result = await addTwitchInput(
                  roomId,
                  inputConfig.channelId,
                );
                inputId = result.inputId;
              }
              break;
            case 'kick-channel':
              if (inputConfig.channelId) {
                attemptedAdd = true;
                const result = await addKickInput(
                  roomId,
                  inputConfig.channelId,
                );
                inputId = result.inputId;
              }
              break;
            case 'hls':
              if (inputConfig.url) {
                attemptedAdd = true;
                const result = await addHlsInput(roomId, inputConfig.url);
                inputId = result.inputId;
              }
              break;
            case 'local-mp4':
              if (inputConfig.audioFileName) {
                attemptedAdd = true;
                const result = await addAudioInput(
                  roomId,
                  inputConfig.audioFileName,
                );
                inputId = result.inputId;
              } else if (inputConfig.mp4FileName) {
                attemptedAdd = true;
                const result = await addMP4Input(
                  roomId,
                  inputConfig.mp4FileName,
                );
                inputId = result.inputId;
              }
              break;
            case 'image':
              if (inputConfig.imageId) {
                attemptedAdd = true;
                const result = await addImageInput(roomId, inputConfig.imageId);
                inputId = result.inputId;
              }
              break;
            case 'text-input':
              if (inputConfig.text) {
                attemptedAdd = true;
                const result = await addTextInput(
                  roomId,
                  inputConfig.text,
                  inputConfig.textAlign || 'left',
                );
                inputId = result.inputId;
              }
              break;
            case 'game': {
              attemptedAdd = true;
              const result = await addSnakeGameInput(roomId, inputConfig.title);
              inputId = result.inputId;
              break;
            }
          }

          if (inputId) {
            createdInputIds.push({ inputId, config: inputConfig, position: i });
          }

          if (attemptedAdd) {
            advanceImportProgress('Adding inputs');
          }
        } catch (e) {
          console.warn(`Failed to add input ${inputConfig.title}:`, e);
          advanceImportProgress('Adding inputs');
        }
      }

      adjustImportTotal(createdInputIds.length - plannedAddRequests);

      const positionToInputId = new Map<number, string>();
      for (const { inputId, position } of createdInputIds) {
        positionToInputId.set(position, inputId);
      }
      for (const pending of newPendingWhipInputs) {
        positionToInputId.set(
          pending.position,
          `__pending-whip-${pending.position}__`,
        );
      }

      setImportPhase('Refreshing state');
      await refreshState();
      advanceImportProgress('Refreshing state');

      for (const { inputId, config: inputConfig } of createdInputIds) {
        const attachedInputIds = inputConfig.attachedInputIndices
          ?.map((idx) => positionToInputId.get(idx))
          .filter((id): id is string => !!id);
        try {
          await updateInput(roomId, inputId, {
            volume: inputConfig.volume,
            shaders: inputConfig.shaders,
            showTitle: inputConfig.showTitle,
            textColor: inputConfig.textColor,
            textMaxLines: inputConfig.textMaxLines,
            textScrollSpeed: inputConfig.textScrollSpeed,
            textScrollLoop: inputConfig.textScrollLoop,
            textFontSize: inputConfig.textFontSize,
            borderColor: inputConfig.borderColor,
            borderWidth: inputConfig.borderWidth,
            gameBackgroundColor: inputConfig.gameBackgroundColor,
            gameCellGap: inputConfig.gameCellGap,
            gameBoardBorderColor: inputConfig.gameBoardBorderColor,
            gameBoardBorderWidth: inputConfig.gameBoardBorderWidth,
            gameGridLineColor: inputConfig.gameGridLineColor,
            gameGridLineAlpha: inputConfig.gameGridLineAlpha,
            snakeEventShaders: inputConfig.snakeEventShaders,
            snake1Shaders: inputConfig.snake1Shaders,
            snake2Shaders: inputConfig.snake2Shaders,
            absolutePosition: inputConfig.absolutePosition,
            absoluteTop: inputConfig.absoluteTop,
            absoluteLeft: inputConfig.absoluteLeft,
            absoluteWidth: inputConfig.absoluteWidth,
            absoluteHeight: inputConfig.absoluteHeight,
            absoluteTransitionDurationMs:
              inputConfig.absoluteTransitionDurationMs,
            absoluteTransitionEasing: inputConfig.absoluteTransitionEasing,
            cropTop: inputConfig.cropTop,
            cropLeft: inputConfig.cropLeft,
            cropRight: inputConfig.cropRight,
            cropBottom: inputConfig.cropBottom,
            attachedInputIds:
              attachedInputIds && attachedInputIds.length > 0
                ? attachedInputIds
                : undefined,
          });
        } catch (e) {
          console.warn(`Failed to update input ${inputId}:`, e);
        } finally {
          advanceImportProgress('Configuring inputs');
        }
      }

      for (const oldInputId of oldInputIds) {
        try {
          await removeInput(roomId, oldInputId);
        } catch (e) {
          console.warn(`Failed to remove old input ${oldInputId}:`, e);
        } finally {
          advanceImportProgress('Removing old inputs');
        }
      }

      setImportPhase('Syncing pending WHIP inputs');
      await Promise.resolve(setPendingWhipInputs(newPendingWhipInputs));
      advanceImportProgress('Syncing pending WHIP inputs');
      advanceImportProgress('Syncing pending WHIP inputs');

      let timelineInputOrder: string[] | undefined;

      if (config.timeline) {
        const indexToInputId = new Map<number, string>();
        for (const { inputId, position } of createdInputIds) {
          indexToInputId.set(position, inputId);
        }

        const timelineState = computeTimelineStateAtZero(
          config.timeline,
          indexToInputId,
        );

        for (const pending of newPendingWhipInputs) {
          indexToInputId.set(
            pending.position,
            `__pending-whip-${pending.position}__`,
          );
        }
        restoreTimelineToStorage(roomId, config.timeline, indexToInputId);

        adjustImportTotal(
          timelineState.hiddenInputIds.length +
            timelineState.activeBlockSettings.size,
        );

        for (const hiddenId of timelineState.hiddenInputIds) {
          try {
            await hideInput(roomId, hiddenId);
          } catch (e) {
            console.warn(`Failed to hide input ${hiddenId}:`, e);
          } finally {
            advanceImportProgress('Applying timeline state');
          }
        }

        for (const [
          inputId,
          blockSettings,
        ] of timelineState.activeBlockSettings) {
          try {
            await updateInput(
              roomId,
              inputId,
              buildInputUpdateFromBlockSettings(blockSettings),
            );
          } catch (e) {
            console.warn(`Failed to apply block settings for ${inputId}:`, e);
          } finally {
            advanceImportProgress('Applying timeline state');
          }
        }

        if (timelineState.inputOrder.length > 0) {
          timelineInputOrder = timelineState.inputOrder;
        }
      }

      const orderedCreatedIds = createdInputIds
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(({ inputId }) => inputId);

      const finalInputOrder =
        timelineInputOrder ??
        (orderedCreatedIds.length > 0 ? orderedCreatedIds : undefined);

      try {
        await updateRoom(roomId, {
          layout: config.layout,
          ...(finalInputOrder ? { inputOrder: finalInputOrder } : {}),
          ...config.transitionSettings,
          ...config.viewport,
          outputShaders: config.outputShaders ?? [],
        });
      } catch (e) {
        console.warn('Failed to set layout or input order:', e);
      } finally {
        advanceImportProgress('Finalizing');
      }

      if (config.outputPlayer) {
        saveOutputPlayerSettings(roomId, config.outputPlayer);
      }

      await refreshState();
      advanceImportProgress('Finalizing');
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
