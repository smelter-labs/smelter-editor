'use client';

import { useCallback, useMemo, useState } from 'react';
import { Captions, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Input } from '@/lib/types';
import { toggleTranscription } from '@/app/actions/actions';

const VIDEO_INPUT_TYPES = new Set([
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
]);

interface CaptionsPanelProps {
  roomId: string;
  inputs: Input[];
  refreshState: () => Promise<void>;
}

export function CaptionsPanel({
  roomId,
  inputs,
  refreshState,
}: CaptionsPanelProps) {
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(
    new Set(),
  );

  const videoInputs = useMemo(
    () => inputs.filter((input) => VIDEO_INPUT_TYPES.has(input.type)),
    [inputs],
  );

  const handleToggle = useCallback(
    async (inputId: string, enabled: boolean) => {
      setPendingInputIds((prev) => new Set(prev).add(inputId));
      try {
        await toggleTranscription(roomId, inputId, enabled);
        await refreshState();
      } finally {
        setPendingInputIds((prev) => {
          const next = new Set(prev);
          next.delete(inputId);
          return next;
        });
      }
    },
    [refreshState, roomId],
  );

  if (videoInputs.length === 0) {
    return (
      <p className='text-xs text-neutral-500 p-3'>
        No video inputs in this room.
      </p>
    );
  }

  return (
    <div className='space-y-2 p-2'>
      {videoInputs.map((input) => {
        const isEnabled = input.transcription === true;
        const isPending = pendingInputIds.has(input.inputId);
        const label = input.title || input.inputId;

        return (
          <div
            key={input.inputId}
            className='rounded-md border border-neutral-800 bg-neutral-950/60'>
            <div className='flex items-center gap-2 p-3'>
              <Captions className='h-4 w-4 shrink-0 text-neutral-400' />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-xs font-medium text-neutral-200'>
                  {label}
                </p>
                <p className='text-[10px] text-neutral-500 uppercase'>
                  {input.type.replace('-', ' ')}
                  {input.status !== 'connected' ? ` · ${input.status}` : ''}
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                variant={isEnabled ? 'default' : 'outline'}
                disabled={isPending}
                onClick={() =>
                  void handleToggle(input.inputId, !isEnabled)
                }
                className='shrink-0 h-7 px-2 text-[10px] font-mono uppercase'>
                <Power className='mr-1 h-3 w-3' />
                {isPending ? '...' : isEnabled ? 'On' : 'Off'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
