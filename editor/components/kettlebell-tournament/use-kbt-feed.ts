'use client';

import { useEffect, useState } from 'react';
import type { KbtMatchEvent, KbtStateEvent } from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';

export type KbtFeed = {
  connected: boolean;
  state: KbtStateEvent | null;
  match: KbtMatchEvent | null;
};

/**
 * Read-only live feed for the /kettlebell-tournament page: connects to the
 * room WebSocket, sends `kbt_spectate` (snapshot reply, never a player) and
 * consumes the tournament broadcasts. Reconnects with backoff while mounted.
 *
 * `kbt_rep` is deliberately not kept in state: nothing on the host page reads
 * a play-by-play, and a setState per scored rep re-rendered the whole arcade
 * (fullscreen program video included) for every rep of a heat.
 */
export function useKbtFeed(roomId: string | null): KbtFeed {
  const [state, setState] = useState<KbtStateEvent | null>(null);
  const [match, setMatch] = useState<KbtMatchEvent | null>(null);

  useEffect(() => {
    if (roomId) return;
    setState(null);
    setMatch(null);
  }, [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'kbt_spectate' },
    onEvent: (parsed) => {
      if (parsed.type === 'kbt_state') {
        setState(parsed as KbtStateEvent);
      } else if (parsed.type === 'kbt_match') {
        setMatch(parsed as KbtMatchEvent);
      }
    },
  });

  return { connected, state, match };
}
