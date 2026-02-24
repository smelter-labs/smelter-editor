'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  hideInput,
  showInput,
  updateRoom,
  type Input,
} from '@/app/actions/actions';
import type { TimelineState } from './use-timeline-state';

// ── Types ────────────────────────────────────────────────

type DesiredState = Map<string, boolean>; // inputId → should be visible

type PlaybackEvent = {
  timeMs: number;
  type: 'connect' | 'disconnect' | 'order';
  inputId?: string;
  inputOrder?: string[];
};

// ── Helpers ──────────────────────────────────────────────

/** For a given time, determine which inputs should be connected based on their segments. */
export function computeDesiredState(state: TimelineState): DesiredState {
  const desired = new Map<string, boolean>();
  const t = state.playheadMs;
  for (const [inputId, track] of Object.entries(state.tracks)) {
    const isActive = track.segments.some(
      (seg) => t >= seg.startMs && t < seg.endMs,
    );
    desired.set(inputId, isActive);
  }
  return desired;
}

/** Find the order keyframe active at a given time. */
export function getActiveOrder(state: TimelineState): string[] | null {
  const sorted = [...state.orderKeyframes].sort((a, b) => a.timeMs - b.timeMs);
  let active: string[] | null = null;
  for (const kf of sorted) {
    if (kf.timeMs <= state.playheadMs) {
      active = kf.inputOrder;
    } else {
      break;
    }
  }
  return active;
}

/** Compile a sorted list of playback events from timeline state, starting after `fromMs`. */
function compileEvents(state: TimelineState, fromMs: number): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];

  for (const [inputId, track] of Object.entries(state.tracks)) {
    for (const seg of track.segments) {
      if (seg.startMs > fromMs) {
        events.push({ timeMs: seg.startMs, type: 'connect', inputId });
      }
      if (seg.endMs > fromMs) {
        events.push({ timeMs: seg.endMs, type: 'disconnect', inputId });
      }
    }
  }

  for (const kf of state.orderKeyframes) {
    if (kf.timeMs > fromMs) {
      events.push({
        timeMs: kf.timeMs,
        type: 'order',
        inputOrder: kf.inputOrder,
      });
    }
  }

  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

// ── Hook ─────────────────────────────────────────────────

export function useTimelinePlayback(
  roomId: string,
  inputs: Input[],
  state: TimelineState,
  setPlayhead: (ms: number) => void,
  setPlaying: (playing: boolean) => void,
  refreshState: () => Promise<void>,
  structureRevision: number,
) {
  const appliedStateRef = useRef<DesiredState>(new Map());
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallMs: number; playheadMs: number } | null>(
    null,
  );
  const prePlayStateRef = useRef<{
    hiddenInputIds: Set<string>;
    inputOrder: string[];
  } | null>(null);

  const eventsRef = useRef<PlaybackEvent[]>([]);
  const nextEventIndexRef = useRef(0);
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
    };
  }, []);

  /** Apply visibility for a desired state map — only sends commands for changed inputs. */
  const applyDesiredState = useCallback(
    async (desired: DesiredState) => {
      const promises: Promise<void>[] = [];

      for (const [inputId, shouldBeVisible] of desired) {
        const wasVisible = appliedStateRef.current.get(inputId);
        if (wasVisible === shouldBeVisible) continue;

        const input = inputsRef.current.find((i) => i.inputId === inputId);
        if (!input) continue;

        const isCurrentlyVisible =
          (input.status === 'connected' || input.status === 'pending') &&
          !input.hidden;

        if (shouldBeVisible && !isCurrentlyVisible) {
          promises.push(
            showInput(roomId, inputId).catch((err) =>
              console.warn(`Timeline: failed to show ${inputId}`, err),
            ),
          );
        } else if (!shouldBeVisible && isCurrentlyVisible) {
          promises.push(
            hideInput(roomId, inputId).catch((err) =>
              console.warn(`Timeline: failed to hide ${inputId}`, err),
            ),
          );
        }

        appliedStateRef.current.set(inputId, shouldBeVisible);
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
        await refreshState();
      }
    },
    [roomId, refreshState],
  );

  /** Snapshot current server state before playing. */
  const snapshotPrePlayState = useCallback(() => {
    const hiddenInputIds = new Set<string>();
    const inputOrder: string[] = [];
    for (const input of inputs) {
      inputOrder.push(input.inputId);
      if (input.hidden) {
        hiddenInputIds.add(input.inputId);
      }
    }
    prePlayStateRef.current = { hiddenInputIds, inputOrder };
    appliedStateRef.current = new Map(
      inputs.map((i) => [i.inputId, !i.hidden]),
    );
  }, [inputs]);

  /** Restore server state to pre-play snapshot. */
  const restorePrePlayState = useCallback(async () => {
    const snapshot = prePlayStateRef.current;
    if (!snapshot) return;

    const promises: Promise<unknown>[] = [];
    for (const input of inputs) {
      const shouldBeHidden = snapshot.hiddenInputIds.has(input.inputId);
      if (shouldBeHidden && !input.hidden) {
        promises.push(hideInput(roomId, input.inputId).catch(() => {}));
      } else if (!shouldBeHidden && input.hidden) {
        promises.push(showInput(roomId, input.inputId).catch(() => {}));
      }
    }

    if (snapshot.inputOrder.length > 0) {
      promises.push(
        updateRoom(roomId, { inputOrder: snapshot.inputOrder }).catch(() => {}),
      );
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
      await refreshState();
    }

    prePlayStateRef.current = null;
    appliedStateRef.current = new Map();
  }, [inputs, roomId, refreshState]);

  /** Stop playback and restore pre-play state. */
  const stop = useCallback(async () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (eventTimerRef.current) {
      clearTimeout(eventTimerRef.current);
      eventTimerRef.current = null;
    }
    playStartRef.current = null;
    eventsRef.current = [];
    nextEventIndexRef.current = 0;
    setPlaying(false);

    await restorePrePlayState();
  }, [setPlaying, restorePrePlayState]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Schedule the next event from the compiled list using setTimeout. */
  const scheduleNextEvent = useCallback(() => {
    const events = eventsRef.current;
    const idx = nextEventIndexRef.current;
    if (idx >= events.length) return;
    if (!playStartRef.current) return;

    const event = events[idx];
    const { wallMs, playheadMs } = playStartRef.current;
    const delayMs = event.timeMs - playheadMs - (performance.now() - wallMs);

    const fire = () => {
      eventTimerRef.current = null;
      nextEventIndexRef.current = idx + 1;

      if (event.type === 'connect' && event.inputId) {
        appliedStateRef.current.set(event.inputId, true);
        showInput(roomId, event.inputId).catch((err) =>
          console.warn(`Timeline: failed to show ${event.inputId}`, err),
        );
      } else if (event.type === 'disconnect' && event.inputId) {
        appliedStateRef.current.set(event.inputId, false);
        hideInput(roomId, event.inputId).catch((err) =>
          console.warn(`Timeline: failed to hide ${event.inputId}`, err),
        );
      } else if (event.type === 'order' && event.inputOrder) {
        updateRoom(roomId, { inputOrder: event.inputOrder }).catch((err) =>
          console.warn('Timeline: failed to apply order', err),
        );
      }

      scheduleNextEvent();
    };

    eventTimerRef.current = setTimeout(fire, Math.max(0, delayMs));
  }, [roomId]);

  /** Start playback — animate playhead and fire events at segment edges. */
  const play = useCallback(() => {
    if (state.isPlaying) return;

    snapshotPrePlayState();
    setPlaying(true);

    playStartRef.current = {
      wallMs: performance.now(),
      playheadMs: state.playheadMs,
    };

    // Compile events and schedule
    eventsRef.current = compileEvents(state, state.playheadMs);
    nextEventIndexRef.current = 0;

    // Apply initial state immediately at current playhead
    const desired = computeDesiredState(state);
    void applyDesiredState(desired);

    const order = getActiveOrder(state);
    if (order && order.length > 0) {
      updateRoom(roomId, { inputOrder: order }).catch((err) =>
        console.warn('Timeline: failed to apply initial order', err),
      );
    }

    // Start rAF loop for playhead animation
    const tick = () => {
      if (!playStartRef.current) return;
      const elapsed = performance.now() - playStartRef.current.wallMs;
      const newPlayheadMs = playStartRef.current.playheadMs + elapsed;

      if (newPlayheadMs >= state.totalDurationMs) {
        setPlayhead(state.totalDurationMs);
        void stopRef.current();
        return;
      }

      setPlayhead(Math.round(newPlayheadMs));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Schedule first event
    scheduleNextEvent();
  }, [
    state,
    snapshotPrePlayState,
    setPlaying,
    setPlayhead,
    applyDesiredState,
    roomId,
    scheduleNextEvent,
  ]);

  /** Apply state at current playhead without starting playback. */
  const applyAtPlayhead = useCallback(async () => {
    appliedStateRef.current = new Map(
      inputs.map((i) => [i.inputId, !i.hidden]),
    );
    const desired = computeDesiredState(state);
    await applyDesiredState(desired);

    const order = getActiveOrder(state);
    if (order && order.length > 0) {
      try {
        await updateRoom(roomId, { inputOrder: order });
      } catch (err) {
        console.warn('Timeline: failed to apply order', err);
      }
    }
  }, [inputs, state, roomId, applyDesiredState]);

  // Recompute events when the timeline structure changes during playback
  useEffect(() => {
    if (!state.isPlaying) return;
    if (!playStartRef.current) return;

    eventsRef.current = compileEvents(state, state.playheadMs);
    nextEventIndexRef.current = 0;

    if (eventTimerRef.current) {
      clearTimeout(eventTimerRef.current);
      eventTimerRef.current = null;
    }

    scheduleNextEvent();
  }, [structureRevision, state, scheduleNextEvent]);

  return {
    play,
    stop,
    applyAtPlayhead,
  };
}
