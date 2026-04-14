'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getMp4Duration } from '@/app/actions/actions';
import type { Input } from '@/lib/types';
import type { BlockSettings } from '../hooks/use-timeline-state';
import { emitTimelineEvent, TIMELINE_EVENTS } from './timeline/timeline-events';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import {
  Film,
  Image as ImageIcon,
  Music,
  Tv,
  Video,
  Type,
  Gamepad2,
  Hand,
  Radio,
} from 'lucide-react';
import LoadingSpinner from '@/components/ui/spinner';
import {
  AssetBrowser,
  type AssetBrowserInputCreated,
} from './asset-browser/AssetBrowser';
import { SelectablePreviewCard } from './asset-browser/selectable-preview-card';

type Tab = 'inputs' | 'new-source';

const EXISTING_INPUT_FILTERS = [
  'ALL',
  'STREAM',
  'HLS',
  'MP4',
  'AUDIO',
  'IMAGE',
  'INPUT',
  'TEXT',
  'GAME',
  'HANDS',
] as const;
type ExistingInputFilter = (typeof EXISTING_INPUT_FILTERS)[number];

function inputTypeLabel(type: string): string {
  switch (type) {
    case 'local-mp4':
      return 'MP4';
    case 'twitch-channel':
      return 'Twitch';
    case 'kick-channel':
      return 'Kick';
    case 'hls':
      return 'HLS';
    case 'whip':
      return 'Camera/WHIP';
    case 'image':
      return 'Image';
    case 'text-input':
      return 'Text';
    case 'game':
      return 'Game';
    case 'hands':
      return 'Hands';
    default:
      return type;
  }
}

function inputFilterCategory(
  input: Input,
): Exclude<ExistingInputFilter, 'ALL'> {
  switch (input.type) {
    case 'local-mp4':
      return input.audioFileName || input.missingAssetIsAudio ? 'AUDIO' : 'MP4';
    case 'twitch-channel':
    case 'kick-channel':
      return 'STREAM';
    case 'hls':
      return 'HLS';
    case 'whip':
      return 'INPUT';
    case 'image':
      return 'IMAGE';
    case 'text-input':
      return 'TEXT';
    case 'game':
      return 'GAME';
    case 'hands':
      return 'HANDS';
  }
}

function inputMatchesFilter(
  input: Input,
  filter: ExistingInputFilter,
): boolean {
  if (filter === 'ALL') return true;
  return inputFilterCategory(input) === filter;
}

function inputSubtitle(input: Input): string | undefined {
  if (input.type === 'text-input') return input.text || 'TEXT SOURCE';
  if (input.type === 'hls') return input.url || 'HLS STREAM';
  if (
    (input.type === 'twitch-channel' || input.type === 'kick-channel') &&
    input.channelId
  ) {
    return input.channelId;
  }

  if (input.sourceWidth && input.sourceHeight) {
    return `${inputTypeLabel(input.type)} \u2022 ${input.sourceWidth}\u00d7${input.sourceHeight}`;
  }
  return inputTypeLabel(input.type);
}

function ExistingInputThumbnail({ input }: { input: Input }) {
  if (input.type === 'local-mp4') {
    if (input.audioFileName || input.missingAssetIsAudio) {
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#a855f7]/15 to-[#131313]'>
          <Music className='w-10 h-10 opacity-50 text-[#d8b4fe] group-hover:opacity-70 transition-opacity' />
        </div>
      );
    }

    if (input.mp4FileName) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/mp4-thumbnail?fileName=${encodeURIComponent(input.mp4FileName)}`}
          alt={input.title || input.inputId}
          className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
        />
      );
    }
  }

  if (input.type === 'image' && input.imageFileName) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/pictures/${encodeURIComponent(input.imageFileName)}`}
        alt={input.title || input.inputId}
        className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
      />
    );
  }

  if (input.type === 'twitch-channel') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#9146FF]/20 to-[#131313]'>
        <Tv className='w-10 h-10 opacity-50 text-[#c4b5fd] group-hover:opacity-70 transition-opacity' />
      </div>
    );
  }

  if (input.type === 'kick-channel') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#53FC18]/15 to-[#131313]'>
        <span className='font-mono font-black text-xl text-[#53FC18]/50 tracking-tighter group-hover:text-[#53FC18]/70 transition-colors'>
          K
        </span>
      </div>
    );
  }

  if (input.type === 'hls') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff6b00]/15 to-[#131313]'>
        <Radio className='w-10 h-10 opacity-50 text-[#fdba74] group-hover:opacity-70 transition-opacity' />
      </div>
    );
  }

  if (input.type === 'whip') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#00f3ff]/15 to-[#131313]'>
        <Video className='w-10 h-10 opacity-50 text-[#67e8f9] group-hover:opacity-70 transition-opacity' />
      </div>
    );
  }

  if (input.type === 'text-input') {
    return (
      <div className='w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#64748b]/20 to-[#131313] p-2'>
        <Type className='w-7 h-7 opacity-50 text-[#cbd5e1] group-hover:opacity-70 transition-opacity mb-1' />
        <span className='font-mono text-[10px] text-[#cbd5e1]/70 truncate w-full text-center'>
          {input.text || 'TEXT'}
        </span>
      </div>
    );
  }

  if (input.type === 'game') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#f59e0b]/20 to-[#131313]'>
        <Gamepad2 className='w-10 h-10 opacity-50 text-[#fcd34d] group-hover:opacity-70 transition-opacity' />
      </div>
    );
  }

  if (input.type === 'hands') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#22c55e]/20 to-[#131313]'>
        <Hand className='w-10 h-10 opacity-50 text-[#86efac] group-hover:opacity-70 transition-opacity' />
      </div>
    );
  }

  return (
    <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#3a494b]/20 to-[#131313]'>
      <Film className='w-10 h-10 opacity-50 text-[#849495] group-hover:opacity-70 transition-opacity' />
    </div>
  );
}

export interface SwapSourceResult {
  newInputId: string;
  sourceUpdates: Partial<BlockSettings>;
}

export function SwapSourceModal({
  open,
  onOpenChange,
  currentInputId,
  inputs,
  roomId,
  onSwap,
  trackId,
  clipId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentInputId: string;
  inputs: Input[];
  roomId: string;
  onSwap: (result: SwapSourceResult) => void;
  trackId?: string;
  clipId?: string;
}) {
  const { refreshState } = useControlPanelContext();
  const whipCtx = useWhipConnectionsContext();
  const [tab, setTab] = useState<Tab>('inputs');
  const [swapping, setSwapping] = useState<string | null>(null);
  const [existingInputFilter, setExistingInputFilter] =
    useState<ExistingInputFilter>('ALL');

  useEffect(() => {
    if (!open) {
      setSwapping(null);
      setTab('inputs');
      setExistingInputFilter('ALL');
    }
  }, [open]);

  const handlePickExistingInput = useCallback(
    (input: Input) => {
      if (input.inputId === currentInputId) return;
      setSwapping(input.inputId);
      const sourceUpdates: Partial<BlockSettings> = {
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
      };
      onSwap({ newInputId: input.inputId, sourceUpdates });
      onOpenChange(false);
    },
    [currentInputId, onSwap, onOpenChange],
  );

  const handleAssetCreated = useCallback(
    async ({
      inputId,
      kind,
      fileName,
      durationMs,
    }: AssetBrowserInputCreated) => {
      onSwap({ newInputId: inputId, sourceUpdates: {} });
      onOpenChange(false);

      if (trackId && clipId && kind === 'mp4') {
        const resolvedDurationMs =
          durationMs ??
          (fileName
            ? await getMp4Duration(fileName).catch(() => undefined)
            : undefined);

        if (resolvedDurationMs != null) {
          emitTimelineEvent(TIMELINE_EVENTS.UPDATE_CLIP_SETTINGS, {
            trackId,
            clipId,
            patch: { mp4DurationMs: resolvedDurationMs },
          });
        }
      }
    },
    [clipId, onOpenChange, onSwap, trackId],
  );

  const otherInputs = useMemo(
    () => inputs.filter((i) => i.inputId !== currentInputId),
    [currentInputId, inputs],
  );

  const availableExistingInputFilters = useMemo(() => {
    const categories = new Set(
      otherInputs.map((input) => inputFilterCategory(input)),
    );
    return EXISTING_INPUT_FILTERS.filter(
      (filter) => filter === 'ALL' || categories.has(filter),
    );
  }, [otherInputs]);

  useEffect(() => {
    if (!availableExistingInputFilters.includes(existingInputFilter)) {
      setExistingInputFilter('ALL');
    }
  }, [availableExistingInputFilters, existingInputFilter]);

  const filteredExistingInputs = useMemo(
    () =>
      otherInputs.filter((input) =>
        inputMatchesFilter(input, existingInputFilter),
      ),
    [existingInputFilter, otherInputs],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[1100px] w-[95vw] max-h-[85vh] h-[85vh] bg-[#131313]/95 backdrop-blur-sm border border-[#3a494b]/30 p-0 gap-0 overflow-hidden [&>button]:text-[#849495] [&>button]:hover:text-[#e3fdff]'>
        <div className='flex flex-col h-full'>
          <div className='px-5 pt-5 pb-3 border-b border-[#3a494b]/20'>
            <h2 className='text-sm font-semibold text-[#e3fdff] mb-3'>
              Change Source
            </h2>
            <div className='flex gap-1'>
              <Button
                size='sm'
                variant={tab === 'inputs' ? 'default' : 'outline'}
                className='h-7 px-3 text-xs cursor-pointer'
                onClick={() => setTab('inputs')}>
                Existing Inputs ({otherInputs.length})
              </Button>
              <Button
                size='sm'
                variant={tab === 'new-source' ? 'default' : 'outline'}
                className='h-7 px-3 text-xs cursor-pointer'
                onClick={() => setTab('new-source')}>
                New Source
              </Button>
            </div>
          </div>

          <div className='flex-1 min-h-0'>
            {tab === 'inputs' && (
              <div className='overflow-y-auto p-4 h-full'>
                <div className='flex gap-1.5 flex-wrap mb-3'>
                  {availableExistingInputFilters.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setExistingInputFilter(filter)}
                      className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                        existingInputFilter === filter
                          ? 'bg-[#00f3ff] text-black font-bold'
                          : 'bg-[#1c1b1b] text-[#849495] hover:text-[#e3fdff] border border-[#3a494b]/20'
                      }`}>
                      {filter}
                    </button>
                  ))}
                </div>

                {otherInputs.length === 0 ? (
                  <div className='text-xs text-muted-foreground py-8 text-center'>
                    No other inputs in this room
                  </div>
                ) : filteredExistingInputs.length === 0 ? (
                  <div className='text-xs text-muted-foreground py-8 text-center'>
                    No inputs match selected filter
                  </div>
                ) : (
                  <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                    {filteredExistingInputs.map((input) => {
                      const isSwapping = swapping === input.inputId;
                      return (
                        <SelectablePreviewCard
                          key={input.inputId}
                          onClick={() => handlePickExistingInput(input)}
                          disabled={!!swapping}
                          isSelected={isSwapping}
                          badge={inputTypeLabel(input.type).toUpperCase()}
                          label={input.title || input.inputId}
                          subtitle={inputSubtitle(input)}
                          thumbnail={<ExistingInputThumbnail input={input} />}
                          loadingIndicator={
                            isSwapping ? (
                              <LoadingSpinner size='sm' variant='spinner' />
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'new-source' && (
              <AssetBrowser
                roomId={roomId}
                refreshState={refreshState}
                inputs={inputs}
                whipCtx={whipCtx}
                onDone={refreshState}
                onInputCreated={handleAssetCreated}
                availableFilters={[
                  'ALL',
                  'STREAM',
                  'HLS',
                  'MP4',
                  'AUDIO',
                  'IMAGE',
                  'TEXT',
                  'GAME',
                ]}
                allowUpload={true}
                headerTitle='SOURCE_LIBRARY'
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
