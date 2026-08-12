'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ShooterMatchEvent,
  ShooterPlayer,
  ShooterServerEvent,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

export type ShooterFeed = {
  connected: boolean;
  players: ShooterPlayer[];
  /** Whether a duck-enabled input is live (the YOLO sidecar is warm). */
  targetActive: boolean;
  match: ShooterMatchEvent | null;
};

/**
 * Read-only live feed for the /duck-hunter arcade page: connects to the
 * room WebSocket, sends `shoot_spectate` (snapshot reply, never creates a
 * player) and then consumes the `shooter_state` / `shooter_match`
 * broadcasts. Reconnects with backoff while the page stays mounted.
 */
export function useShooterFeed(roomId: string | null): ShooterFeed {
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<ShooterPlayer[]>([]);
  const [targetActive, setTargetActive] = useState(false);
  const [match, setMatch] = useState<ShooterMatchEvent | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!roomId) {
      setConnected(false);
      setPlayers([]);
      setTargetActive(false);
      setMatch(null);
      return;
    }

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      // Same resolution chain as the phone controller: stored URL → public
      // build-time default → the effective (same-origin/tunnel) fallback.
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
        socket.send(JSON.stringify({ type: 'shoot_spectate' }));
      };
      socket.onmessage = (ev) => {
        let parsed: ShooterServerEvent;
        try {
          parsed = JSON.parse(String(ev.data)) as ShooterServerEvent;
        } catch {
          return;
        }
        if (parsed.type === 'shooter_state') {
          setPlayers(parsed.players);
          setTargetActive(parsed.targetActive);
        } else if (parsed.type === 'shooter_match') {
          setMatch(parsed);
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

  return { connected, players, targetActive, match };
}
