// OB Van — "Who Wants to Be a Smelterionaire?" quiz layer. A Millionaire-style
// game show run through the OB Van director: one host (role `speaker`), up to
// four contestants (role `guest`), each starting at exactly $1,000,000. A
// correct answer multiplies the pot by 1.5, a wrong one by 0.5 — amounts stay
// exact integers on purpose (the odd precision is part of the joke). The
// operator judges from the desk: assign a question, show the ABCD board, lock
// the contestant's letter, REVEAL. One lifeline per contestant: "Ask the AI"
// (the director's LLM answers blind — it may be confidently wrong).

export type ObQuizLetter = "A" | "B" | "C" | "D";
export const OB_QUIZ_LETTERS: readonly ObQuizLetter[] = ["A", "B", "C", "D"];
export function isObQuizLetter(v: unknown): v is ObQuizLetter {
  return typeof v === "string" &&
    (OB_QUIZ_LETTERS as readonly string[]).includes(v);
}

/**
 * `idle` nothing on the table · `assigned` a question belongs to a contestant
 * (board not on program yet) · `board` the ABCD board is on program ·
 * `locked` the contestant committed to a letter · `revealed` verdict shown,
 * celebration running (returns to `idle` after `OB_QUIZ_CELEBRATE_MS`).
 */
export type ObQuizPhase = "idle" | "assigned" | "board" | "locked" | "revealed";
export type ObQuizVerdict = "correct" | "wrong";

export type ObQuizAction =
  | "assign"
  | "show_board"
  | "hide_board"
  | "lock"
  | "reveal"
  | "lifeline"
  | "skip"
  | "reset";
export const OB_QUIZ_ACTIONS: readonly ObQuizAction[] = [
  "assign",
  "show_board",
  "hide_board",
  "lock",
  "reveal",
  "lifeline",
  "skip",
  "reset",
];

export type ObQuizPlayer = {
  camId: string;
  /** Display name — the camera's talent, falling back to the camera name. */
  name: string;
  /** Integer dollars. */
  amount: number;
  /** Amount before the last verdict (count-up animation start). */
  amountFrom: number;
  /** When the last verdict changed the amount (drives HUD animation). */
  amountChangedAtMs: number | null;
  lifelineUsed: boolean;
  answered: number;
  correctCount: number;
  /** Camera currently live (players survive reconnects by camId). */
  live: boolean;
};

export type ObQuizCurrent = {
  questionId: string;
  /** 1-based "QUESTION 4". */
  number: number;
  forCamId: string;
  q: string;
  answers: [string, string, string, string];
  /** Desk-only before the reveal: the HUD snapshot omits it until then. */
  correct: ObQuizLetter;
  /** Board on program since (null = hidden). */
  shownAtMs: number | null;
  lockedLetter: ObQuizLetter | null;
  lockedAtMs: number | null;
  verdict: ObQuizVerdict | null;
  revealedAtMs: number | null;
  /** amount − amountFrom for the answering player (0 before the reveal). */
  delta: number;
};

export type ObQuizHintState = {
  forCamId: string;
  questionId: string;
  status: "pending" | "done";
  /** The AI's pick — null while pending and for canned fallbacks. */
  letter: ObQuizLetter | null;
  text: string | null;
  requestedAtMs: number;
  /** Overlay visible until (null while pending). */
  untilMs: number | null;
  /** True when the LLM was unavailable and a canned line substituted. */
  canned: boolean;
};

export type ObQuizState = {
  phase: ObQuizPhase;
  /** 1..4, guest-cam join order. */
  players: ObQuizPlayer[];
  questionsLeft: number;
  current: ObQuizCurrent | null;
  hint: ObQuizHintState | null;
};

export const OB_QUIZ_START_AMOUNT = 1_000_000;
export const OB_QUIZ_MAX_PLAYERS = 4;
export const OB_QUIZ_CELEBRATE_MS = 6000;
export const OB_QUIZ_HINT_TIMEOUT_MS = 10_000;
export const OB_QUIZ_HINT_SHOW_MS = 12_000;

/** ×1.5 on correct, ×0.5 on wrong; half-up to whole dollars. */
export function obQuizApplyVerdict(
  amount: number,
  verdict: ObQuizVerdict,
): number {
  return Math.round(amount * (verdict === "correct" ? 1.5 : 0.5));
}

/** `$3,375,000`; negatives as `−$1,687,500` (U+2212). */
export function obQuizFormatMoney(n: number): string {
  const abs = Math.abs(Math.round(n));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "−" : ""}$${grouped}`;
}

/** Floater text for a verdict: `+$506,250` / `−$843,750`. */
export function obQuizFormatDelta(delta: number): string {
  return delta >= 0
    ? `+${obQuizFormatMoney(delta)}`
    : obQuizFormatMoney(delta);
}
