'use client';

import { useEffect, useState } from 'react';
import type {
  FbDirectorEvent,
  FbMatchEvent,
  FbStateEvent,
} from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';

export type FbFeed = {
  connected: boolean;
  state: FbStateEvent | null;
  match: FbMatchEvent | null;
  /** Wall-clock ms the last `match` snapshot arrived (clock interpolation). */
  matchReceivedAt: number;
};

/** Ms elapsed in the current half right now, interpolated between 1 Hz snapshots. */
export function elapsedNow(
  match: FbMatchEvent | null,
  receivedAt: number,
  now = Date.now(),
): number {
  if (!match) return 0;
  if (match.phase !== 'live') return match.elapsedMs;
  return Math.max(0, match.elapsedMs + (now - receivedAt));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Match minute as the score bug shows it: the second half continues from the half length. */
export function matchClock(
  match: FbMatchEvent | null,
  receivedAt: number,
  now = Date.now(),
): string {
  if (!match) return '0:00';
  const elapsed = elapsedNow(match, receivedAt, now);
  const shown = match.period === 2 ? elapsed + match.halfMs : elapsed;
  return formatClock(shown);
}

/**
 * Read-only live feed for the /football-game page: connects to the room
 * WebSocket, sends `fb_spectate` (snapshot reply, never a participant) and
 * consumes the match broadcasts. Reconnects with backoff while mounted.
 */
export function useFbFeed(roomId: string | null): FbFeed {
  const [state, setState] = useState<FbStateEvent | null>(null);
  const [match, setMatch] = useState<FbMatchEvent | null>(null);
  const [matchReceivedAt, setMatchReceivedAt] = useState(0);

  useEffect(() => {
    if (roomId) return;
    setState(null);
    setMatch(null);
  }, [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'fb_spectate' },
    onEvent: (parsed) => {
      if (parsed.type === 'fb_state') {
        setState(parsed as FbStateEvent);
      } else if (parsed.type === 'fb_director') {
        // 1 Hz between the (rarer) state snapshots: keeps the host's
        // DIRECTOR pill and PROGRAM caption current.
        const director = (parsed as FbDirectorEvent).director;
        setState((prev) => (prev ? { ...prev, director } : prev));
      } else if (parsed.type === 'fb_match') {
        setMatch(parsed as FbMatchEvent);
        setMatchReceivedAt(Date.now());
      }
    },
  });

  return { connected, state, match, matchReceivedAt };
}
