// OB Van — "Who Wants to Be a Smelterionaire?" quiz layer. A Millionaire-style
// game show run through the OB Van director: one host (role `speaker`), up to
// four contestants (role `guest`), each starting at exactly 1,000,000 TOKENS
// (AI models play for the only currency they respect). A
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
  | "ask"
  | "lock"
  | "reveal"
  | "lifeline"
  | "skip"
  | "reset";
export const OB_QUIZ_ACTIONS: readonly ObQuizAction[] = [
  "assign",
  "show_board",
  "hide_board",
  "ask",
  "lock",
  "reveal",
  "lifeline",
  "skip",
  "reset",
];

/**
 * AI-model contestants. A guest cam whose talent name maps to one of these
 * (see `obQuizModelFromName`) answers its own questions live; any other
 * talent is a human contestant and `ask` falls back to a canned answer.
 * `gemini` is a staged cameo: no real API — asked anything, it cashes out
 * its million tokens and leaves the show.
 */
export type ObQuizModelId = "opus" | "gpt" | "gemini" | "jev";
export const OB_QUIZ_MODELS: Record<
  ObQuizModelId,
  { label: string; vendor: string }
> = {
  opus: { label: "OPUS", vendor: "Anthropic" },
  gpt: { label: "GPT", vendor: "OpenAI" },
  gemini: { label: "GEMINI", vendor: "Google" },
  jev: { label: "JEV", vendor: "TypeSafe AI" },
};

const OB_QUIZ_MODEL_ALIASES: Record<string, ObQuizModelId> = {
  opus: "opus",
  claude: "opus",
  anthropic: "opus",
  gpt: "gpt",
  openai: "gpt",
  gemini: "gemini",
  google: "gemini",
  jev: "jev",
  typesafe: "jev",
};

/** Map a cam's talent/display name to a contestant model, if any. */
export function obQuizModelFromName(
  name: string | null | undefined,
): ObQuizModelId | null {
  const key = name?.trim().toLowerCase();
  return (key && OB_QUIZ_MODEL_ALIASES[key]) || null;
}

export type ObQuizPlayer = {
  camId: string;
  /** Display name — the camera's talent, falling back to the camera name. */
  name: string;
  /** AI contestant this player maps to (from the talent name), or a human. */
  model: ObQuizModelId | null;
  /** Integer dollars. */
  amount: number;
  /** Amount before the last verdict (count-up animation start). */
  amountFrom: number;
  /** When the last verdict changed the amount (drives HUD animation). */
  amountChangedAtMs: number | null;
  lifelineUsed: boolean;
  answered: number;
  correctCount: number;
  /**
   * Took the tokens and left the show (the Gemini cameo): keeps their pot on
   * the rail, can never be assigned again. Cleared by `reset`.
   */
  cashedOut: boolean;
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
  /** Live AI answer in flight / landed for this question (null = none yet). */
  answering: ObQuizAnswering | null;
};

/**
 * One live AI answer. Never carries the correct letter — adapters answer
 * blind, exactly like the lifeline hint. A resolved answer auto-locks the
 * contestant's letter (phase goes to `locked`), so REVEAL works unchanged.
 */
export type ObQuizAnswering = {
  /** Monotonic ask sequence — stale adapter resolutions are dropped. */
  seq: number;
  status: "pending" | "done";
  /** Which AI contestant is answering (null = human/unmapped → canned). */
  model: ObQuizModelId | null;
  startedAtMs: number;
  answeredAtMs: number | null;
  /** The contestant's pick (null while pending). */
  letter: ObQuizLetter | null;
  /** In-character one-liner (null while pending and for Jev). */
  quip: string | null;
  /** Jev's calibrated confidence 0..1 (null for chat models). */
  confidence: number | null;
  /** True when the adapter was unavailable/failed and a canned answer landed. */
  canned: boolean;
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
/** Machine backstop: a pending AI answer goes canned after this long. */
export const OB_QUIZ_ANSWER_TIMEOUT_MS = 30_000;
/** Minimum on-screen "thinking" time — Jev answers in <500 ms. */
export const OB_QUIZ_THINK_MIN_MS = 2_000;

/** ×1.5 on correct, ×0.5 on wrong; half-up to whole dollars. */
export function obQuizApplyVerdict(
  amount: number,
  verdict: ObQuizVerdict,
): number {
  return Math.round(amount * (verdict === "correct" ? 1.5 : 0.5));
}

/**
 * The pot is paid in TOKENS (what else would AI models play for?):
 * `3,375,000 TOK`; negatives as `−1,687,500 TOK` (U+2212).
 */
export function obQuizFormatMoney(n: number): string {
  const abs = Math.abs(Math.round(n));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "−" : ""}${grouped} TOK`;
}

/** Floater text for a verdict: `+506,250 TOK` / `−843,750 TOK`. */
export function obQuizFormatDelta(delta: number): string {
  return delta >= 0
    ? `+${obQuizFormatMoney(delta)}`
    : obQuizFormatMoney(delta);
}
