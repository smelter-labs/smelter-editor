'use client';

import { useEffect, useRef } from 'react';
import type { ObTally } from '@smelter-editor/types';
import { tallyVibration } from '@/lib/ob-van/tally';

/**
 * Buzz the camera phone when its tally changes (going on air gets a double
 * pulse, coming off air a short tick). The first tally after a join and a
 * cleared tally (`null`) stay quiet.
 */
export function useTallyVibration(tally: ObTally | null): void {
  const prevRef = useRef<ObTally | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = tally;
    if (tally == null) return;
    const pattern = tallyVibration(prev, tally);
    if (!pattern) return;
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.vibrate !== 'function'
    ) {
      return;
    }
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw without a prior user gesture — tally still shows.
    }
  }, [tally]);
}
