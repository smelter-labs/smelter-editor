'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

export type ImportProgressState = {
  phase: string;
  current: number;
  total: number;
};

type ImportProgressDialogProps = {
  progress: ImportProgressState | null;
};

export function ImportProgressDialog({ progress }: ImportProgressDialogProps) {
  const total = progress?.total ?? 0;
  const current = progress ? Math.min(progress.current, total) : 0;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Dialog open={progress !== null} onOpenChange={() => {}}>
      <DialogContent
        className='max-w-md [&>button]:hidden'
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Importing Configuration</DialogTitle>
          <DialogDescription>
            Applying the saved room setup. This dialog will close automatically
            when the import finishes.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <p className='text-sm font-medium text-white'>{progress?.phase}</p>
            <p className='text-sm text-neutral-400 tabular-nums'>{percent}%</p>
          </div>

          <Progress value={percent} />

          <p className='text-xs text-neutral-500 tabular-nums'>
            {current} / {total} requests completed
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
