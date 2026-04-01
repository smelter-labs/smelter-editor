'use client';

import { useState } from 'react';
import type { Input } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ResolveMissingAssetModal } from '../components/ResolveMissingAssetModal';

export function MissingAssetMp4Row({
  roomId,
  input,
  refreshState,
}: {
  roomId: string;
  input: Input;
  refreshState: () => Promise<void>;
}) {
  const enabled = input.type === 'local-mp4' && input.mp4AssetMissing === true;
  const isAudio = input.missingAssetIsAudio === true;
  const [open, setOpen] = useState(false);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <div className='px-2 py-2 mt-1 border border-amber-700/40 bg-amber-950/20 rounded-sm space-y-2'>
        <p className='text-[10px] text-amber-200/90 leading-snug'>
          {input.description ||
            'File missing on server. Attach a replacement below.'}
        </p>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='h-7 text-[10px] cursor-pointer border-amber-400/30 text-amber-100 hover:bg-amber-400/10'
            onClick={() => setOpen(true)}>
            {isAudio ? 'Browse audio files' : 'Browse MP4 files'}
          </Button>
        </div>
      </div>

      <ResolveMissingAssetModal
        open={open}
        onOpenChange={setOpen}
        roomId={roomId}
        input={input}
        refreshState={refreshState}
      />
    </>
  );
}
