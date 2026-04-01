'use client';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Input } from '@/lib/types';
import { AlertTriangle } from 'lucide-react';
import { useResolveMissingLocalMp4Source } from '../hooks/use-resolve-missing-local-mp4-source';
import { MediaFileBrowser } from './MediaFileBrowser';

export function ResolveMissingAssetModal({
  open,
  onOpenChange,
  roomId,
  input,
  refreshState,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  input: Input | null;
  refreshState: () => Promise<void>;
}) {
  const valid =
    input != null &&
    ((input.type === 'local-mp4' && input.mp4AssetMissing === true) ||
      (input.type === 'image' && input.imageAssetMissing === true));
  const assetType =
    input?.type === 'image'
      ? 'picture'
      : input?.missingAssetIsAudio === true
        ? 'audio'
        : 'mp4';

  const { selected, setSelected, attaching, attach } =
    useResolveMissingLocalMp4Source({
      roomId,
      inputId: input?.inputId ?? '',
      assetType,
      enabled: open && valid,
      refreshState,
    });

  const handleAttach = () => {
    void attach().then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  const description =
    input?.description || 'File missing on server. Attach a replacement below.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[760px] w-[94vw] bg-[#131313]/95 backdrop-blur-sm border border-[#3a494b]/30 p-0 gap-0 overflow-hidden [&>button]:text-[#849495] [&>button]:hover:text-[#e3fdff]'>
        <div className='flex flex-col'>
          <div className='px-5 pt-5 pb-3 border-b border-[#3a494b]/20'>
            <div className='flex items-start gap-2'>
              <AlertTriangle className='w-5 h-5 text-amber-400 shrink-0 mt-0.5' />
              <div>
                <h2 className='text-sm font-semibold text-[#e3fdff]'>
                  Attach missing source
                </h2>
                <p className='text-[11px] text-[#849495] mt-1 leading-snug'>
                  {input?.title ? (
                    <span className='text-[#e3fdff]/90'>{input.title}</span>
                  ) : null}
                  {input?.title ? ' — ' : null}
                  Same input is kept; only the file path is updated.
                </p>
              </div>
            </div>
          </div>
          <div className='p-5 space-y-3'>
            {!valid ? (
              <p className='text-xs text-muted-foreground'>
                No missing file to resolve.
              </p>
            ) : (
              <>
                <p className='text-[11px] text-amber-200/90 leading-snug'>
                  {description}
                </p>
                <MediaFileBrowser
                  mediaType={assetType}
                  selectedFile={selected}
                  disabled={attaching}
                  onSelect={setSelected}
                />
                <div className='flex justify-end'>
                  <Button
                    type='button'
                    size='sm'
                    className='h-9 text-xs cursor-pointer'
                    disabled={attaching || !selected}
                    onClick={handleAttach}>
                    {attaching ? '…' : 'Attach'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
