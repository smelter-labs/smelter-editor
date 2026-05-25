'use client';

import { useAppMode } from './app-mode-context';

export function AdminModeBadge() {
  const { adminMode } = useAppMode();

  if (!adminMode) return null;

  return (
    <div
      aria-hidden
      className='fixed bottom-4 right-32 z-50 pointer-events-none select-none'>
      <div className='flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-foreground shadow-lg'>
        <span className='animate-gradient-shift h-2 w-2 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-red-500' />
        AdminMode
      </div>
    </div>
  );
}
