'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the viewport is landscape. The phone wizards restructure their JSX
 * per orientation (side rail vs footer), which CSS media queries can't do —
 * all phone styling is inline objects. SSR-safe: false until mounted.
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return landscape;
}
