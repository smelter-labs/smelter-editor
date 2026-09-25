'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObLogEntry,
  ObOperatorCommand,
  ObOperatorJoinedEvent,
  ObSignalSummary,
  ObState,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  toWsUrl,
} from '@/lib/server-url';
import { useObEventState, type ObFeedError } from '../use-ob-feed';

const RECONNECT_MAX_MS = 8000;

export type ObOperatorSession = { operatorKey?: string; name?: string };

const sessionKey = (roomId: string) => `ob-operator-${roomId}`;

export function readOperatorSession(roomId: string): ObOperatorSession {
  try {
    const raw = window.localStorage.getItem(sessionKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const rec = parsed as Record<string, unknown>;
    return {
      ...(typeof rec.operatorKey === 'string'
        ? { operatorKey: rec.operatorKey }
        : {}),
      ...(typeof rec.name === 'string' ? { name: rec.name } : {}),
    };
  } catch {
    return {};
  }
}

export function writeOperatorSession(
  roomId: string,
  session: ObOperatorSession,
): void {
  try {
    window.localStorage.setItem(sessionKey(roomId), JSON.stringify(session));
  } catch {
    /* storage blocked */
  }
}

export type ObPanelSocket = {
  connected: boolean;
  /** Debug text from the WS layer (`connecting: <url>`, `WS closed …`). */
  wsError: string;
  lastError: ObFeedError | null;
  state: ObState | null;
  /** WHY log, newest first. */
  log: ObLogEntry[];
  signals: Record<string, ObSignalSummary>;
  clockOffsetMs: number;
  /** Take the desk (re-sent on every reconnect with the stored key). */
  join: (name: string) => void;
  /** Hand the desk over: the server frees it and the stored key is dropped. */
  leave: () => void;
  /** One desk command; false when the socket is not open. */
  send: (cmd: ObOperatorCommand) => boolean;
  retry: () => void;
};

/**
 * The operator panel's single WebSocket: the spectator feed (`ob_spectate`
 * snapshot + live `ob_state` / `ob_log` / `ob_signals`) AND the operator seat
 * on the same client id. Reconnects with backoff and re-joins with the
 * stored operator key.
 */
export function useObPanelSocket(roomId: string): ObPanelSocket {
  const ev = useObEventState(roomId);
  const handleObEvent = ev.handle;
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const nameRef = useRef('');
  const keyRef = useRef<string | null>(null);

  const sendJson = useCallback((msg: object): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const handleEvent = useCallback(
    (event: { type?: string }) => {
      if (event.type === 'ob_operator_joined') {
        const e = event as ObOperatorJoinedEvent;
        keyRef.current = e.operatorKey;
        writeOperatorSession(roomId, {
          operatorKey: e.operatorKey,
          name: e.name,
        });
        return;
      }
      handleObEvent(event);
    },
    [roomId, handleObEvent],
  );
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const connectWs = useCallback(() => {
    const base = toWsUrl(
      getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        remoteOrigin() ??
        getEffectiveClientServerUrl(),
    );
    const url = `${base}/room/${encodeURIComponent(roomId)}/ws`;
    setWsError(`connecting: ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setWsError('');
      reconnectDelayRef.current = 1000;
      ws.send(JSON.stringify({ type: 'ob_spectate' }));
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'ob_operator_join',
            name: nameRef.current.trim() || 'Operator',
            ...(keyRef.current ? { operatorKey: keyRef.current } : {}),
          }),
        );
      }
    };
    ws.onerror = () => setWsError(`WS error: ${url}`);
    ws.onclose = (e) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      setWsError(`WS closed (${e.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        if (!closedByUsRef.current && wsRef.current === ws) connectWs();
      }, delay);
    };
    ws.onmessage = (e) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (data && typeof data === 'object' && 'type' in data)
        handleEventRef.current(data as { type?: string });
    };
  }, [roomId]);

  useEffect(() => {
    closedByUsRef.current = false;
    keyRef.current = readOperatorSession(roomId).operatorKey ?? null;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = useCallback(
    (name: string) => {
      nameRef.current = name;
      wantsJoinRef.current = true;
      sendJson({
        type: 'ob_operator_join',
        name,
        ...(keyRef.current ? { operatorKey: keyRef.current } : {}),
      });
    },
    [sendJson],
  );

  const leave = useCallback(() => {
    wantsJoinRef.current = false;
    keyRef.current = null;
    writeOperatorSession(roomId, {});
    sendJson({ type: 'ob_operator_leave' });
  }, [roomId, sendJson]);

  const send = useCallback(
    (cmd: ObOperatorCommand) => sendJson({ type: 'ob_operator_cmd', cmd }),
    [sendJson],
  );

  const retry = useCallback(() => {
    setWsError('');
    closedByUsRef.current = false;
    wsRef.current?.close();
    connectWs();
  }, [connectWs]);

  return {
    connected,
    wsError,
    lastError: ev.lastError,
    state: ev.state,
    log: ev.log,
    signals: ev.signals,
    clockOffsetMs: ev.clockOffsetMs,
    join,
    leave,
    send,
    retry,
  };
}
