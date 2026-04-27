'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ConnectPlayCompletionModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  farewellTitle?: string;
  farewellDescription?: string;
};

export function ConnectPlayCompletionModal({
  open,
  onOpenChange,
  farewellTitle,
  farewellDescription,
}: ConnectPlayCompletionModalProps) {
  const resolvedFarewellTitle =
    farewellTitle?.trim() || 'Thanks for watching';
  const resolvedFarewellDescription =
    farewellDescription?.trim() ||
    'Thanks for sticking with us to the end of the presentation. If you like, play around with the editor now and see what else you can build.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogTitle className='sr-only'>{resolvedFarewellTitle}</DialogTitle>
        <div
          className='rich-text-content text-sm text-neutral-300'
          dangerouslySetInnerHTML={{ __html: resolvedFarewellDescription }}
        />
        <div className='mt-4 flex justify-end'>
          <Button type='button' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
