'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ConnectPlayCompletionModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ConnectPlayCompletionModal({
  open,
  onOpenChange,
}: ConnectPlayCompletionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Dziekujemy za ogladanie</DialogTitle>
          <DialogDescription>
            Dzieki, ze byles z nami do konca prezentacji. Jesli chcesz, pobaw
            sie teraz edytorem i sprawdz, co jeszcze da sie zbudowac.
          </DialogDescription>
        </DialogHeader>
        <div className='mt-4 flex justify-end'>
          <Button type='button' onClick={() => onOpenChange(false)}>
            Zamknij
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
