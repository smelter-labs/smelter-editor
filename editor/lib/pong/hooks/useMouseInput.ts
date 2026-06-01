'use client';

import { type RefObject, useEffect, useRef } from 'react';

export type MouseInputRef = {
  current: { y: number | null };
};

// Tracks the mouse Y position (normalized 0..1) over a given element.
// Null when the cursor leaves the element.
export function useMouseInput(
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): MouseInputRef {
  const ref = useRef<{ y: number | null }>({ y: null });

  useEffect(() => {
    const el = elementRef.current;
    if (!el || !enabled) {
      ref.current.y = null;
      return;
    }

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const norm = (e.clientY - rect.top) / rect.height;
      ref.current.y = Math.max(0, Math.min(1, norm));
    };
    const onLeave = () => {
      ref.current.y = null;
    };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      ref.current.y = null;
    };
  }, [elementRef, enabled]);

  return ref;
}
