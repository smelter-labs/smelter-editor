'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObErrorEvent,
  ObLogEntry,
  ObLogEvent,
  ObSignalSummary,
  ObSignalsEvent,
  ObState,
  ObStateEvent,
} from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';
import { mergeObLog } from '@/lib/ob-van/log-helpers';

/** Signals arrive at ≤ 4 Hz per room; the UI re-renders them at most this often. */
export const SIGNAL_FLUSH_MS = 200;

export type ObFeedError = { code: string; message: string; at: number };

export type ObFeed = {
  connected: boolean;
  state: ObState | null;
  /** WHY log, newest first. */
  log: ObLogEntry[];
  /** Latest per-camera signal summary, keyed by camera id. */
  signals: Record<string, ObSignalSummary>;
  /** `Date.now() - clockOffsetMs` ≈ the server's clock (countdowns). */
  clockOffsetMs: number;
  lastError: ObFeedError | null;
  roomGone: boolean;
  /** Adopt a state the REST API returned (faster than waiting for the echo). */
  ingestState: (state: ObState) => void;
};

/**
 * Shared state plumbing of the host feed and the operator panel socket:
 * `ob_state` / `ob_log` / `ob_signals` / `ob_error` into React state. Signals
 * are kept in a ref and flushed at most every SIGNAL_FLUSH_MS, so eight
 * cameras at 4 Hz never re-render the desk more than 5 times a second.
 */
export function useObEventState(roomId: string | null) {
  const [state, setState] = useState<ObState | null>(null);
  const [log, setLog] = useState<ObLogEntry[]>([]);
  const [signals, setSignals] = useState<Record<string, ObSignalSummary>>({});
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [lastError, setLastError] = useState<ObFeedError | null>(null);
  const signalsRef = useRef<Record<string, ObSignalSummary>>({});
  const dirtyRef = useRef(false);
  const offsetRef = useRef<number | null>(null);

  useEffect(() => {
    setState(null);
    setLog([]);
    setSignals({});
    signalsRef.current = {};
    offsetRef.current = null;
  }, [roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setSignals(signalsRef.current);
    }, SIGNAL_FLUSH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const ingestState = useCallback((next: ObState) => {
    setState(next);
    if (next.log?.length) setLog((prev) => mergeObLog(prev, next.log));
  }, []);

  /** Returns true when the event was an OB state event it consumed. */
  const handle = useCallback(
    (event: { type?: string }): boolean => {
      switch (event.type) {
        case 'ob_state':
          ingestState((event as ObStateEvent).state);
          return true;
        case 'ob_log': {
          const e = event as ObLogEvent;
          setLog((prev) => mergeObLog(prev, e.entries, e.reset === true));
          return true;
        }
        case 'ob_signals': {
          const e = event as ObSignalsEvent;
          signalsRef.current = e.signals;
          dirtyRef.current = true;
          // Lowest observed (local − server) is the best clock-offset guess:
          // it includes the least network delay.
          const sample = Date.now() - e.atMs;
          if (offsetRef.current == null || sample < offsetRef.current) {
            offsetRef.current = sample;
            setClockOffsetMs(sample);
          }
          return true;
        }
        case 'ob_error': {
          const e = event as ObErrorEvent;
          setLastError({ code: e.code, message: e.message, at: Date.now() });
          return true;
        }
        default:
          return false;
      }
    },
    [ingestState],
  );

  return {
    state,
    log,
    signals,
    clockOffsetMs,
    lastError,
    setLastError,
    ingestState,
    handle,
  };
}

/**
 * Read-only live feed for the /ob-van host: the room WebSocket with the
 * `ob_spectate` handshake (snapshot reply, never a participant). Reconnects
 * with backoff while mounted.
 */
export function useObFeed(roomId: string | null): ObFeed {
  const ev = useObEventState(roomId);
  const [roomGone, setRoomGone] = useState(false);
  useEffect(() => setRoomGone(false), [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'ob_spectate' },
    onEvent: (event) => {
      ev.handle(event);
    },
    onRoomGone: () => setRoomGone(true),
  });

  return {
    connected,
    state: ev.state,
    log: ev.log,
    signals: ev.signals,
    clockOffsetMs: ev.clockOffsetMs,
    lastError: ev.lastError,
    roomGone,
    ingestState: ev.ingestState,
  };
}
