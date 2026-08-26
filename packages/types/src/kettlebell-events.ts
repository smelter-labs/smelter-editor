// Kettlebell Coach — exercise-technique events derived from the
// `kettlebell-coach` AI model (pose + kettlebell detection). Emitted on the
// room event bus by KettlebellCoachController after debounce/hysteresis, so
// consumers (editor UI, future video triggers) never see raw per-frame noise.

/** Exercise classes the worker's classifier can report. */
export type KettlebellExercise = "swing" | "clean" | "snatch" | "idle";

/** Technique fault codes judged per rep (swing faults + snatch lockout). */
export type KettlebellIssueCode =
  | "squatting"
  | "bent_arms"
  | "too_high"
  | "too_low"
  | "rounded_back"
  | "soft_lockout";

/** Human-readable labels for issue codes — single source for all UIs. */
export const KETTLEBELL_ISSUE_LABELS: Record<KettlebellIssueCode, string> = {
  squatting: "Squatting instead of hinging",
  bent_arms: "Arms bent during upswing",
  too_high: "Bell above shoulder height",
  too_low: "Shallow swing — bell too low at top",
  rounded_back: "Back rounding at the bottom",
  soft_lockout: "Soft overhead lockout (press-out)",
};

/** One completed rep with its technique verdict. */
export type KettlebellRepCompletedEvent = {
  type: "kettlebell_rep_completed";
  roomId: string;
  inputId: string;
  /** Monotonic per-input rep index (also the running rep count). */
  repIndex: number;
  exercise: KettlebellExercise;
  verdict: "correct" | "incorrect";
  issues: KettlebellIssueCode[];
  /**
   * Server-relative still of the lifter at the rep's apex
   * (`/kbt-rep-frames/…`). Only present when rep screenshots are enabled.
   */
  screenshotUrl?: string;
};

/** The classifier settled on a different exercise (post-dwell + debounce). */
export type KettlebellExerciseChangedEvent = {
  type: "kettlebell_exercise_changed";
  roomId: string;
  inputId: string;
  exercise: KettlebellExercise;
  prevExercise: KettlebellExercise;
};

/**
 * The same fault keeps recurring (N of the last M reps) — the hysteresis
 * primitive future video triggers should subscribe to instead of raw verdicts.
 */
export type KettlebellTechniqueAlertEvent = {
  type: "kettlebell_technique_alert";
  roomId: string;
  inputId: string;
  issue: KettlebellIssueCode;
  /** How many of the last `windowReps` reps showed this issue. */
  occurrences: number;
  windowReps: number;
};

export type KettlebellServerEvent =
  | KettlebellRepCompletedEvent
  | KettlebellExerciseChangedEvent
  | KettlebellTechniqueAlertEvent;
