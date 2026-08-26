'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  KbtMatchEvent,
  KbtRepEvent,
  KbtStateEvent,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

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
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<KbtStateEvent | null>(null);
  const [match, setMatch] = useState<KbtMatchEvent | null>(null);
  const [recentReps, setRecentReps] = useState<KbtRepEvent[]>([]);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!roomId) {
      setConnected(false);
      setState(null);
      setMatch(null);
      setRecentReps([]);
      return;
    }

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const base =
        getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        getEffectiveClientServerUrl();
      let socket: WebSocket;
      try {
        socket = new WebSocket(
          `${toWsUrl(base)}/room/${encodeURIComponent(roomId)}/ws`,
        );
      } catch {
        scheduleRetry();
        return;
      }
      ws = socket;
      socket.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
        socket.send(JSON.stringify({ type: 'kbt_spectate' }));
      };
      socket.onmessage = (ev) => {
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(String(ev.data)) as { type?: string };
        } catch {
          return;
        }
        if (parsed.type === 'kbt_state') {
          setState(parsed as KbtStateEvent);
        } else if (parsed.type === 'kbt_match') {
          setMatch(parsed as KbtMatchEvent);
        } else if (parsed.type === 'kbt_rep') {
          setRecentReps((prev) =>
            [parsed as KbtRepEvent, ...prev].slice(0, TICKER_LEN),
          );
        }
      };
      socket.onclose = () => {
        if (ws === socket) ws = null;
        setConnected(false);
        scheduleRetry();
      };
      socket.onerror = () => {
        socket.close();
      };
    };

    const scheduleRetry = () => {
      if (closed || retryTimer != null) return;
      const delay = Math.min(8000, 500 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [roomId]);

  return { connected, state, match, recentReps };
}
