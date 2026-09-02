'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Two-press arm state with an auto-disarm window, keyed by id so one hook can
 * guard a whole list (each row arms under its own key, and arming a second row
 * disarms the first).
 *
 * The arcade screens are driven from a couch, often by whoever is nearest the
 * keyboard, so every destructive control — kick a player, restart a heat — asks
 * twice. The window is what keeps a forgotten armed button from firing minutes
 * later on an unrelated press.
 *
 * Shared by Duck Hunter and the Kettlebell Tournament; both kits re-export it,
 * so screens import from their own kit rather than reaching across games.
 */
export function useArmed(timeoutMs = 5000): {
  armed: string | null;
  arm: (id: string) => void;
  disarm: () => void;
} {
  const [armed, setArmed] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const disarm = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(null);
  }, []);
  const arm = useCallback(
    (id: string) => {
      setArmed(id);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setArmed(null);
      }, timeoutMs);
    },
    [timeoutMs],
  );
  useEffect(() => disarm, [disarm]);
  return { armed, arm, disarm };
}
