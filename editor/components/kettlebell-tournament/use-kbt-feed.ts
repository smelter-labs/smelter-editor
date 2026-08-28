'use client';

import { useEffect, useState } from 'react';
import type {
  KbtMatchEvent,
  KbtRepEvent,
  KbtStateEvent,
} from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';

export type KbtFeed = {
  connected: boolean;
  state: KbtStateEvent | null;
  match: KbtMatchEvent | null;
  /** Rolling play-by-play (newest first) for the host chrome ticker. */
  recentReps: KbtRepEvent[];
};

const TICKER_LEN = 6;

/**
 * Read-only live feed for the /kettlebell-tournament page: connects to the
 * room WebSocket, sends `kbt_spectate` (snapshot reply, never a player) and
 * consumes the tournament broadcasts. Reconnects with backoff while mounted.
 */
export function useKbtFeed(roomId: string | null): KbtFeed {
  const [state, setState] = useState<KbtStateEvent | null>(null);
  const [match, setMatch] = useState<KbtMatchEvent | null>(null);
  const [recentReps, setRecentReps] = useState<KbtRepEvent[]>([]);

  useEffect(() => {
    if (roomId) return;
    setState(null);
    setMatch(null);
    setRecentReps([]);
  }, [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'kbt_spectate' },
    onEvent: (parsed) => {
      if (parsed.type === 'kbt_state') {
        setState(parsed as KbtStateEvent);
      } else if (parsed.type === 'kbt_match') {
        setMatch(parsed as KbtMatchEvent);
      } else if (parsed.type === 'kbt_rep') {
        setRecentReps((prev) =>
          [parsed as KbtRepEvent, ...prev].slice(0, TICKER_LEN),
        );
      }
    },
  });

  return { connected, state, match, recentReps };
}
