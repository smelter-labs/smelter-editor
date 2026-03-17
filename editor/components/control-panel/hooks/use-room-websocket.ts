'use client';

import { useEffect, useState } from 'react';

// Mirrors server/src/server/roomEventBus.ts - sync manually.
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
  | PeersUpdatedEvent
  | ConnectedEvent;

const WS_BASE = process.env.NEXT_PUBLIC_SMELTER_WS_URL ?? 'ws://localhost:3001';

const CLIENT_NAME = 'Editor';

export function useRoomWebSocket(roomId: string): { peers: ConnectedPeer[] } {
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);

  useEffect(() => {
    const url = `${WS_BASE}/room/${encodeURIComponent(roomId)}/ws`;
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[room-ws] connected', { roomId, url });
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
        setPeers(msg.peers);
      } else if (msg.type === 'connected') {
        console.log('[room-ws] assigned clientId', msg.clientId);
      } else if (msg.type === 'input_updated') {
        console.log('[room-ws] input_updated', msg);
      } else if (msg.type === 'input_deleted') {
        console.log('[room-ws] input_deleted', msg);
      }
    });

    ws.addEventListener('error', () => {
      console.error('[room-ws] connection error', { roomId, url });
    });

    ws.addEventListener('close', (ev) => {
      console.log('[room-ws] disconnected', {
        roomId,
        code: ev.code,
        reason: ev.reason,
      });
      setPeers([]);
    });

    return () => {
      ws.close();
    };
  }, [roomId]);

  return { peers };
}
