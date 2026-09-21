'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KbtCamOfferEvent,
  KbtCommentatorOverlay,
  KbtHypeBannerId,
  KbtMatchAction,
  KbtMatchEvent,
  KbtRepEvent,
  KbtSkeletonMode,
  KbtStateEvent,
  KbtViewOverride,
  KbtViewTransitionStyle,
  RoomEvent,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  toWsUrl,
} from '@/lib/server-url';
import {
  readCommentatorSession,
  writeCommentatorSession,
} from '../phone/commentator-session';

const RECONNECT_MAX_MS = 8000;
// How long a refused action stays on screen (same as the host arcade).
const ERROR_SHOW_MS = 4000;
const TICKER_LEN = 6;
// Rep-apex stills gallery (only reps that carried a screenshotUrl).
const SHOTS_LEN = 12;

export type PanelSocket = {
  connected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
  /** The server's latest refusal (kbt_error), or an action that could not
   * leave a closed socket — display-ready, self-clearing. Without it a
   * refused press looks exactly like a dead button. */
  lastError: string | null;
  state: KbtStateEvent | null;
  match: KbtMatchEvent | null;
  /** Rolling play-by-play (newest first). */
  recentReps: KbtRepEvent[];
  /** Rolling rep-apex stills (newest first; only when screenshots are on). */
  recentShots: KbtRepEvent[];
  /** Join (or re-join) as the commentator; re-sent on every reconnect. */
  join: (name: string) => void;
  /** Ask for a WHIP cam slot (dims from the rig); re-armed on reconnect. */
  requestCam: () => void;
  sendView: (override: KbtViewOverride) => void;
  sendMatch: (action: KbtMatchAction, heatIndex?: number) => void;
  /** Set/replace/clear the on-air overlay (rep cam / spotlight / h2h). */
  sendOverlay: (overlay: KbtCommentatorOverlay) => void;
  /** Fire a one-shot predefined hype banner. */
  sendBanner: (bannerId: KbtHypeBannerId) => void;
  /** Live-switch the skeleton overlay on heat tiles. */
  sendSkeleton: (mode: KbtSkeletonMode) => void;
  /** Live-switch the floating rep text on the output. */
  sendRepFloat: (enabled: boolean) => void;
  /** Toggle the caster-cam PiP tile on the output. */
  sendCasterPip: (enabled: boolean) => void;
  /** Pick how view switches animate on the output (fade / dissolve). */
  sendTransitionStyle: (style: KbtViewTransitionStyle) => void;
  retry: () => void;
};

/**
 * The commentator panel's single WebSocket: spectator feed (state / match /
 * reps) AND the commentator identity on the same clientId — the server gates
 * kbt_commentator_view / kbt_commentator_match on the socket that joined, so
 * the feed cannot live on a separate connection (useKbtFeed would mint its
 * own clientId). Reconnects with backoff; a reconnect minted a fresh
 * clientId, so it re-joins by name (the slot adopts us back) and re-arms the
 * camera with a fresh input.
 */
export function usePanelSocket(
  roomId: string,
  opts: {
    getCamDims: () => { width: number; height: number } | null;
    hasStream: () => boolean;
    onCamOffer: (ev: KbtCamOfferEvent) => void;
  },
): PanelSocket {
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const lastErrorTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<KbtStateEvent | null>(null);
  const [match, setMatch] = useState<KbtMatchEvent | null>(null);
  const [recentReps, setRecentReps] = useState<KbtRepEvent[]>([]);
  const [recentShots, setRecentShots] = useState<KbtRepEvent[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const nameRef = useRef('');
  // Resume token shared with the phone page: joining with it adopts the
  // commentator slot even when the server still sees the old socket as
  // connected (name-only matching would replace the slot and retire a live
  // camera input).
  const playerKeyRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const showError = useCallback((message: string) => {
    setLastError(message);
    if (lastErrorTimerRef.current != null) {
      window.clearTimeout(lastErrorTimerRef.current);
    }
    lastErrorTimerRef.current = window.setTimeout(
      () => setLastError(null),
      ERROR_SHOW_MS,
    );
  }, []);

  const sendJson = useCallback((msg: object): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  /** An operator press: say so when it could not even leave the panel. */
  const sendAction = useCallback(
    (msg: object) => {
      if (!sendJson(msg)) showError('NOT CONNECTED — action not sent');
    },
    [sendJson, showError],
  );

  const sendCamRequest = useCallback(() => {
    const dims = optsRef.current.getCamDims();
    sendJson({
      type: 'kbt_commentator_cam_request',
      ...(dims ? { nativeWidth: dims.width, nativeHeight: dims.height } : {}),
    });
  }, [sendJson]);

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'kbt_state':
          setState(event);
          break;
        case 'kbt_joined':
          if (event.role === 'commentator') {
            playerKeyRef.current = event.playerKey;
            writeCommentatorSession(roomId, {
              playerKey: event.playerKey,
              name: event.name,
            });
          }
          break;
        case 'kbt_match':
          setMatch(event);
          break;
        case 'kbt_rep':
          setRecentReps((prev) => [event, ...prev].slice(0, TICKER_LEN));
          if (event.screenshotUrl) {
            setRecentShots((prev) => [event, ...prev].slice(0, SHOTS_LEN));
          }
          break;
        case 'kbt_cam_offer':
          if (wantsCamRef.current) optsRef.current.onCamOffer(event);
          break;
        case 'kbt_error':
          showError(event.message);
          break;
        default:
          break;
      }
    },
    [roomId, showError],
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
      ws.send(JSON.stringify({ type: 'kbt_spectate' }));
      if (wantsJoinRef.current) {
        ws.send(
          JSON.stringify({
            type: 'kbt_commentator_join',
            name: nameRef.current.trim() || 'Commentator',
            ...(playerKeyRef.current
              ? { playerKey: playerKeyRef.current }
              : {}),
          }),
        );
        if (wantsCamRef.current && optsRef.current.hasStream()) {
          sendCamRequest();
        }
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
    // Re-arm after a StrictMode unmount/remount — the cleanup below set the
    // flag, and without the reset auto-reconnect would stay off for good.
    closedByUsRef.current = false;
    playerKeyRef.current = readCommentatorSession(roomId).playerKey ?? null;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      if (lastErrorTimerRef.current != null) {
        window.clearTimeout(lastErrorTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = useCallback(
    (name: string) => {
      nameRef.current = name;
      wantsJoinRef.current = true;
      sendJson({
        type: 'kbt_commentator_join',
        name,
        ...(playerKeyRef.current ? { playerKey: playerKeyRef.current } : {}),
      });
    },
    [sendJson],
  );

  const requestCam = useCallback(() => {
    wantsCamRef.current = true;
    sendCamRequest();
  }, [sendCamRequest]);

  const sendView = useCallback(
    (override: KbtViewOverride) => {
      sendAction({ type: 'kbt_commentator_view', override });
    },
    [sendAction],
  );

  const sendMatch = useCallback(
    (action: KbtMatchAction, heatIndex?: number) => {
      sendAction({
        type: 'kbt_commentator_match',
        action,
        ...(heatIndex != null ? { heatIndex } : {}),
      });
    },
    [sendAction],
  );

  const sendOverlay = useCallback(
    (overlay: KbtCommentatorOverlay) => {
      sendAction({ type: 'kbt_commentator_overlay', overlay });
    },
    [sendAction],
  );

  const sendBanner = useCallback(
    (bannerId: KbtHypeBannerId) => {
      sendAction({ type: 'kbt_commentator_banner', bannerId });
    },
    [sendAction],
  );

  const sendSkeleton = useCallback(
    (mode: KbtSkeletonMode) => {
      sendAction({ type: 'kbt_commentator_skeleton', mode });
    },
    [sendAction],
  );

  const sendRepFloat = useCallback(
    (enabled: boolean) => {
      sendAction({ type: 'kbt_commentator_rep_float', enabled });
    },
    [sendAction],
  );

  const sendCasterPip = useCallback(
    (enabled: boolean) => {
      sendAction({ type: 'kbt_commentator_caster_pip', enabled });
    },
    [sendAction],
  );

  const sendTransitionStyle = useCallback(
    (style: KbtViewTransitionStyle) => {
      sendAction({ type: 'kbt_commentator_transition_style', style });
    },
    [sendAction],
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
    recentReps,
    recentShots,
    join,
    requestCam,
    sendView,
    sendMatch,
    sendOverlay,
    sendBanner,
    sendSkeleton,
    sendRepFloat,
    sendCasterPip,
    sendTransitionStyle,
    retry,
  };
}
