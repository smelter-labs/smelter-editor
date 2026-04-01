'use client';

import { useCallback, useEffect, useState } from 'react';
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

type Tab = 'inputs' | 'new-source';

const INPUT_TYPE_ICON: Record<string, React.ElementType> = {
  'local-mp4': Film,
  'twitch-channel': Tv,
  'kick-channel': Tv,
  hls: Radio,
  whip: Video,
  image: ImageIcon,
  'text-input': Type,
  game: Gamepad2,
  hands: Hand,
};

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

  useEffect(() => {
    if (!open) {
      setSwapping(null);
      setTab('inputs');
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

  const otherInputs = inputs.filter((i) => i.inputId !== currentInputId);

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
              <div className='space-y-1 overflow-y-auto p-4 h-full'>
                {otherInputs.length === 0 && (
                  <div className='text-xs text-muted-foreground py-8 text-center'>
                    No other inputs in this room
                  </div>
                )}
                {otherInputs.map((input) => {
                  const Icon = INPUT_TYPE_ICON[input.type] ?? Film;
                  const isSwapping = swapping === input.inputId;
                  return (
                    <button
                      key={input.inputId}
                      disabled={!!swapping}
                      onClick={() => handlePickExistingInput(input)}
                      className='w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-[#3a494b]/20 hover:border-[#00f3ff]/40 hover:bg-[#00f3ff]/5 transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'>
                      <Icon className='w-4 h-4 text-[#849495] shrink-0' />
                      <div className='flex-1 min-w-0'>
                        <div className='text-xs text-[#e3fdff] truncate'>
                          {input.title || input.inputId}
                        </div>
                        <div className='text-[10px] text-[#849495]'>
                          {inputTypeLabel(input.type)}
                          {input.sourceWidth && input.sourceHeight
                            ? ` \u2022 ${input.sourceWidth}\u00d7${input.sourceHeight}`
                            : ''}
                        </div>
                      </div>
                      {isSwapping && (
                        <LoadingSpinner size='sm' variant='spinner' />
                      )}
                    </button>
                  );
                })}
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
