'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  hideInput,
  showInput,
  updateInput,
  updateRoom,
  type Input,
} from '@/app/actions/actions';
import type { TimelineState } from './use-timeline-state';

// ── Types ────────────────────────────────────────────────

type DesiredState = Map<string, boolean>; // inputId → should be visible

type PlaybackEvent = {
  timeMs: number;
  type: 'connect' | 'disconnect';
  inputId: string;
};

// ── Helpers ──────────────────────────────────────────────

/** For a given time, determine which inputs should be connected based on active clips. */
export function computeDesiredState(state: TimelineState): DesiredState {
  const desired = new Map<string, boolean>();
  const t = state.playheadMs;

  // First pass: set all known inputIds to false
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (!desired.has(clip.inputId)) {
        desired.set(clip.inputId, false);
      }
    }
  }

  // Second pass: if any clip is active, set its inputId to true
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (t >= clip.startMs && t < clip.endMs) {
        desired.set(clip.inputId, true);
      }
    }
  }

  return desired;
}

/**
 * Compute the input order at the current playhead based on track order.
 * Returns inputIds ordered by their track position (top track = first),
 * only for inputs that have an active clip at the playhead.
 */
export function getActiveOrder(state: TimelineState): string[] {
  const t = state.playheadMs;
  const order: string[] = [];
  const seen = new Set<string>();

  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (t >= clip.startMs && t < clip.endMs && !seen.has(clip.inputId)) {
        order.push(clip.inputId);
        seen.add(clip.inputId);
      }
    }
  }

  return order;
}

/** Compile a sorted list of playback events from timeline state, starting after `fromMs`. */
function compileEvents(state: TimelineState, fromMs: number): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];

  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.startMs > fromMs) {
        events.push({
          timeMs: clip.startMs,
          type: 'connect',
          inputId: clip.inputId,
        });
      }
      if (clip.endMs > fromMs) {
        events.push({
          timeMs: clip.endMs,
          type: 'disconnect',
          inputId: clip.inputId,
        });
      }
    }
  }

  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

function getActiveClipsByInputAt(
  state: TimelineState,
  timeMs: number,
): Map<string, import('./use-timeline-state').Clip> {
  const active = new Map<string, import('./use-timeline-state').Clip>();
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (
        timeMs >= clip.startMs &&
        timeMs < clip.endMs &&
        !active.has(clip.inputId)
      ) {
        active.set(clip.inputId, clip);
      }
    }
  }
  return active;
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
  const appliedBlockSettingsRef = useRef<Map<string, string>>(new Map());

  const inputsRef = useRef(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const applyBlockSettingsAtTime = useCallback(
    async (timeMs: number) => {
      const active = getActiveClipsByInputAt(stateRef.current, timeMs);
      const updates: Promise<unknown>[] = [];
      for (const [inputId, clip] of active.entries()) {
        const serialized = JSON.stringify(clip.blockSettings);
        if (appliedBlockSettingsRef.current.get(inputId) === serialized)
          continue;
        appliedBlockSettingsRef.current.set(inputId, serialized);
        updates.push(
          updateInput(roomId, inputId, {
            volume: clip.blockSettings.volume,
            shaders: clip.blockSettings.shaders,
            showTitle: clip.blockSettings.showTitle,
            orientation: clip.blockSettings.orientation,
            text: clip.blockSettings.text,
            textAlign: clip.blockSettings.textAlign,
            textColor: clip.blockSettings.textColor,
            textMaxLines: clip.blockSettings.textMaxLines,
            textScrollSpeed: clip.blockSettings.textScrollSpeed,
            textScrollLoop: clip.blockSettings.textScrollLoop,
            textFontSize: clip.blockSettings.textFontSize,
            borderColor: clip.blockSettings.borderColor,
            borderWidth: clip.blockSettings.borderWidth,
            attachedInputIds: clip.blockSettings.attachedInputIds,
            snake1Shaders: clip.blockSettings.snake1Shaders,
            snake2Shaders: clip.blockSettings.snake2Shaders,
          }).catch((err) =>
            console.warn(
              `Timeline: failed to apply block settings for ${inputId}`,
              err,
            ),
          ),
        );
      }
      if (updates.length > 0) {
        await Promise.allSettled(updates);
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
    appliedBlockSettingsRef.current = new Map();
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
        // Check if the same input has another active clip at this time
        const stillActive = stateRef.current.tracks.some((track) =>
          track.clips.some(
            (clip) =>
              clip.inputId === event.inputId &&
              event.timeMs >= clip.startMs &&
              event.timeMs < clip.endMs,
          ),
        );
        if (!stillActive) {
          appliedStateRef.current.set(event.inputId, false);
          hideInput(roomId, event.inputId).catch((err) =>
            console.warn(`Timeline: failed to hide ${event.inputId}`, err),
          );
        }
      }

      void applyBlockSettingsAtTime(event.timeMs);

      scheduleNextEvent();
    };

    eventTimerRef.current = setTimeout(fire, Math.max(0, delayMs));
  }, [roomId, applyBlockSettingsAtTime]);

  /** Start playback — animate playhead and fire events at clip edges. */
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
    void applyBlockSettingsAtTime(state.playheadMs);

    // Apply input order based on track order
    const order = getActiveOrder(state);
    if (order.length > 0) {
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
    applyBlockSettingsAtTime,
    roomId,
    scheduleNextEvent,
  ]);

  /** Seek to a new position during playback — rebase rAF loop and recompile events. */
  const seek = useCallback(
    (ms: number) => {
      if (!playStartRef.current) return;

      // Rebase the rAF reference so tick() calculates from the new position
      playStartRef.current = {
        wallMs: performance.now(),
        playheadMs: ms,
      };

      setPlayhead(ms);

      // Cancel pending event timer and recompile events from new position
      if (eventTimerRef.current) {
        clearTimeout(eventTimerRef.current);
        eventTimerRef.current = null;
      }

      // Build a temporary state snapshot with the new playhead for helpers
      const snap = { ...stateRef.current, playheadMs: ms };

      eventsRef.current = compileEvents(snap, ms);
      nextEventIndexRef.current = 0;

      // Apply desired visibility + block settings + order at new position
      const desired = computeDesiredState(snap);
      void applyDesiredState(desired);
      void applyBlockSettingsAtTime(ms);

      const order = getActiveOrder(snap);
      if (order.length > 0) {
        updateRoom(roomId, { inputOrder: order }).catch((err) =>
          console.warn('Timeline: failed to apply order after seek', err),
        );
      }

      scheduleNextEvent();
    },
    [
      setPlayhead,
      applyDesiredState,
      applyBlockSettingsAtTime,
      roomId,
      scheduleNextEvent,
    ],
  );

  /** Apply state at current playhead without starting playback. */
  const applyAtPlayhead = useCallback(async () => {
    appliedStateRef.current = new Map(
      inputs.map((i) => [i.inputId, !i.hidden]),
    );
    const desired = computeDesiredState(state);
    await applyDesiredState(desired);
    await applyBlockSettingsAtTime(state.playheadMs);

    const order = getActiveOrder(state);
    if (order.length > 0) {
      try {
        await updateRoom(roomId, { inputOrder: order });
      } catch (err) {
        console.warn('Timeline: failed to apply order', err);
      }
    }
  }, [inputs, state, roomId, applyDesiredState, applyBlockSettingsAtTime]);

  // Recompute events when the timeline structure changes during playback,
  // or re-apply desired state when structure changes while paused.
  useEffect(() => {
    if (structureRevision === 0) return;

    if (state.isPlaying && playStartRef.current) {
      eventsRef.current = compileEvents(state, state.playheadMs);
      nextEventIndexRef.current = 0;

      if (eventTimerRef.current) {
        clearTimeout(eventTimerRef.current);
        eventTimerRef.current = null;
      }

      scheduleNextEvent();
    } else if (!state.isPlaying) {
      // When not playing, re-apply visibility so the preview stays in sync
      // with the current playhead after timeline edits.
      const desired = computeDesiredState(state);
      void applyDesiredState(desired);
      void applyBlockSettingsAtTime(state.playheadMs);
    }
  }, [
    structureRevision,
    state,
    scheduleNextEvent,
    applyDesiredState,
    applyBlockSettingsAtTime,
  ]);

  return {
    play,
    stop,
    seek,
    applyAtPlayhead,
  };
}
