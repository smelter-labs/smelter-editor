'use client';

import { useCallback, useEffect, useState } from 'react';

export { useIsLandscape } from '@/lib/arcade/use-viewport';

/**
 * Live pixel size of an element (ResizeObserver on a callback ref). Drives the
 * calibration range: PixelPanel's nested clip layers are content-sized, so the
 * play surface needs an explicit pixel height, and the hit-test needs the real
 * aspect ratio.
 */
export function useElementSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { w: number; h: number },
] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [ref, size];
}
