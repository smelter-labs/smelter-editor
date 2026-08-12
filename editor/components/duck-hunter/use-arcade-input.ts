'use client';

import { useEffect, useRef } from 'react';

export type ArcadeKeyHandlers = {
  left?: () => void;
  right?: () => void;
  up?: () => void;
  down?: () => void;
  /** Enter / Space — the (A) button. */
  confirm?: () => void;
  /** Escape / Backspace — the (B) button. */
  back?: () => void;
};

/**
 * Arcade-cabinet keyboard navigation for the /duck-hunter screens. One
 * hook per screen; handlers are kept in a ref so callers can pass fresh
 * closures every render without re-binding the listener. Disabled while
 * a text input is focused so typing never triggers navigation.
 */
export function useArcadeKeys(handlers: ArcadeKeyHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      const h = ref.current;
      switch (e.key) {
        case 'ArrowLeft':
          if (h.left) {
            e.preventDefault();
            h.left();
          }
          break;
        case 'ArrowRight':
          if (h.right) {
            e.preventDefault();
            h.right();
          }
          break;
        case 'ArrowUp':
          if (h.up) {
            e.preventDefault();
            h.up();
          }
          break;
        case 'ArrowDown':
          if (h.down) {
            e.preventDefault();
            h.down();
          }
          break;
        case 'Enter':
        case ' ':
          if (h.confirm) {
            e.preventDefault();
            h.confirm();
          }
          break;
        case 'Escape':
        case 'Backspace':
          if (h.back) {
            e.preventDefault();
            h.back();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
