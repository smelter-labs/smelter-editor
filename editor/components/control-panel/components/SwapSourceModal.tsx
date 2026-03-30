'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useActions } from '../contexts/actions-context';
import { getMp4Duration } from '@/app/actions/actions';
import type { Input } from '@/lib/types';
import type { BlockSettings } from '../hooks/use-timeline-state';
import {
  Film,
  Image as ImageIcon,
  Tv,
  Video,
  Type,
  Gamepad2,
  Hand,
  Radio,
  Check,
} from 'lucide-react';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'sonner';

type Tab = 'inputs' | 'mp4s';

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
  const actions = useActions();
  const [tab, setTab] = useState<Tab>('inputs');
  const [mp4Files, setMp4Files] = useState<string[]>([]);
  const [loadingMp4s, setLoadingMp4s] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSwapping(null);
      return;
    }
    setLoadingMp4s(true);
    actions
      .getMP4Suggestions()
      .then((res) => setMp4Files(res.mp4s ?? []))
      .catch(() => setMp4Files([]))
      .finally(() => setLoadingMp4s(false));
  }, [open, actions]);

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

  const handlePickMp4 = useCallback(
    async (fileName: string) => {
      setSwapping(fileName);
      try {
        const response = await actions.addMP4Input(roomId, fileName);
        const newInputId: string = response.inputId;

        // Dispatch swap immediately so SWAP_CLIP_INPUT is queued before
        // any polling-triggered SYNC_TRACKS can see the new input as uncovered.
        onSwap({ newInputId, sourceUpdates: {} });
        onOpenChange(false);

        // Fetch duration in the background and apply as a follow-up settings patch.
        if (trackId && clipId) {
          getMp4Duration(fileName)
            .then((durationMs) => {
              window.dispatchEvent(
                new CustomEvent('smelter:timeline:update-clip-settings', {
                  detail: { trackId, clipId, patch: { mp4DurationMs: durationMs } },
                }),
              );
            })
            .catch(() => {});
        }
      } catch (err: any) {
        toast.error(`Failed to add MP4: ${err?.message || err}`);
      } finally {
        setSwapping(null);
      }
    },
    [roomId, actions, onSwap, onOpenChange, trackId, clipId],
  );

  const otherInputs = inputs.filter((i) => i.inputId !== currentInputId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[600px] w-[90vw] max-h-[70vh] bg-[#131313]/95 backdrop-blur-sm border border-[#3a494b]/30 p-0 gap-0 overflow-hidden [&>button]:text-[#849495] [&>button]:hover:text-[#e3fdff]'>
        <div className='flex flex-col h-full max-h-[70vh]'>
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
                variant={tab === 'mp4s' ? 'default' : 'outline'}
                className='h-7 px-3 text-xs cursor-pointer'
                onClick={() => setTab('mp4s')}>
                MP4 Files
              </Button>
            </div>
          </div>

          <div className='flex-1 overflow-y-auto p-4'>
            {tab === 'inputs' && (
              <div className='space-y-1'>
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

            {tab === 'mp4s' && (
              <div className='space-y-1'>
                {loadingMp4s && (
                  <div className='flex items-center justify-center py-8'>
                    <LoadingSpinner size='sm' variant='spinner' />
                  </div>
                )}
                {!loadingMp4s && mp4Files.length === 0 && (
                  <div className='text-xs text-muted-foreground py-8 text-center'>
                    No MP4 files available
                  </div>
                )}
                {!loadingMp4s &&
                  mp4Files.map((fileName) => {
                    const isAlreadyUsed = inputs.some(
                      (i) =>
                        i.type === 'local-mp4' &&
                        i.title === fileName &&
                        i.inputId === currentInputId,
                    );
                    const existingInput = inputs.find(
                      (i) => i.type === 'local-mp4' && i.title === fileName,
                    );
                    const isSwapping = swapping === fileName;
                    return (
                      <button
                        key={fileName}
                        disabled={!!swapping || isAlreadyUsed}
                        onClick={() => {
                          if (existingInput && !isAlreadyUsed) {
                            handlePickExistingInput(existingInput);
                          } else {
                            void handlePickMp4(fileName);
                          }
                        }}
                        className='w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-[#3a494b]/20 hover:border-[#00f3ff]/40 hover:bg-[#00f3ff]/5 transition-colors text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'>
                        <Film className='w-4 h-4 text-[#849495] shrink-0' />
                        <div className='flex-1 min-w-0'>
                          <div className='text-xs text-[#e3fdff] truncate'>
                            {fileName}
                          </div>
                          {existingInput && !isAlreadyUsed && (
                            <div className='text-[10px] text-[#849495]'>
                              Already in room — will reuse
                            </div>
                          )}
                        </div>
                        {isAlreadyUsed && (
                          <Check className='w-3.5 h-3.5 text-green-400 shrink-0' />
                        )}
                        {isSwapping && (
                          <LoadingSpinner size='sm' variant='spinner' />
                        )}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
