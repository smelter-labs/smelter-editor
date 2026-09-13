'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BbAiLogEntry,
  BbBallEvent,
  BbCamOfferEvent,
  BbCamRole,
  BbMatchAction,
  BbMatchEvent,
  BbShotChangeEvent,
  BbStateEvent,
  BbPipFxMode,
  BbTeamId,
  BbViewOverride,
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
/** AI log rows kept client-side (the server snapshot is capped the same). */
const AI_LOG_LEN = 60;

type ModeratorSession = { commentatorKey?: string; name?: string };

export type BbPanelError = { code: string; message: string; at: number };
const sessionKey = (roomId: string) => `bb-moderator-${roomId}`;

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

export type BbPanelSocket = {
  connected: boolean;
  wsError: string;
  /** Last `bb_error` the server sent this socket (null until one arrives). */
  lastError: BbPanelError | null;
  state: BbStateEvent | null;
  match: BbMatchEvent | null;
  matchReceivedAt: number;
  /** Rolling ledger changes (newest first). */
  shots: BbShotChangeEvent[];
  /** The scorer AI's event log (newest first, capped). */
  aiLog: BbAiLogEntry[];
  /** Last `bb_ball` (AI liveness) and when it arrived (Date.now()). */
  ball: BbBallEvent | null;
  ballAt: number;
  /** Join (or re-join) as the moderator; re-sent on every reconnect. */
  join: (name: string) => void;
  /** Ask for a WHIP cam slot (dims from the rig); re-armed on reconnect. */
  requestCam: () => void;
  sendView: (override: BbViewOverride) => void;
  sendMatch: (action: BbMatchAction, role?: BbCamRole) => void;
  resolveShot: (
    shotId: string,
    patch: { team?: BbTeamId | null; points?: 1 | 2; voided?: boolean },
  ) => void;
  addShot: (team: BbTeamId, points: 1 | 2) => void;
  undoShot: (shotId?: string) => void;
  setCasterPip: (enabled: boolean) => void;
  /** Burn the scorer AI's debug overlay into the program (moderator). */
  setAiOverlay: (enabled: boolean) => void;
  /** Ultra AI: score from the clip's annotated plays instead of the model. */
  setUltraAi: (enabled: boolean) => void;
  setPipFx: (mode: BbPipFxMode, color: string) => void;
  setTeamColor: (team: BbTeamId, color: string) => void;
  retry: () => void;
};

/**
 * The moderator panel's single WebSocket: spectator feed AND the moderator
 * identity on the same clientId — the server gates the ledger edits, view
 * switches and match actions on the socket that joined as the commentator/
 * moderator. Reconnects with backoff; a reconnect minted a fresh clientId,
 * so it re-joins with the stored key (the slot adopts us back).
 */
export function useBbPanelSocket(
  roomId: string,
  opts: {
    getCamDims: () => { width: number; height: number } | null;
    hasStream: () => boolean;
    onCamOffer: (ev: BbCamOfferEvent) => void;
  },
): BbPanelSocket {
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState('');
  const [lastError, setLastError] = useState<BbPanelError | null>(null);
  const [state, setState] = useState<BbStateEvent | null>(null);
  const [match, setMatch] = useState<BbMatchEvent | null>(null);
  const [matchReceivedAt, setMatchReceivedAt] = useState(0);
  const [shots, setShots] = useState<BbShotChangeEvent[]>([]);
  const [aiLog, setAiLog] = useState<BbAiLogEntry[]>([]);
  const [ball, setBall] = useState<BbBallEvent | null>(null);
  const [ballAt, setBallAt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const nameRef = useRef('');
  const keyRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const sendJson = useCallback((msg: object): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const sendCamRequest = useCallback(() => {
    const dims = optsRef.current.getCamDims();
    sendJson({
      type: 'bb_commentator_cam_request',
      ...(dims ? { nativeWidth: dims.width, nativeHeight: dims.height } : {}),
    });
  }, [sendJson]);

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'bb_state':
          setState(event);
          break;
        case 'bb_commentator_joined':
          keyRef.current = event.commentatorKey;
          writeModeratorSession(roomId, {
            commentatorKey: event.commentatorKey,
            name: event.name,
          });
          break;
        case 'bb_match':
          setMatch(event);
          setMatchReceivedAt(Date.now());
          break;
        case 'bb_shot':
          setShots((prev) => [event, ...prev].slice(0, TICKER_LEN));
          break;
        case 'bb_ai_log':
          setAiLog((prev) => mergeAiLog(prev, event, AI_LOG_LEN));
          break;
        case 'bb_ball':
          setBall(event);
          setBallAt(Date.now());
          break;
        case 'bb_error':
          // Server-side refusals (add points in the lobby, a second panel
          // tab that is not the moderator, …) — surfaced, not swallowed.
          setLastError({
            code: event.code,
            message: event.message,
            at: Date.now(),
          });
          break;
        case 'bb_cam_offer':
          if (event.role === 'commentator' && wantsCamRef.current) {
            optsRef.current.onCamOffer(event);
          }
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
      ws.send(JSON.stringify({ type: 'bb_spectate' }));
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'bb_commentator_join',
            name: nameRef.current.trim() || 'Moderator',
            ...(keyRef.current ? { commentatorKey: keyRef.current } : {}),
          }),
        );
        if (wantsCamRef.current && optsRef.current.hasStream())
          sendCamRequest();
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
      if (data && typeof data === 'object' && 'type' in data) {
        handleEventRef.current(data as RoomEvent);
      }
    };
  }, [roomId, sendCamRequest]);

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
        type: 'bb_commentator_join',
        name,
        ...(keyRef.current ? { commentatorKey: keyRef.current } : {}),
      });
    },
    [sendJson],
  );

  const requestCam = useCallback(() => {
    wantsCamRef.current = true;
    sendCamRequest();
  }, [sendCamRequest]);

  const sendView = useCallback(
    (override: BbViewOverride) =>
      sendJson({ type: 'bb_commentator_view', override }),
    [sendJson],
  );
  const sendMatch = useCallback(
    (action: BbMatchAction, role?: BbCamRole) =>
      sendJson({
        type: 'bb_commentator_match',
        action,
        ...(role ? { role } : {}),
      }),
    [sendJson],
  );
  const resolveShot = useCallback(
    (
      shotId: string,
      patch: { team?: BbTeamId | null; points?: 1 | 2; voided?: boolean },
    ) => sendJson({ type: 'bb_shot_resolve', shotId, ...patch }),
    [sendJson],
  );
  const addShot = useCallback(
    (team: BbTeamId, points: 1 | 2) =>
      sendJson({ type: 'bb_shot_add', team, points }),
    [sendJson],
  );
  const undoShot = useCallback(
    (shotId?: string) =>
      sendJson({ type: 'bb_shot_undo', ...(shotId ? { shotId } : {}) }),
    [sendJson],
  );
  const setCasterPip = useCallback(
    (enabled: boolean) =>
      sendJson({ type: 'bb_commentator_caster_pip', enabled }),
    [sendJson],
  );
  const setAiOverlay = useCallback(
    (enabled: boolean) =>
      sendJson({ type: 'bb_commentator_ai_overlay', enabled }),
    [sendJson],
  );
  const setUltraAi = useCallback(
    (enabled: boolean) =>
      sendJson({ type: 'bb_commentator_ultra_ai', enabled }),
    [sendJson],
  );
  const setPipFx = useCallback(
    (mode: BbPipFxMode, color: string) =>
      sendJson({ type: 'bb_commentator_pip_fx', mode, color }),
    [sendJson],
  );
  const setTeamColor = useCallback(
    (team: BbTeamId, color: string) =>
      sendJson({ type: 'bb_team_color', team, color }),
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
    shots,
    aiLog,
    ball,
    ballAt,
    join,
    requestCam,
    sendView,
    sendMatch,
    resolveShot,
    addShot,
    undoShot,
    setCasterPip,
    setAiOverlay,
    setUltraAi,
    setPipFx,
    setTeamColor,
    retry,
  };
}
