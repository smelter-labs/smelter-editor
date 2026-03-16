'use client';

import { useCallback, useRef, useEffect } from 'react';
import type { Input, TransitionConfig, UpdateInputOptions } from '@/lib/types';
import { buildInputUpdateFromBlockSettings } from '@/lib/room-config';
import { useActions } from '../contexts/actions-context';
import type { BlockSettings, Clip, TimelineState } from './use-timeline-state';

// ── Types ────────────────────────────────────────────────

type DesiredState = Map<string, boolean>; // inputId → should be visible

type PlaybackEvent = {
  timeMs: number;
  type: 'connect' | 'disconnect' | 'transition-in' | 'transition-out';
  inputId: string;
  transition?: TransitionConfig;
};

type TimelineVisibilityTransition = {
  type: string;
  durationMs: number;
  direction: 'in' | 'out';
};

type RestorableInputSettings = Pick<
  UpdateInputOptions,
  | 'absolutePosition'
  | 'absoluteTop'
  | 'absoluteLeft'
  | 'absoluteWidth'
  | 'absoluteHeight'
  | 'absoluteTransitionDurationMs'
  | 'absoluteTransitionEasing'
>;

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

      const intro = clip.blockSettings.introTransition;
      if (intro && clip.startMs > fromMs) {
        events.push({
          timeMs: clip.startMs,
          type: 'transition-in',
          inputId: clip.inputId,
          transition: intro,
        });
      }

      const outro = clip.blockSettings.outroTransition;
      if (outro) {
        const outroStartMs = clip.endMs - outro.durationMs;
        if (outroStartMs > fromMs) {
          events.push({
            timeMs: outroStartMs,
            type: 'transition-out',
            inputId: clip.inputId,
            transition: outro,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

function getActiveClipsByInputAt(
  state: TimelineState,
  timeMs: number,
): Map<string, Clip> {
  const active = new Map<string, Clip>();
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

function getActiveClipForInputAt(
  state: TimelineState,
  timeMs: number,
  inputId: string,
): Clip | null {
  return getActiveClipsByInputAt(state, timeMs).get(inputId) ?? null;
}

function pickRestorableInputSettings(input: Input): RestorableInputSettings {
  return {
    absolutePosition: input.absolutePosition,
    absoluteTop: input.absoluteTop,
    absoluteLeft: input.absoluteLeft,
    absoluteWidth: input.absoluteWidth,
    absoluteHeight: input.absoluteHeight,
    absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input.absoluteTransitionEasing,
  };
}

function diffRestorableInputSettings(
  input: Input,
  snapshot: RestorableInputSettings,
): Partial<RestorableInputSettings> {
  const patch: Partial<RestorableInputSettings> = {};
  if (input.absolutePosition !== snapshot.absolutePosition) {
    patch.absolutePosition = snapshot.absolutePosition;
  }
  if (input.absoluteTop !== snapshot.absoluteTop) {
    patch.absoluteTop = snapshot.absoluteTop;
  }
  if (input.absoluteLeft !== snapshot.absoluteLeft) {
    patch.absoluteLeft = snapshot.absoluteLeft;
  }
  if (input.absoluteWidth !== snapshot.absoluteWidth) {
    patch.absoluteWidth = snapshot.absoluteWidth;
  }
  if (input.absoluteHeight !== snapshot.absoluteHeight) {
    patch.absoluteHeight = snapshot.absoluteHeight;
  }
  if (
    input.absoluteTransitionDurationMs !== snapshot.absoluteTransitionDurationMs
  ) {
    patch.absoluteTransitionDurationMs = snapshot.absoluteTransitionDurationMs;
  }
  if (input.absoluteTransitionEasing !== snapshot.absoluteTransitionEasing) {
    patch.absoluteTransitionEasing = snapshot.absoluteTransitionEasing;
  }
  return patch;
}

// ── Hook ─────────────────────────────────────────────────

type Mp4RestartKey = `${number}|${number}|${boolean}`;

function getMp4RestartKey(clip: Clip): Mp4RestartKey {
  const playFromMs = clip.blockSettings.mp4PlayFromMs ?? 0;
  const loop = clip.blockSettings.mp4Loop !== false;
  return loop
    ? `0|${playFromMs}|${loop}`
    : `${clip.startMs}|${playFromMs}|${loop}`;
}

function isMp4InputId(inputId: string): boolean {
  return inputId.includes('::local::');
}

export function useTimelinePlayback(
  roomId: string,
  inputs: Input[],
  state: TimelineState,
  setPlayhead: (ms: number) => void,
  setPlaying: (playing: boolean) => void,
  refreshState: () => Promise<void>,
  structureRevision: number,
) {
  const { hideInput, showInput, updateInput, updateRoom, restartMp4Input } =
    useActions();
  const appliedStateRef = useRef<DesiredState>(new Map());
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallMs: number; playheadMs: number } | null>(
    null,
  );
  const prePlayStateRef = useRef<{
    hiddenInputIds: Set<string>;
    inputOrder: string[];
    inputSettings: Map<string, RestorableInputSettings>;
  } | null>(null);

  const eventsRef = useRef<PlaybackEvent[]>([]);
  const nextEventIndexRef = useRef(0);
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedBlockSettingsRef = useRef<Map<string, string>>(new Map());
  const mp4RestartedRef = useRef<Map<string, Mp4RestartKey>>(new Map());
  const mp4ActualRestartedRef = useRef<Set<string>>(new Set());
  const lastAppliedOrderRef = useRef<string>('');
  const playbackGenRef = useRef(0);
  const inFlightRef = useRef<Set<Promise<unknown>>>(new Set());
  const inputOperationQueueRef = useRef<Map<string, Promise<void>>>(new Map());

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

  const trackPromise = useCallback((p: Promise<unknown>) => {
    inFlightRef.current.add(p);
    p.finally(() => inFlightRef.current.delete(p));
    return p;
  }, []);

  const enqueueInputOperation = useCallback(
    (inputId: string, operation: () => Promise<void>) => {
      const previous =
        inputOperationQueueRef.current.get(inputId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(operation);
      const settled = next.catch(() => undefined);
      inputOperationQueueRef.current.set(inputId, settled);
      trackPromise(
        settled.finally(() => {
          if (inputOperationQueueRef.current.get(inputId) === settled) {
            inputOperationQueueRef.current.delete(inputId);
          }
        }),
      );
      return settled;
    },
    [trackPromise],
  );

  const applyActiveClipRuntimeState = useCallback(
    async (
      inputId: string,
      clip: Clip,
      options?: {
        ensureVisible?: boolean;
        showTransition?: TimelineVisibilityTransition;
      },
    ) => {
      const serialized = JSON.stringify(clip.blockSettings);
      if (appliedBlockSettingsRef.current.get(inputId) !== serialized) {
        appliedBlockSettingsRef.current.set(inputId, serialized);
        await updateInput(
          roomId,
          inputId,
          buildInputUpdateFromBlockSettings(clip.blockSettings),
        ).catch((err) =>
          console.warn(
            `Timeline: failed to apply block settings for ${inputId}`,
            err,
          ),
        );
      }

      if (isMp4InputId(inputId)) {
        const playFromMs = clip.blockSettings.mp4PlayFromMs ?? 0;
        const loop = clip.blockSettings.mp4Loop !== false;
        const key = getMp4RestartKey(clip);
        if (mp4RestartedRef.current.get(inputId) !== key) {
          mp4RestartedRef.current.set(inputId, key);
          mp4ActualRestartedRef.current.add(inputId);
          await restartMp4Input(roomId, inputId, playFromMs, loop).catch(
            (err) =>
              console.warn(`Timeline: failed to restart MP4 ${inputId}`, err),
          );
        }
      }

      if (!options?.ensureVisible) return;

      const input = inputsRef.current.find(
        (candidate) => candidate.inputId === inputId,
      );
      if (!input) return;

      const isCurrentlyVisible =
        (input.status === 'connected' || input.status === 'pending') &&
        !input.hidden;
      if (isCurrentlyVisible) return;

      await showInput(roomId, inputId, options.showTransition).catch((err) =>
        console.warn(`Timeline: failed to show ${inputId}`, err),
      );
    },
    [restartMp4Input, roomId, showInput, updateInput],
  );

  const showInputAtTime = useCallback(
    (
      inputId: string,
      timeMs: number,
      transition?: TimelineVisibilityTransition,
    ) => {
      const clip = getActiveClipForInputAt(stateRef.current, timeMs, inputId);
      if (!clip) {
        return Promise.resolve();
      }

      const showTransition =
        transition ??
        (clip.blockSettings.introTransition
          ? {
              type: clip.blockSettings.introTransition.type,
              durationMs: clip.blockSettings.introTransition.durationMs,
              direction: 'in' as const,
            }
          : undefined);

      return enqueueInputOperation(inputId, () =>
        applyActiveClipRuntimeState(inputId, clip, {
          ensureVisible: true,
          showTransition,
        }),
      );
    },
    [applyActiveClipRuntimeState, enqueueInputOperation],
  );

  const hideInputQueued = useCallback(
    (inputId: string, transition?: TimelineVisibilityTransition) =>
      enqueueInputOperation(inputId, async () => {
        await hideInput(roomId, inputId, transition).catch((err) =>
          console.warn(`Timeline: failed to hide ${inputId}`, err),
        );
      }),
    [enqueueInputOperation, hideInput, roomId],
  );

  /** Apply visibility for a desired state map — only sends commands for changed inputs. */
  const applyDesiredState = useCallback(
    async (desired: DesiredState, timeMs: number) => {
      const gen = playbackGenRef.current;
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
          promises.push(showInputAtTime(inputId, timeMs));
        } else if (!shouldBeVisible && isCurrentlyVisible) {
          promises.push(hideInputQueued(inputId));
        }

        appliedStateRef.current.set(inputId, shouldBeVisible);
      }

      if (promises.length > 0) {
        await Promise.allSettled(promises);
        if (playbackGenRef.current === gen) {
          await refreshState();
        }
      }
    },
    [hideInputQueued, refreshState, showInputAtTime],
  );

  const applyBlockSettingsAtTime = useCallback(
    async (timeMs: number) => {
      const gen = playbackGenRef.current;
      const active = getActiveClipsByInputAt(stateRef.current, timeMs);
      const updates: Promise<unknown>[] = [];
      for (const [inputId, clip] of active.entries()) {
        updates.push(
          enqueueInputOperation(inputId, () =>
            applyActiveClipRuntimeState(inputId, clip),
          ),
        );
      }
      if (updates.length > 0) {
        await Promise.allSettled(updates);
        if (playbackGenRef.current === gen) {
          await refreshState();
        }
      }
    },
    [applyActiveClipRuntimeState, enqueueInputOperation, refreshState],
  );

  /** Send updated inputOrder to the server if the active set has changed. */
  const applyOrderIfChanged = useCallback(
    (timeMs: number) => {
      const snap = { ...stateRef.current, playheadMs: timeMs };
      const order = getActiveOrder(snap);
      const key = order.join(',');
      if (key === lastAppliedOrderRef.current || order.length === 0) return;
      lastAppliedOrderRef.current = key;
      trackPromise(
        updateRoom(roomId, { inputOrder: order }).catch((err) =>
          console.warn('Timeline: failed to apply order', err),
        ),
      );
    },
    [roomId, trackPromise, updateRoom],
  );

  /** Snapshot current server state before playing. */
  const snapshotPrePlayState = useCallback(() => {
    const currentInputs = inputsRef.current;
    const hiddenInputIds = new Set<string>();
    const inputOrder: string[] = [];
    const inputSettings = new Map<string, RestorableInputSettings>();
    for (const input of currentInputs) {
      inputOrder.push(input.inputId);
      inputSettings.set(input.inputId, pickRestorableInputSettings(input));
      if (input.hidden) {
        hiddenInputIds.add(input.inputId);
      }
    }
    prePlayStateRef.current = { hiddenInputIds, inputOrder, inputSettings };
    appliedStateRef.current = new Map(
      currentInputs.map((i) => [i.inputId, !i.hidden]),
    );
    appliedBlockSettingsRef.current = new Map();

    // Pre-populate MP4 keys for active clips so that MP4s already playing
    // with matching settings are NOT unnecessarily restarted (avoids flash).
    const currentState = stateRef.current;
    const active = getActiveClipsByInputAt(
      currentState,
      currentState.playheadMs,
    );
    const mp4Map = new Map<string, Mp4RestartKey>();
    for (const [inputId, clip] of active.entries()) {
      if (isMp4InputId(inputId)) {
        mp4Map.set(inputId, getMp4RestartKey(clip));
      }
    }
    mp4RestartedRef.current = mp4Map;
  }, []);

  /** Restore server state to pre-play snapshot. */
  const restorePrePlayState = useCallback(async () => {
    const snapshot = prePlayStateRef.current;
    if (!snapshot) return;

    const promises: Promise<unknown>[] = [];
    for (const input of inputsRef.current) {
      const shouldBeHidden = snapshot.hiddenInputIds.has(input.inputId);
      const restorePatch = diffRestorableInputSettings(
        input,
        snapshot.inputSettings.get(input.inputId) ??
          pickRestorableInputSettings(input),
      );
      const hasRestorePatch = Object.keys(restorePatch).length > 0;
      const shouldRestartMp4 = mp4ActualRestartedRef.current.has(input.inputId);
      const needsVisibilityRestore =
        (shouldBeHidden && !input.hidden) || (!shouldBeHidden && input.hidden);

      if (!hasRestorePatch && !shouldRestartMp4 && !needsVisibilityRestore) {
        continue;
      }

      promises.push(
        enqueueInputOperation(input.inputId, async () => {
          if (hasRestorePatch) {
            await updateInput(roomId, input.inputId, restorePatch).catch(
              () => {},
            );
          }

          if (shouldRestartMp4) {
            await restartMp4Input(roomId, input.inputId, 0, true).catch(
              () => {},
            );
          }

          if (shouldBeHidden && !input.hidden) {
            await hideInput(roomId, input.inputId).catch(() => {});
          } else if (!shouldBeHidden && input.hidden) {
            await showInput(roomId, input.inputId).catch(() => {});
          }
        }),
      );
    }
    mp4ActualRestartedRef.current.clear();
    mp4RestartedRef.current.clear();

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
    appliedBlockSettingsRef.current = new Map();
  }, [
    enqueueInputOperation,
    hideInput,
    refreshState,
    restartMp4Input,
    roomId,
    showInput,
    updateInput,
  ]);

  /** Stop playback and restore pre-play state. */
  const stop = useCallback(async () => {
    playbackGenRef.current += 1;

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
    lastAppliedOrderRef.current = '';
    setPlaying(false);

    if (inFlightRef.current.size > 0) {
      await Promise.allSettled([...inFlightRef.current]);
    }

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
      if (!playStartRef.current) return;
      eventTimerRef.current = null;
      nextEventIndexRef.current = idx + 1;

      if (event.type === 'connect' && event.inputId) {
        appliedStateRef.current.set(event.inputId, true);
        // Look ahead for a transition-in event at the same time for this input
        const nextEvents = eventsRef.current;
        let mergedTransition: TimelineVisibilityTransition | undefined;
        for (let j = idx + 1; j < nextEvents.length; j++) {
          if (nextEvents[j].timeMs !== event.timeMs) break;
          if (
            nextEvents[j].type === 'transition-in' &&
            nextEvents[j].inputId === event.inputId &&
            nextEvents[j].transition
          ) {
            mergedTransition = {
              type: nextEvents[j].transition!.type,
              durationMs: nextEvents[j].transition!.durationMs,
              direction: 'in',
            };
            // Remove the transition-in event so it won't fire separately
            nextEvents.splice(j, 1);
            break;
          }
        }
        void showInputAtTime(event.inputId, event.timeMs, mergedTransition);
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
          void hideInputQueued(event.inputId);
        }
      } else if (event.type === 'transition-in' && event.transition) {
        const transition = event.transition;
        void enqueueInputOperation(event.inputId, async () => {
          await updateInput(roomId, event.inputId, {
            volume:
              inputsRef.current.find((i) => i.inputId === event.inputId)
                ?.volume ?? 1,
            activeTransition: {
              type: transition.type,
              durationMs: transition.durationMs,
              direction: 'in',
              startedAtMs: 0,
            },
          }).catch((err) =>
            console.warn(
              `Timeline: failed to start transition-in for ${event.inputId}`,
              err,
            ),
          );
        });
      } else if (event.type === 'transition-out' && event.transition) {
        appliedStateRef.current.set(event.inputId, false);
        // Remove the corresponding disconnect event — hideInput will auto-hide after transition
        const nextEvents = eventsRef.current;
        for (let j = nextEventIndexRef.current; j < nextEvents.length; j++) {
          if (
            nextEvents[j].type === 'disconnect' &&
            nextEvents[j].inputId === event.inputId
          ) {
            nextEvents.splice(j, 1);
            break;
          }
        }
        void hideInputQueued(event.inputId, {
          type: event.transition.type,
          durationMs: event.transition.durationMs,
          direction: 'out',
        });
      }

      applyOrderIfChanged(event.timeMs);
      void trackPromise(applyBlockSettingsAtTime(event.timeMs));

      scheduleNextEvent();
    };

    eventTimerRef.current = setTimeout(fire, Math.max(0, delayMs));
  }, [
    applyBlockSettingsAtTime,
    applyOrderIfChanged,
    enqueueInputOperation,
    hideInputQueued,
    roomId,
    showInputAtTime,
    trackPromise,
    updateInput,
  ]);

  /** Start playback — animate playhead and fire events at clip edges. */
  const play = useCallback(() => {
    if (state.isPlaying) return;
    playbackGenRef.current += 1;
    inFlightRef.current.clear();
    mp4ActualRestartedRef.current.clear();

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
    void trackPromise(applyDesiredState(desired, state.playheadMs));
    void trackPromise(applyBlockSettingsAtTime(state.playheadMs));

    // Apply input order based on track order
    lastAppliedOrderRef.current = '';
    applyOrderIfChanged(state.playheadMs);

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
    applyOrderIfChanged,
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
      void trackPromise(applyDesiredState(desired, ms));
      void trackPromise(applyBlockSettingsAtTime(ms));

      lastAppliedOrderRef.current = '';
      applyOrderIfChanged(ms);

      scheduleNextEvent();
    },
    [
      setPlayhead,
      applyDesiredState,
      applyBlockSettingsAtTime,
      applyOrderIfChanged,
      scheduleNextEvent,
    ],
  );

  /** Apply state at current playhead without starting playback. */
  const applyAtPlayhead = useCallback(async () => {
    appliedStateRef.current = new Map(
      inputsRef.current.map((i) => [i.inputId, !i.hidden]),
    );
    const desired = computeDesiredState(state);
    await applyDesiredState(desired, state.playheadMs);
    await applyBlockSettingsAtTime(state.playheadMs);

    lastAppliedOrderRef.current = '';
    applyOrderIfChanged(state.playheadMs);
  }, [state, applyDesiredState, applyBlockSettingsAtTime, applyOrderIfChanged]);

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

      applyOrderIfChanged(state.playheadMs);
      scheduleNextEvent();
    } else if (!state.isPlaying) {
      // When not playing, re-apply visibility so the preview stays in sync
      // with the current playhead after timeline edits.
      const desired = computeDesiredState(state);
      void trackPromise(applyDesiredState(desired, state.playheadMs));
      void trackPromise(applyBlockSettingsAtTime(state.playheadMs));
    }
  }, [
    structureRevision,
    state,
    scheduleNextEvent,
    applyDesiredState,
    applyBlockSettingsAtTime,
    applyOrderIfChanged,
    trackPromise,
  ]);

  return {
    play,
    stop,
    seek,
    applyAtPlayhead,
  };
}
