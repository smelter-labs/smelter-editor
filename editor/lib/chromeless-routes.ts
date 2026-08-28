'use client';

import { usePathname } from 'next/navigation';

/**
 * Routes whose pages ARE the output (previews, the arcade cabinet): global
 * app chrome — toasts, voice/timeline popovers, mode badges — must not
 * render on top of them.
 */
export const CHROMELESS_PREFIXES = [
  '/raw-preview',
  '/room-preview',
  '/duck-hunter',
];

export function isChromelessRoute(pathname: string): boolean {
  return CHROMELESS_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Current route is a chromeless (output-owning) page. */
export function useIsChromelessRoute(): boolean {
  const pathname = usePathname();
  return isChromelessRoute(pathname);
}
