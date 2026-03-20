'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/spinner';
import { addHandsInput } from '@/app/actions/actions';
import type { Input } from '@/lib/types';

const VIDEO_TYPES = new Set([
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'whip',
]);

export function HandsAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const videoInputs = inputs.filter(
    (i) => VIDEO_TYPES.has(i.type) && i.status === 'connected',
  );
  const [selectedInputId, setSelectedInputId] = useState<string>(
    videoInputs[0]?.inputId ?? '',
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInputId) {
      toast.error('Select a video input source.');
      return;
    }
    setIsLoading(true);
    try {
      await addHandsInput(roomId, selectedInputId);
      await refreshState();
      toast.success('Hand tracking input added!');
    } catch (err) {
      toast.error('Failed to add hand tracking input.');
    } finally {
      setIsLoading(false);
    }
  };

  if (videoInputs.length === 0) {
    return (
      <p className='text-sm text-neutral-400'>
        No connected video inputs available. Add a video source first.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
      <div>
        <Label className='text-neutral-400 text-xs mb-1 block'>
          Source Input
        </Label>
        <select
          value={selectedInputId}
          onChange={(e) => setSelectedInputId(e.target.value)}
          className='w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white'>
          {videoInputs.map((input) => (
            <option key={input.inputId} value={input.inputId}>
              {input.title}
            </option>
          ))}
        </select>
      </div>
      <Button
        type='submit'
        disabled={isLoading || !selectedInputId}
        className='w-full bg-white text-black hover:bg-neutral-200 font-medium cursor-pointer'>
        {isLoading ? (
          <>
            Adding...
            <LoadingSpinner size='sm' variant='spinner' />
          </>
        ) : (
          'Add Hand Tracking'
        )}
      </Button>
    </form>
  );
}
