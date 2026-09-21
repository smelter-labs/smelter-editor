'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FbAiLogEntry,
  FbCamRole,
  FbDirectorPatch,
  FbDirectorState,
  FbEventChangeEvent,
  FbEventKind,
  FbMatchAction,
  FbMatchEvent,
  FbStateEvent,
  FbTeamId,
  FbViewOverride,
  RoomEvent,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  toWsUrl,
} from '@/lib/server-url';
import { mergeAiLog } from '../ai-log-helpers';

const RECONNECT_MAX_MS = 8000;
const TICKER_LEN = 12;
const AI_LOG_LEN = 60;

type ModeratorSession = { commentatorKey?: string; name?: string };

export type FbPanelError = { code: string; message: string; at: number };
const sessionKey = (roomId: string) => `fb-moderator-${roomId}`;

export function readModeratorSession(roomId: string): ModeratorSession {
  try {
    const raw = window.localStorage.getItem(sessionKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as ModeratorSession)
      : {};
  } catch {
    return {};
  }
}

export function writeModeratorSession(
  roomId: string,
  s: ModeratorSession,
): void {
  try {
    window.localStorage.setItem(sessionKey(roomId), JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

export type FbPanelSocket = {
  connected: boolean;
  wsError: string;
  lastError: FbPanelError | null;
  state: FbStateEvent | null;
  match: FbMatchEvent | null;
  matchReceivedAt: number;
  /** Rolling ledger changes (newest first). */
  events: FbEventChangeEvent[];
  aiLog: FbAiLogEntry[];
  /** Last `fb_director` (1 Hz while on air) and when it arrived. */
  director: FbDirectorState | null;
  directorAt: number;
  join: (name: string) => void;
  sendView: (override: FbViewOverride) => void;
  sendMatch: (action: FbMatchAction, role?: FbCamRole) => void;
  resolveEvent: (
    eventId: string,
    patch: { team?: FbTeamId | null; kind?: FbEventKind; voided?: boolean },
  ) => void;
  addEvent: (team: FbTeamId, kind: FbEventKind) => void;
  undoEvent: (eventId?: string) => void;
  setAiEvents: (enabled: boolean) => void;
  setMinimap: (enabled: boolean) => void;
  setMinimapSize: (size: number) => void;
  /** Live follow tuning (the server clamps and echoes it in `state.config`). */
  tuneDirector: (director: FbDirectorPatch) => void;
  setReplay: (enabled: boolean) => void;
  setTeamColor: (team: FbTeamId, color: string) => void;
  retry: () => void;
};

/**
 * The moderator panel's single WebSocket: spectator feed AND the moderator
 * identity on the same clientId — the server gates the ledger edits, view
 * switches and match actions on the socket that joined as the commentator.
 * Reconnects with backoff and re-joins with the stored key.
 */
export function useFbPanelSocket(roomId: string): FbPanelSocket {
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState('');
  const [lastError, setLastError] = useState<FbPanelError | null>(null);
  const [state, setState] = useState<FbStateEvent | null>(null);
  const [match, setMatch] = useState<FbMatchEvent | null>(null);
  const [matchReceivedAt, setMatchReceivedAt] = useState(0);
  const [events, setEvents] = useState<FbEventChangeEvent[]>([]);
  const [aiLog, setAiLog] = useState<FbAiLogEntry[]>([]);
  const [director, setDirector] = useState<FbDirectorState | null>(null);
  const [directorAt, setDirectorAt] = useState(0);

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
    (event: RoomEvent) => {
      switch (event.type) {
        case 'fb_state':
          setState(event);
          setDirector(event.director);
          break;
        case 'fb_commentator_joined':
          keyRef.current = event.commentatorKey;
          writeModeratorSession(roomId, {
            commentatorKey: event.commentatorKey,
            name: event.name,
          });
          break;
        case 'fb_match':
          setMatch(event);
          setMatchReceivedAt(Date.now());
          break;
        case 'fb_event':
          setEvents((prev) => [event, ...prev].slice(0, TICKER_LEN));
          break;
        case 'fb_ai_log':
          setAiLog((prev) => mergeAiLog(prev, event, AI_LOG_LEN));
          break;
        case 'fb_director':
          setDirector(event.director);
          setDirectorAt(Date.now());
          break;
        case 'fb_error':
          setLastError({
            code: event.code,
            message: event.message,
            at: Date.now(),
          });
          break;
        default:
          break;
      }
    },
    [roomId],
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
      ws.send(JSON.stringify({ type: 'fb_spectate' }));
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'fb_commentator_join',
            name: nameRef.current.trim() || 'Moderator',
            ...(keyRef.current ? { commentatorKey: keyRef.current } : {}),
          }),
        );
      }
    };
    ws.onerror = () => setWsError(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      setWsError(`WS closed (${ev.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        if (!closedByUsRef.current && wsRef.current === ws) connectWs();
      }, delay);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (data && typeof data === 'object' && 'type' in data)
        handleEventRef.current(data as RoomEvent);
    };
  }, [roomId]);

  useEffect(() => {
    closedByUsRef.current = false;
    keyRef.current = readModeratorSession(roomId).commentatorKey ?? null;
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
        type: 'fb_commentator_join',
        name,
        ...(keyRef.current ? { commentatorKey: keyRef.current } : {}),
      });
    },
    [sendJson],
  );

  const sendView = useCallback(
    (override: FbViewOverride) =>
      sendJson({ type: 'fb_commentator_view', override }),
    [sendJson],
  );
  const sendMatch = useCallback(
    (action: FbMatchAction, role?: FbCamRole) =>
      sendJson({
        type: 'fb_commentator_match',
        action,
        ...(role ? { role } : {}),
      }),
    [sendJson],
  );
  const resolveEvent = useCallback(
    (
      eventId: string,
      patch: { team?: FbTeamId | null; kind?: FbEventKind; voided?: boolean },
    ) => sendJson({ type: 'fb_event_resolve', eventId, ...patch }),
    [sendJson],
  );
  const addEvent = useCallback(
    (team: FbTeamId, kind: FbEventKind) =>
      sendJson({ type: 'fb_event_add', team, kind }),
    [sendJson],
  );
  const undoEvent = useCallback(
    (eventId?: string) =>
      sendJson({ type: 'fb_event_undo', ...(eventId ? { eventId } : {}) }),
    [sendJson],
  );
  const setAiEvents = useCallback(
    (enabled: boolean) =>
      sendJson({ type: 'fb_commentator_ai_events', enabled }),
    [sendJson],
  );
  const setMinimap = useCallback(
    (enabled: boolean) => sendJson({ type: 'fb_commentator_minimap', enabled }),
    [sendJson],
  );
  const setMinimapSize = useCallback(
    (size: number) => sendJson({ type: 'fb_commentator_minimap_size', size }),
    [sendJson],
  );
  const tuneDirector = useCallback(
    (director: FbDirectorPatch) =>
      sendJson({ type: 'fb_commentator_director', director }),
    [sendJson],
  );
  const setReplay = useCallback(
    (enabled: boolean) => sendJson({ type: 'fb_commentator_replay', enabled }),
    [sendJson],
  );
  const setTeamColor = useCallback(
    (team: FbTeamId, color: string) =>
      sendJson({ type: 'fb_team_color', team, color }),
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
    lastError,
    state,
    match,
    matchReceivedAt,
    events,
    aiLog,
    director,
    directorAt,
    join,
    sendView,
    sendMatch,
    resolveEvent,
    addEvent,
    undoEvent,
    setAiEvents,
    setMinimap,
    setMinimapSize,
    tuneDirector,
    setReplay,
    setTeamColor,
    retry,
  };
}
