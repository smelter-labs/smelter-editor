'use client';

import { useEffect, useState } from 'react';

/**
 * The server's clock (`Date.now() - clockOffsetMs`), re-rendering every
 * `tickMs` — countdowns ("resumes in 8 s", "since 12 s") without making the
 * whole desk tick.
 */
export function useServerNow(clockOffsetMs: number, tickMs = 250): number {
  const [localNow, setLocalNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setLocalNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);
  return localNow - clockOffsetMs;
}
