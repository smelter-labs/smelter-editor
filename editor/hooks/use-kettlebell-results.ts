'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  KettlebellExercise,
  KettlebellIssueCode,
} from '@smelter-editor/types';

const FLUSH_INTERVAL_MS = 150;
/** Depth of the rep history — the dot row shows a suffix, the list all of it. */
const RECENT_REPS_MAX = 30;

const EXERCISES: readonly KettlebellExercise[] = [
  'swing',
  'clean',
  'snatch',
  'idle',
];

export type KettlebellRep = {
  index: number;
  verdict: 'correct' | 'incorrect';
  issues: KettlebellIssueCode[];
  exercise: KettlebellExercise;
};

export type KettlebellLive = {
  repCount: number;
  exercise: KettlebellExercise;
  phase: string | null;
  lastRep: KettlebellRep | null;
  /** Ring of the latest completed reps, oldest first. */
  recentReps: KettlebellRep[];
};

const INITIAL: KettlebellLive = {
  repCount: 0,
  exercise: 'idle',
  phase: null,
  lastRep: null,
  recentReps: [],
};

/** The slice of the worker's result payload the live panel consumes. */
type ResultData = {
  repCount?: number;
  exercise?: KettlebellExercise;
  phase?: string | null;
  lastRep?: KettlebellRep | null;
  events?: ({ type?: string } & Partial<KettlebellRep>)[];
};

/**
 * Live kettlebell-coach feedback for one input, via the generic per-model
 * results SSE proxy. The stream carries results for ALL inputs running the
 * model (the server listener is per-modelId), so events are filtered by
 * inputId here. State flushes are throttled — results arrive ~6/s.
 */
export function useKettlebellResults(
  roomId: string,
  inputId: string,
): KettlebellLive {
  const [live, setLive] = useState<KettlebellLive>(INITIAL);
  const pendingRef = useRef<KettlebellLive | null>(null);
  const recentRef = useRef<KettlebellRep[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLive(INITIAL);
    recentRef.current = [];

    const flush = () => {
      const next = pendingRef.current;
      pendingRef.current = null;
      flushTimerRef.current = null;
      if (next) setLive(next);
    };

    const url = `/api/room/${encodeURIComponent(roomId)}/ai-models/kettlebell-coach/results/sse`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          inputId?: string;
          data?: ResultData;
        };
        if (msg.inputId !== inputId || !msg.data) return;
        const data = msg.data;

        for (const e of data.events ?? []) {
          if (e.type !== 'rep_completed' || typeof e.index !== 'number') {
            continue;
          }
          recentRef.current = [
            ...recentRef.current.slice(-(RECENT_REPS_MAX - 1)),
            {
              index: e.index,
              verdict: e.verdict === 'incorrect' ? 'incorrect' : 'correct',
              issues: Array.isArray(e.issues) ? e.issues : [],
              exercise:
                e.exercise && EXERCISES.includes(e.exercise)
                  ? e.exercise
                  : 'swing',
            },
          ];
        }

        pendingRef.current = {
          repCount: typeof data.repCount === 'number' ? data.repCount : 0,
          exercise: data.exercise ?? 'idle',
          phase: data.phase ?? null,
          lastRep: data.lastRep ?? null,
          recentReps: recentRef.current,
        };
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on error
    };

    return () => {
      es.close();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingRef.current = null;
    };
  }, [roomId, inputId]);

  return live;
}
