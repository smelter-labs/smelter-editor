'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PongGameResetReason,
  PongLobbyState,
  PongNetGameState,
  PongSide,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

export type PongMultiplayerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'in_lobby'
  | 'playing';

export type PongMultiplayerApi = {
  status: PongMultiplayerStatus;
  clientId: string | null;
  lobby: PongLobbyState | null;
  isHost: boolean;
  mySide: PongSide | null;
  /** Read via ref in RAF loops — NOT via React state. */
  remoteGameStateRef: React.RefObject<PongNetGameState | null>;
  /** Read via ref in RAF loops — NOT via React state. */
  remotePaddleYRef: React.RefObject<number | null>;
  disconnectMessage: string | null;
  join: (side: PongSide) => void;
  ready: () => void;
  leave: () => void;
  reset: () => void;
  sendPaddleInput: (y: number) => boolean;
  sendGameState: (state: PongNetGameState) => boolean;
  clearDisconnectMessage: () => void;
};

const CLIENT_NAME = 'Editor';
const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 15_000;

function resetReasonMessage(reason: PongGameResetReason): string | null {
  if (reason === 'host_left') return 'Host disconnected. Game ended.';
  if (reason === 'player_left') return 'Opponent disconnected.';
  return null;
}

export function usePongMultiplayer(roomId: string): PongMultiplayerApi {
  const [status, setStatus] = useState<PongMultiplayerStatus>('disconnected');
  const [clientId, setClientId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<PongLobbyState | null>(null);
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null);

  const remoteGameStateRef = useRef<PongNetGameState | null>(null);
  const remotePaddleYRef = useRef<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const lobbyRef = useRef<PongLobbyState | null>(null);

  const send = useCallback((payload: Record<string, unknown>): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let destroyed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      setStatus('connecting');
      const url = `${toWsUrl(getEffectiveClientServerUrl())}/room/${encodeURIComponent(roomId)}/ws`;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        attempt = 0;
        ws.send(JSON.stringify({ type: 'identify', name: CLIENT_NAME }));
      });

      ws.addEventListener('message', (event) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        const type = (msg as { type?: unknown }).type;
        if (type === 'connected') {
          const id = (msg as { clientId?: unknown }).clientId;
          if (typeof id === 'string') {
            clientIdRef.current = id;
            setClientId(id);
            setStatus('connected');
          }
          return;
        }
        if (type === 'pong_lobby_updated') {
          const nextLobby = (msg as { lobby?: unknown }).lobby;
          if (nextLobby && typeof nextLobby === 'object') {
            const parsed = nextLobby as PongLobbyState;
            lobbyRef.current = parsed;
            setLobby(parsed);
            const me = parsed.players.find((p) => p.clientId === clientIdRef.current);
            if (me) {
              setStatus(parsed.gameStarted ? 'playing' : 'in_lobby');
            } else {
              setStatus((prev) => (prev === 'playing' ? prev : 'connected'));
            }
          }
          return;
        }
        if (type === 'pong_game_started') {
          remoteGameStateRef.current = null;
          remotePaddleYRef.current = null;
          setStatus('playing');
          return;
        }
        if (type === 'pong_paddle_input') {
          const y = (msg as { y?: unknown }).y;
          if (typeof y === 'number' && Number.isFinite(y)) {
            remotePaddleYRef.current = y;
          }
          return;
        }
        if (type === 'pong_game_state') {
          const state = (msg as { state?: unknown }).state;
          if (state && typeof state === 'object') {
            remoteGameStateRef.current = state as PongNetGameState;
          }
          return;
        }
        if (type === 'pong_game_reset') {
          const reason = (msg as { reason?: unknown }).reason;
          if (
            reason === 'manual' ||
            reason === 'player_left' ||
            reason === 'host_left'
          ) {
            setDisconnectMessage(resetReasonMessage(reason));
          }
          remoteGameStateRef.current = null;
          remotePaddleYRef.current = null;
          if (lobbyRef.current?.players.some((p) => p.clientId === clientIdRef.current)) {
            setStatus('in_lobby');
          } else {
            setStatus('connected');
            setLobby(null);
            lobbyRef.current = null;
          }
          return;
        }
        if (type === 'pong_player_disconnected') {
          const wasHost = (msg as { wasHost?: unknown }).wasHost === true;
          setDisconnectMessage(
            wasHost ? 'Host disconnected. Game ended.' : 'Opponent disconnected.',
          );
          return;
        }
      });

      ws.addEventListener('close', () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (destroyed) return;
        setStatus('disconnected');
        attempt += 1;
        const delay = Math.min(
          RECONNECT_MAX_DELAY_MS,
          RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 6),
        );
        reconnectTimer = setTimeout(connect, delay);
      });

      ws.addEventListener('error', () => {});
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId]);

  const join = useCallback(
    (side: PongSide) => {
      if (send({ type: 'pong_join', side })) {
        setDisconnectMessage(null);
      }
    },
    [send],
  );

  const ready = useCallback(() => {
    send({ type: 'pong_ready' });
  }, [send]);

  const leave = useCallback(() => {
    send({ type: 'pong_leave' });
    setLobby(null);
    lobbyRef.current = null;
    remoteGameStateRef.current = null;
    remotePaddleYRef.current = null;
    setStatus('connected');
  }, [send]);

  const reset = useCallback(() => {
    send({ type: 'pong_reset' });
    remoteGameStateRef.current = null;
    remotePaddleYRef.current = null;
  }, [send]);

  const sendPaddleInput = useCallback(
    (y: number) => send({ type: 'pong_paddle_input', y }),
    [send],
  );

  const sendGameState = useCallback(
    (state: PongNetGameState) => send({ type: 'pong_game_state', state }),
    [send],
  );

  const clearDisconnectMessage = useCallback(() => {
    setDisconnectMessage(null);
  }, []);

  const mySide =
    clientId && lobby
      ? (lobby.players.find((p) => p.clientId === clientId)?.side ?? null)
      : null;
  const isHost = Boolean(clientId && lobby?.hostClientId === clientId);

  return {
    status,
    clientId,
    lobby,
    isHost,
    mySide,
    remoteGameStateRef,
    remotePaddleYRef,
    disconnectMessage,
    join,
    ready,
    leave,
    reset,
    sendPaddleInput,
    sendGameState,
    clearDisconnectMessage,
  };
}
