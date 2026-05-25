'use client';

import { useAppMode } from './app-mode-context';

export function GeekModeBadge() {
  const { mode } = useAppMode();

  if (mode !== 'geek') return null;

  return (
    <div
      aria-hidden
      className='fixed bottom-4 right-4 z-50 pointer-events-none select-none'>
      <div className='animate-gradient-shift rounded-md border border-white/20 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 px-3 py-1.5 text-xs font-semibold tracking-wide text-white shadow-lg shadow-purple-500/30'>
        GeekMode
      </div>
    </div>
  );
}
