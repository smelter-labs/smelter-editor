'use client';

import { useEffect, useRef, useState } from 'react';
import { getEffectiveClientServerUrl, toWsUrl } from '@/lib/server-url';

// Mirrors server/src/core/roomEventBus.ts - sync manually.
export type ConnectedPeer = {
  clientId: string;
  name: string | null;
};

type InputUpdatedEvent = {
  type: 'input_updated';
  roomId: string;
  inputId: string;
  input: unknown;
  sourceId: string | null;
};

type InputDeletedEvent = {
  type: 'input_deleted';
  roomId: string;
  inputId: string;
  sourceId: string | null;
};

type RoomUpdatedEvent = {
  type: 'room_updated';
  roomId: string;
  sourceId: string | null;
};

type PeersUpdatedEvent = {
  type: 'peers_updated';
  roomId: string;
  peers: ConnectedPeer[];
};

type ConnectedEvent = {
  type: 'connected';
  clientId: string;
};

type ServerMessage =
  | InputUpdatedEvent
  | InputDeletedEvent
  | RoomUpdatedEvent
  | PeersUpdatedEvent
  | ConnectedEvent;

const CLIENT_NAME = 'Editor';
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
// Code sent by the server when the room is deleted — no point reconnecting.
const CLOSE_CODE_ROOM_DELETED = 1001;

type Opts = {
  onRemoteInputChange?: () => void;
};

export function useRoomWebSocket(
  roomId: string,
  opts?: Opts,
): { peers: ConnectedPeer[] } {
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let destroyed = false;

    function connect() {
      const wsBase = toWsUrl(getEffectiveClientServerUrl());
      const url = `${wsBase}/room/${encodeURIComponent(roomId)}/ws`;
      const ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        attemptRef.current = 0;
        console.log(
          `[${new Date().toISOString()}] [sync][web-recv] connected`,
          { roomId, url },
        );
        ws.send(JSON.stringify({ type: 'identify', name: CLIENT_NAME }));
      });

      ws.addEventListener('message', (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          console.warn('[room-ws] unparseable message', ev.data);
          return;
        }

        if (msg.type === 'peers_updated') {
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] peers_updated`,
            msg,
          );
          setPeers(msg.peers);
        } else if (msg.type === 'connected') {
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] connected id=${msg.clientId}`,
          );
        } else if (
          msg.type === 'input_updated' ||
          msg.type === 'input_deleted' ||
          msg.type === 'room_updated'
        ) {
          // Always process — even echoes of our own mutations. The server may have
          // recomputed (corrected) the layout before echoing, and we must accept
          // those corrections rather than staying stuck with the stale optimistic state.
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] ${msg.type}`,
            msg,
          );
          optsRef.current?.onRemoteInputChange?.();
        }
      });

      ws.addEventListener('error', () => {
        console.error(
          `[${new Date().toISOString()}] [sync][web-recv] connection error`,
          { roomId, url },
        );
      });

      ws.addEventListener('close', (ev) => {
        setPeers([]);

        if (destroyed || ev.code === CLOSE_CODE_ROOM_DELETED) {
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] disconnected (permanent)`,
            {
              roomId,
              code: ev.code,
              reason: ev.reason,
            },
          );
          return;
        }

        attemptRef.current += 1;
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** (attemptRef.current - 1),
          RECONNECT_MAX_DELAY_MS,
        );
        console.log(
          `[${new Date().toISOString()}] [sync][web-recv] disconnected, reconnecting`,
          {
            roomId,
            code: ev.code,
            attempt: attemptRef.current,
            delayMs: delay,
          },
        );
        timerRef.current = setTimeout(() => {
          if (!destroyed) connect();
        }, delay);
      });

      return ws;
    }

    const ws = connect();

    return () => {
      destroyed = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      ws.close();
    };
  }, [roomId]);

  return { peers };
}
