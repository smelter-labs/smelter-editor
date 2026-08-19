import type {
  KettlebellExercise,
  KettlebellIssueCode,
  RoomEvent,
} from '@smelter-editor/types';
import { roomEventBus } from '../core/roomEventBus';

/** Discrete events as emitted inside the kettlebell-coach worker's `data.events`. */
type WorkerEvent = {
  type?: string;
  index?: number;
  verdict?: string;
  issues?: string[];
  exercise?: string;
  prev?: string;
};

/** The slice of the worker result payload this controller consumes. */
export type KettlebellResultData = {
  events?: WorkerEvent[];
  exercise?: string;
  /** Analyzer-lifetime token: changes whenever the worker restarts the
   * analyzer (worker restart, stream reconnect), restarting rep indices. */
  session?: string;
};

// Legitimate classifier flips are >= 1.5s apart (worker-side dwell); anything
// faster is a replay/oscillation. Too-soon changes are parked in `pending` and
// flushed on a later result, so the settled state always gets broadcast.
const EXERCISE_MIN_INTERVAL_MS = 2000;
// A technique alert fires when the same issue shows in >= MIN of the last
// WINDOW reps, then holds its per-issue cooldown — this is the hysteresis
// primitive video triggers should subscribe to instead of raw verdicts.
const ALERT_WINDOW_REPS = 5;
const ALERT_MIN_OCCURRENCES = 3;
const ALERT_COOLDOWN_MS = 10_000;

const EXERCISES: readonly string[] = ['swing', 'clean', 'snatch', 'idle'];

type InputTriggerState = {
  /** Highest rep index broadcast — dedupes replays after a worker reconnect. */
  lastRepIndex: number;
  /** Worker analyzer session the dedupe belongs to (null until first seen). */
  session: string | null;
  exercise: KettlebellExercise;
  pendingExercise: KettlebellExercise | null;
  lastExerciseBroadcastAt: number;
  /** Issue lists of the last ALERT_WINDOW_REPS reps, newest last. */
  recentRepIssues: KettlebellIssueCode[][];
  alertCooldownUntil: Map<KettlebellIssueCode, number>;
};

/**
 * Debounces the kettlebell-coach worker's discrete events into typed room-bus
 * events (`kettlebell_rep_completed` / `kettlebell_exercise_changed` /
 * `kettlebell_technique_alert`). Pure event logic — the on-video overlay stays
 * in the RoomState handler, consistent with the other models. Fed with the
 * LIVE (unheld) result so dashboards and triggers aren't output-delayed.
 */
export class KettlebellCoachController {
  private readonly inputs = new Map<string, InputTriggerState>();

  constructor(
    private readonly roomId: string,
    private readonly broadcast: (roomId: string, event: RoomEvent) => void = (
      id,
      event,
    ) => roomEventBus.broadcast(id, event),
    private readonly now: () => number = Date.now,
  ) {}

  handleResult(inputId: string, data: KettlebellResultData): void {
    const state = this.stateFor(inputId);
    const now = this.now();

    // A new worker session restarts rep indices at 1 — WITHOUT this reset the
    // `index <= lastRepIndex` dedupe below silently swallowed every rep after
    // a worker restart or a camera reconnect (the overlay count kept climbing
    // while the scoreboard froze). Same-session replays still dedupe.
    if (data.session != null && data.session !== state.session) {
      if (state.session != null) {
        state.lastRepIndex = 0;
        state.recentRepIssues = [];
      }
      state.session = data.session;
    }

    this.flushPendingExercise(state, inputId, now);

    for (const event of data.events ?? []) {
      if (event.type === 'rep_completed') {
        this.onRepCompleted(state, inputId, event, now);
      } else if (event.type === 'exercise_changed') {
        this.onExerciseChanged(state, inputId, event, now);
      }
    }
  }

  reset(inputId: string): void {
    this.inputs.delete(inputId);
  }

  private stateFor(inputId: string): InputTriggerState {
    let state = this.inputs.get(inputId);
    if (!state) {
      state = {
        lastRepIndex: 0,
        session: null,
        exercise: 'idle',
        pendingExercise: null,
        lastExerciseBroadcastAt: 0,
        recentRepIssues: [],
        alertCooldownUntil: new Map(),
      };
      this.inputs.set(inputId, state);
    }
    return state;
  }

  private onRepCompleted(
    state: InputTriggerState,
    inputId: string,
    event: WorkerEvent,
    now: number,
  ): void {
    const index = typeof event.index === 'number' ? event.index : 0;
    if (index <= state.lastRepIndex) return; // replayed after reconnect
    state.lastRepIndex = index;

    const issues = (Array.isArray(event.issues)
      ? event.issues
      : []) as KettlebellIssueCode[];
    // v1 only counts/judges swings; a future worker can stamp the event.
    const exercise = (
      EXERCISES.includes(event.exercise ?? '') ? event.exercise : 'swing'
    ) as KettlebellExercise;

    this.broadcast(this.roomId, {
      type: 'kettlebell_rep_completed',
      roomId: this.roomId,
      inputId,
      repIndex: index,
      exercise,
      verdict: event.verdict === 'incorrect' ? 'incorrect' : 'correct',
      issues,
    });

    state.recentRepIssues.push(issues);
    if (state.recentRepIssues.length > ALERT_WINDOW_REPS) {
      state.recentRepIssues.shift();
    }
    for (const issue of new Set(issues)) {
      const occurrences = state.recentRepIssues.filter((rep) =>
        rep.includes(issue),
      ).length;
      if (occurrences < ALERT_MIN_OCCURRENCES) continue;
      if (now < (state.alertCooldownUntil.get(issue) ?? 0)) continue;
      state.alertCooldownUntil.set(issue, now + ALERT_COOLDOWN_MS);
      this.broadcast(this.roomId, {
        type: 'kettlebell_technique_alert',
        roomId: this.roomId,
        inputId,
        issue,
        occurrences,
        windowReps: state.recentRepIssues.length,
      });
    }
  }

  private onExerciseChanged(
    state: InputTriggerState,
    inputId: string,
    event: WorkerEvent,
    now: number,
  ): void {
    const target = event.exercise;
    if (typeof target !== 'string' || !EXERCISES.includes(target)) return;
    const exercise = target as KettlebellExercise;
    if (exercise === state.exercise) {
      state.pendingExercise = null; // replayed no-op
      return;
    }
    if (now - state.lastExerciseBroadcastAt < EXERCISE_MIN_INTERVAL_MS) {
      state.pendingExercise = exercise;
      return;
    }
    this.broadcastExercise(state, inputId, exercise, now);
  }

  private flushPendingExercise(
    state: InputTriggerState,
    inputId: string,
    now: number,
  ): void {
    if (
      state.pendingExercise !== null &&
      state.pendingExercise !== state.exercise &&
      now - state.lastExerciseBroadcastAt >= EXERCISE_MIN_INTERVAL_MS
    ) {
      this.broadcastExercise(state, inputId, state.pendingExercise, now);
    }
  }

  private broadcastExercise(
    state: InputTriggerState,
    inputId: string,
    exercise: KettlebellExercise,
    now: number,
  ): void {
    this.broadcast(this.roomId, {
      type: 'kettlebell_exercise_changed',
      roomId: this.roomId,
      inputId,
      exercise,
      prevExercise: state.exercise,
    });
    state.exercise = exercise;
    state.pendingExercise = null;
    state.lastExerciseBroadcastAt = now;
  }
}
