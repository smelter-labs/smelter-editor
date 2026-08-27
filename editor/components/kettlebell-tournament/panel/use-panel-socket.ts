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
  RoomEvent,
} from '@smelter-editor/types';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';
import {
  readCommentatorSession,
  writeCommentatorSession,
} from '../phone/commentator-session';

const RECONNECT_MAX_MS = 8000;
const TICKER_LEN = 6;
// Rep-apex stills gallery (only reps that carried a screenshotUrl).
const SHOTS_LEN = 12;

function remoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const o = window.location.origin;
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(o) ? null : o;
}

export type PanelSocket = {
  connected: boolean;
  /** Debug text from the WS layer, shown verbatim on failure. */
  wsError: string;
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

  const sendJson = useCallback((msg: object): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

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
      sendJson({ type: 'kbt_commentator_view', override });
    },
    [sendJson],
  );

  const sendMatch = useCallback(
    (action: KbtMatchAction, heatIndex?: number) => {
      sendJson({
        type: 'kbt_commentator_match',
        action,
        ...(heatIndex != null ? { heatIndex } : {}),
      });
    },
    [sendJson],
  );

  const sendOverlay = useCallback(
    (overlay: KbtCommentatorOverlay) => {
      sendJson({ type: 'kbt_commentator_overlay', overlay });
    },
    [sendJson],
  );

  const sendBanner = useCallback(
    (bannerId: KbtHypeBannerId) => {
      sendJson({ type: 'kbt_commentator_banner', bannerId });
    },
    [sendJson],
  );

  const sendSkeleton = useCallback(
    (mode: KbtSkeletonMode) => {
      sendJson({ type: 'kbt_commentator_skeleton', mode });
    },
    [sendJson],
  );

  const sendRepFloat = useCallback(
    (enabled: boolean) => {
      sendJson({ type: 'kbt_commentator_rep_float', enabled });
    },
    [sendJson],
  );

  const sendCasterPip = useCallback(
    (enabled: boolean) => {
      sendJson({ type: 'kbt_commentator_caster_pip', enabled });
    },
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
    retry,
  };
}
