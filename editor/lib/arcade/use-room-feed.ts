'use client';

import { useEffect, useRef, useState } from 'react';
import { WS_CLOSE_ROOM_NOT_FOUND } from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

export type RoomSocketFeedOptions = {
  /**
   * Sent once per (re)connect — the game's spectate handshake (snapshot
   * reply, never creates a player), e.g. `{ type: 'shoot_spectate' }`.
   */
  spectateMessage: object;
  /** Every parsed server event; the per-game hook dispatches into its state. */
  onEvent: (event: { type?: string }) => void;
  /**
   * The room no longer exists (server closed with 4404 / sent `room_error`).
   * Reconnecting is pointless, so the feed stops retrying; the caller should
   * surface a "room gone" state instead of a spinner.
   */
  onRoomGone?: () => void;
};

/**
 * Read-only live feed shared by the arcade pages (duck-hunter,
 * kettlebell-tournament): connects to the room WebSocket, sends the game's
 * spectate handshake and forwards every broadcast to `onEvent`. Reconnects
 * with exponential backoff while mounted. Callbacks are held in refs so
 * caller re-renders never tear the socket down.
 */
export function useRoomSocketFeed(
  roomId: string | null,
  options: RoomSocketFeedOptions,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const attemptRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!roomId) {
      setConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | null = null;
    let roomGoneNotified = false;

    // The server both sends `room_error` and closes with 4404 — notify once.
    const notifyRoomGone = () => {
      closed = true;
      if (roomGoneNotified) return;
      roomGoneNotified = true;
      optionsRef.current.onRoomGone?.();
    };

    const connect = () => {
      if (closed) return;
      // Same resolution chain as the phone controllers: stored URL → public
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
        socket.send(JSON.stringify(optionsRef.current.spectateMessage));
      };
      socket.onmessage = (ev) => {
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(String(ev.data)) as { type?: string };
        } catch {
          return;
        }
        if (parsed.type === 'room_error') {
          notifyRoomGone();
          return;
        }
        optionsRef.current.onEvent(parsed);
      };
      socket.onclose = (ev) => {
        if (ws === socket) ws = null;
        setConnected(false);
        if (ev.code === WS_CLOSE_ROOM_NOT_FOUND) {
          notifyRoomGone();
          return;
        }
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

  return { connected };
}
