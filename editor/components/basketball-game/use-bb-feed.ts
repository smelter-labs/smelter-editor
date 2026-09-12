'use client';

import { useEffect, useState } from 'react';
import type {
  BbMatchEvent,
  BbShotChangeEvent,
  BbStateEvent,
} from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';

export type BbFeed = {
  connected: boolean;
  state: BbStateEvent | null;
  match: BbMatchEvent | null;
  /** Wall-clock ms the last `match` snapshot arrived (clock interpolation). */
  matchReceivedAt: number;
  /** Rolling ledger changes (newest first) for the host ticker. */
  shots: BbShotChangeEvent[];
};

/** Regulation ms remaining right now, interpolated between 1 Hz snapshots. */
export function remainingNow(
  match: BbMatchEvent | null,
  receivedAt: number,
  now = Date.now(),
): number {
  if (!match) return 0;
  if (match.phase !== 'live') return match.remainingMs;
  return Math.max(0, match.remainingMs - (now - receivedAt));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TICKER_LEN = 10;

/**
 * Read-only live feed for the /basketball-game page: connects to the room
 * WebSocket, sends `bb_spectate` (snapshot reply, never a participant) and
 * consumes the match broadcasts. Reconnects with backoff while mounted.
 */
export function useBbFeed(roomId: string | null): BbFeed {
  const [state, setState] = useState<BbStateEvent | null>(null);
  const [match, setMatch] = useState<BbMatchEvent | null>(null);
  const [matchReceivedAt, setMatchReceivedAt] = useState(0);
  const [shots, setShots] = useState<BbShotChangeEvent[]>([]);

  useEffect(() => {
    if (roomId) return;
    setState(null);
    setMatch(null);
    setShots([]);
  }, [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'bb_spectate' },
    onEvent: (parsed) => {
      if (parsed.type === 'bb_state') {
        setState(parsed as BbStateEvent);
      } else if (parsed.type === 'bb_match') {
        setMatch(parsed as BbMatchEvent);
        setMatchReceivedAt(Date.now());
      } else if (parsed.type === 'bb_shot') {
        setShots((prev) =>
          [parsed as BbShotChangeEvent, ...prev].slice(0, TICKER_LEN),
        );
      }
    },
  });

  return { connected, state, match, matchReceivedAt, shots };
}
