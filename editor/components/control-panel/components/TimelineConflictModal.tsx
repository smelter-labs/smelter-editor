'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type TimelineConflictModalProps = {
  open: boolean;
  pending?: boolean;
  onApplyChanges: () => void;
  onDiscardChanges: () => void;
  onCancel: () => void;
};

export function TimelineConflictModal({
  open,
  pending = false,
  onApplyChanges,
  onDiscardChanges,
  onCancel,
}: TimelineConflictModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Timeline conflict detected</DialogTitle>
        </DialogHeader>
        <p className='text-sm text-muted-foreground'>
          You changed the scene in `layers` mode while timeline was paused.
          Choose whether to write current scene changes into timeline, or
          restore timeline snapshot and discard current scene changes.
        </p>
        <div className='mt-4 flex justify-end gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={onCancel}
            disabled={pending}>
            Cancel
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={onDiscardChanges}
            disabled={pending}>
            Restore Timeline
          </Button>
          <Button type='button' onClick={onApplyChanges} disabled={pending}>
            Apply Current Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
