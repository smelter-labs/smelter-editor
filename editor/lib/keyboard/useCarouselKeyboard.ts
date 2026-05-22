'use client';

import { useEffect, useRef } from 'react';

type Options = {
  enabled: boolean;
  onNext: () => void;
  onPrev: () => void;
};

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useCarouselKeyboard({ enabled, onNext, onPrev }: Options) {
  const onNextRef = useRef(onNext);
  const onPrevRef = useRef(onPrev);
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);
  useEffect(() => {
    onPrevRef.current = onPrev;
  }, [onPrev]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        onNextRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrevRef.current();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
