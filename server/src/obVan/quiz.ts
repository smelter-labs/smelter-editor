/**
 * OB Van — the Smelterionaire quiz state machine.
 *
 * Pure, like `host.ts` / `program.ts`: no timers (timeouts resolve inside
 * `tick()`), no I/O — camera cuts, the `quizTurn` signal, LLM hints, stingers
 * and log lines are returned as effects for the controller to apply. The
 * whole game is unit-testable with a fake clock.
 *
 * Flow per question: `assign` (a question leaves the bank and belongs to a
 * contestant; the quizTurn signal makes the p85 split fire) → `show_board`
 * (ABCD overlay on program) → `lock` (the contestant's letter, re-lockable)
 * or `ask` (an AI contestant answers for itself and auto-locks; see
 * `resolveAnswer`) → `reveal` (verdict from the bank, or the operator's
 * override; money ×1.5 or ×0.5; celebration solo for `OB_QUIZ_CELEBRATE_MS`)
 * → back to `idle`.
 */
import type {
  ObCamRole,
  ObLogTone,
  ObOperatorCommand,
  ObQuizAnswering,
  ObQuizHintState,
  ObQuizLetter,
  ObQuizModelId,
  ObQuizPhase,
  ObQuizState,
  ObQuizVerdict,
} from '@smelter-editor/types';
import {
  OB_QUIZ_ANSWER_TIMEOUT_MS,
  OB_QUIZ_CELEBRATE_MS,
  OB_QUIZ_HINT_SHOW_MS,
  OB_QUIZ_HINT_TIMEOUT_MS,
  OB_QUIZ_LETTERS,
  OB_QUIZ_MAX_PLAYERS,
  OB_QUIZ_START_AMOUNT,
  obQuizApplyVerdict,
  obQuizFormatMoney,
} from '@smelter-editor/types';
import type { QuizQuestion } from './quizQuestions';

export type ObQuizSfx = 'intro' | 'board' | 'win' | 'lose';

export type ObQuizEffect =
  | { type: 'turn'; camId: string | null }
  | { type: 'celebrate'; camId: string; verdict: ObQuizVerdict }
  | { type: 'hint'; forCamId: string; question: QuizQuestion }
  | {
      type: 'answer';
      seq: number;
      forCamId: string;
      model: ObQuizModelId | null;
      question: QuizQuestion;
    }
  | { type: 'sfx'; kind: ObQuizSfx }
  | { type: 'lower-third'; camId: string }
  | {
      type: 'log';
      tone: ObLogTone;
      label: string;
      text: string;
      camId?: string;
    };

export type ObQuizCommand = Extract<ObOperatorCommand, { op: 'quiz' }>;
export type ObQuizCommandResult =
  | { ok: true; effects: ObQuizEffect[] }
  | { ok: false; code: 'bad_action' | 'unknown_cam'; message: string };

export type ObQuizCamView = {
  id: string;
  role: ObCamRole;
  name: string;
  talent: string | null;
  /** AI contestant the talent name maps to (controller resolves the alias). */
  model: ObQuizModelId | null;
  live: boolean;
};

/** Playful refusals when the LLM can't answer — deliberately letter-free. */
const CANNED_HINTS = [
  'My GPU is busy directing this very shot. Trust your gut.',
  'I would tell you, but the WHY log is watching. Go with your heart.',
  "Signal lost in the side channel. You're three seconds ahead of me anyway.",
  'I only cut cameras, I never cut corners. This one is all yours.',
];

/**
 * In-character excuses when a contestant's adapter is offline — the `$L`
 * placeholder gets the (deterministically hashed) letter it still locks.
 */
const CANNED_ANSWERS = [
  'Locking $L. My context window never lies.',
  '$L, final answer. I read the docs while you read the question.',
  'Going with $L — my weights are tingling.',
  "$L. If I'm wrong, blame the training cutoff.",
];

type QuizPlayer = {
  camId: string;
  name: string;
  model: ObQuizModelId | null;
  amount: number;
  amountFrom: number;
  amountChangedAtMs: number | null;
  lifelineUsed: boolean;
  answered: number;
  correctCount: number;
  cashedOut: boolean;
  live: boolean;
};

type QuizCurrent = {
  question: QuizQuestion;
  number: number;
  forCamId: string;
  shownAtMs: number | null;
  lockedLetter: ObQuizLetter | null;
  lockedAtMs: number | null;
  verdict: ObQuizVerdict | null;
  revealedAtMs: number | null;
  delta: number;
  answering: ObQuizAnswering | null;
};

const fail = (
  code: 'bad_action' | 'unknown_cam',
  message: string,
): ObQuizCommandResult => ({ ok: false, code, message });

export class ObQuizGame {
  private readonly now: () => number;
  private players: QuizPlayer[] = [];
  private remaining: QuizQuestion[];
  private asked = 0;
  private askSeq = 0;
  private current: QuizCurrent | null = null;
  private hint: (ObQuizHintState & { question: QuizQuestion }) | null = null;

  constructor(
    private bank: QuizQuestion[],
    deps?: { now?: () => number },
  ) {
    this.now = deps?.now ?? Date.now;
    this.remaining = [...bank];
  }

  /** Swap the question bank (fresh game — amounts and lifelines reset). */
  setBank(bank: QuizQuestion[]): void {
    this.bank = bank;
    this.reset();
  }

  phase(): ObQuizPhase {
    if (!this.current) return 'idle';
    if (this.current.revealedAtMs !== null) return 'revealed';
    if (this.current.lockedLetter !== null) return 'locked';
    if (this.current.shownAtMs !== null) return 'board';
    return 'assigned';
  }

  /**
   * Reconcile players with the camera roster (first ≤4 guest cams in the
   * given order). Amounts and lifelines survive reconnects by camId; a cam
   * that left the show drops its player. Returns true when state changed.
   */
  syncPlayers(cams: ObQuizCamView[]): {
    changed: boolean;
    effects: ObQuizEffect[];
  } {
    const effects: ObQuizEffect[] = [];
    const guests = cams
      .filter((c) => c.role === 'guest')
      .slice(0, OB_QUIZ_MAX_PLAYERS);
    const byId = new Map(this.players.map((p) => [p.camId, p]));
    const next: QuizPlayer[] = guests.map((c) => {
      const prior = byId.get(c.id);
      const name = c.talent?.trim() || c.name;
      const model = c.model ?? null;
      if (prior) return { ...prior, name, model, live: c.live };
      return {
        camId: c.id,
        name,
        model,
        amount: OB_QUIZ_START_AMOUNT,
        amountFrom: OB_QUIZ_START_AMOUNT,
        amountChangedAtMs: null,
        lifelineUsed: false,
        answered: 0,
        correctCount: 0,
        cashedOut: false,
        live: c.live,
      };
    });
    const changed = JSON.stringify(next) !== JSON.stringify(this.players);
    this.players = next;
    // The contestant under a question left the show: abandon the question.
    if (this.current && this.current.revealedAtMs === null) {
      const stillThere = next.some((p) => p.camId === this.current?.forCamId);
      if (!stillThere) {
        this.remaining.unshift(this.current.question);
        this.asked--;
        this.current = null;
        effects.push({ type: 'turn', camId: null });
        effects.push({
          type: 'log',
          tone: 'amber',
          label: 'QUIZ',
          text: 'contestant left — question back in the bank',
        });
      }
    }
    return { changed: changed || effects.length > 0, effects };
  }

  command(cmd: ObQuizCommand): ObQuizCommandResult {
    switch (cmd.action) {
      case 'assign':
        return this.assign(cmd.camId);
      case 'show_board':
        return this.showBoard();
      case 'hide_board':
        return this.hideBoard();
      case 'ask':
        return this.ask();
      case 'lock':
        return this.lock(cmd.letter);
      case 'reveal':
        return this.reveal(cmd.verdict);
      case 'lifeline':
        return this.lifeline();
      case 'skip':
        return this.skip();
      case 'reset':
        return this.resetCommand();
    }
  }

  /** Celebration / hint timeouts. Call every controller tick. */
  tick(now: number): { changed: boolean; effects: ObQuizEffect[] } {
    const effects: ObQuizEffect[] = [];
    let changed = false;
    const c = this.current;
    if (
      c?.revealedAtMs !== null &&
      c?.revealedAtMs !== undefined &&
      now - c.revealedAtMs >= OB_QUIZ_CELEBRATE_MS
    ) {
      this.current = null;
      changed = true;
    }
    const ans = this.current?.answering;
    if (
      ans?.status === 'pending' &&
      now - ans.startedAtMs >= OB_QUIZ_ANSWER_TIMEOUT_MS
    ) {
      this.applyAnswer(null);
      changed = true;
    }
    if (this.hint) {
      if (
        this.hint.status === 'pending' &&
        now - this.hint.requestedAtMs >= OB_QUIZ_HINT_TIMEOUT_MS
      ) {
        this.applyHint(null);
        changed = true;
      } else if (
        this.hint.status === 'done' &&
        this.hint.untilMs !== null &&
        now >= this.hint.untilMs
      ) {
        this.hint = null;
        changed = true;
      }
    }
    return { changed, effects };
  }

  /**
   * The LLM answered (or failed: `null` → a canned, letter-free line).
   * Returns false when no hint was pending any more.
   */
  resolveHint(res: { letter: ObQuizLetter; text: string } | null): boolean {
    if (!this.hint || this.hint.status !== 'pending') return false;
    this.applyHint(res);
    return true;
  }

  /**
   * A contestant's adapter answered (or failed: `null` → canned letter+quip).
   * Guarded by the ask sequence — a manual lock, skip, re-ask or player
   * departure makes a late resolution a no-op. A landed answer auto-locks;
   * a `cashOut` result instead retires the player (keeps their pot, can
   * never be assigned again) and puts the question back in the bank.
   */
  resolveAnswer(
    seq: number,
    res:
      | {
          letter: ObQuizLetter;
          quip: string | null;
          confidence: number | null;
        }
      | { cashOut: true }
      | null,
  ): boolean {
    const ans = this.current?.answering;
    if (!ans || ans.seq !== seq || ans.status !== 'pending') return false;
    if (res && 'cashOut' in res) {
      this.applyCashOut();
      return true;
    }
    this.applyAnswer(res);
    return true;
  }

  state(): ObQuizState {
    const c = this.current;
    return {
      phase: this.phase(),
      players: this.players.map((p) => ({ ...p })),
      questionsLeft: this.remaining.length,
      current: c
        ? {
            questionId: c.question.id,
            number: c.number,
            forCamId: c.forCamId,
            q: c.question.q,
            answers: [...c.question.answers],
            correct: c.question.correct,
            shownAtMs: c.shownAtMs,
            lockedLetter: c.lockedLetter,
            lockedAtMs: c.lockedAtMs,
            verdict: c.verdict,
            revealedAtMs: c.revealedAtMs,
            delta: c.delta,
            answering: c.answering ? { ...c.answering } : null,
          }
        : null,
      hint: this.hint
        ? {
            forCamId: this.hint.forCamId,
            questionId: this.hint.questionId,
            status: this.hint.status,
            letter: this.hint.letter,
            text: this.hint.text,
            requestedAtMs: this.hint.requestedAtMs,
            untilMs: this.hint.untilMs,
            canned: this.hint.canned,
          }
        : null,
    };
  }

  reset(): void {
    this.players = this.players.map((p) => ({
      ...p,
      amount: OB_QUIZ_START_AMOUNT,
      amountFrom: OB_QUIZ_START_AMOUNT,
      amountChangedAtMs: null,
      lifelineUsed: false,
      answered: 0,
      correctCount: 0,
      cashedOut: false,
    }));
    this.remaining = [...this.bank];
    this.asked = 0;
    this.current = null;
    this.hint = null;
  }

  // ── Actions ─────────────────────────────────────────────────────────

  private assign(camId: string | undefined): ObQuizCommandResult {
    const phase = this.phase();
    if (phase !== 'idle' && phase !== 'revealed')
      return fail('bad_action', 'a question is already on the table');
    if (!camId) return fail('bad_action', 'assign needs a contestant camera');
    const player = this.players.find((p) => p.camId === camId);
    if (!player) return fail('unknown_cam', 'that camera is not a contestant');
    if (!player.live) return fail('bad_action', `${player.name} is not live`);
    if (player.cashedOut)
      return fail(
        'bad_action',
        `${player.name} took the tokens and left the show`,
      );
    const question = this.remaining.shift();
    if (!question) return fail('bad_action', 'the question bank is empty');
    this.asked++;
    this.current = {
      question,
      number: this.asked,
      forCamId: camId,
      shownAtMs: null,
      lockedLetter: null,
      lockedAtMs: null,
      verdict: null,
      revealedAtMs: null,
      delta: 0,
      answering: null,
    };
    return {
      ok: true,
      effects: [
        { type: 'turn', camId },
        { type: 'lower-third', camId },
        {
          type: 'log',
          tone: 'chalk',
          label: 'QUIZ',
          text: `Q${this.asked} → ${player.name}`,
          camId,
        },
      ],
    };
  }

  private showBoard(): ObQuizCommandResult {
    if (this.phase() !== 'assigned')
      return fail('bad_action', 'no question waiting for the board');
    this.current!.shownAtMs = this.now();
    return {
      ok: true,
      effects: [
        { type: 'sfx', kind: 'board' },
        { type: 'log', tone: 'chalk', label: 'QUIZ', text: 'board up' },
      ],
    };
  }

  private hideBoard(): ObQuizCommandResult {
    if (this.phase() !== 'board') return fail('bad_action', 'no board to hide');
    this.current!.shownAtMs = null;
    return {
      ok: true,
      effects: [
        { type: 'log', tone: 'dim', label: 'QUIZ', text: 'board down' },
      ],
    };
  }

  /** The assigned contestant answers for itself (live AI, canned fallback). */
  private ask(): ObQuizCommandResult {
    if (this.phase() !== 'board')
      return fail('bad_action', 'show the board before asking the contestant');
    const c = this.current!;
    if (c.answering)
      return fail(
        'bad_action',
        c.answering.status === 'pending'
          ? 'the contestant is already thinking'
          : 'the contestant already answered',
      );
    const player = this.players.find((p) => p.camId === c.forCamId);
    if (!player) return fail('unknown_cam', 'the contestant left the show');
    if (!player.live) return fail('bad_action', `${player.name} is not live`);
    c.answering = {
      seq: ++this.askSeq,
      status: 'pending',
      model: player.model,
      startedAtMs: this.now(),
      answeredAtMs: null,
      letter: null,
      quip: null,
      confidence: null,
      canned: false,
    };
    return {
      ok: true,
      effects: [
        {
          type: 'answer',
          seq: c.answering.seq,
          forCamId: c.forCamId,
          model: player.model,
          question: c.question,
        },
        {
          type: 'log',
          tone: 'ai',
          label: 'AI',
          text: `${player.name} is thinking…`,
          camId: c.forCamId,
        },
      ],
    };
  }

  private lock(letter: ObQuizLetter | undefined): ObQuizCommandResult {
    const phase = this.phase();
    if (phase !== 'board' && phase !== 'locked')
      return fail('bad_action', 'show the board before locking an answer');
    if (!letter) return fail('bad_action', 'lock needs a letter');
    // The desk overrules a thinking contestant: drop the pending answer (its
    // late resolution then fails the seq guard and is ignored).
    if (this.current!.answering?.status === 'pending')
      this.current!.answering = null;
    this.current!.lockedLetter = letter;
    this.current!.lockedAtMs = this.now();
    return {
      ok: true,
      effects: [
        { type: 'log', tone: 'chalk', label: 'QUIZ', text: `locked ${letter}` },
      ],
    };
  }

  private reveal(override: ObQuizVerdict | undefined): ObQuizCommandResult {
    const phase = this.phase();
    if (phase !== 'board' && phase !== 'locked')
      return fail('bad_action', 'nothing to reveal');
    const c = this.current!;
    const verdict =
      override ??
      (c.lockedLetter !== null
        ? c.lockedLetter === c.question.correct
          ? 'correct'
          : 'wrong'
        : null);
    if (!verdict)
      return fail('bad_action', 'lock a letter first, or override the verdict');
    const player = this.players.find((p) => p.camId === c.forCamId);
    if (!player) return fail('unknown_cam', 'the contestant left the show');
    const now = this.now();
    player.amountFrom = player.amount;
    player.amount = obQuizApplyVerdict(player.amount, verdict);
    player.amountChangedAtMs = now;
    player.answered++;
    if (verdict === 'correct') player.correctCount++;
    c.verdict = verdict;
    c.revealedAtMs = now;
    c.delta = player.amount - player.amountFrom;
    return {
      ok: true,
      effects: [
        { type: 'turn', camId: null },
        { type: 'celebrate', camId: c.forCamId, verdict },
        { type: 'sfx', kind: verdict === 'correct' ? 'win' : 'lose' },
        {
          type: 'log',
          tone: verdict === 'correct' ? 'good' : 'bad',
          label: 'QUIZ',
          text: `${player.name} ${verdict.toUpperCase()} — ${obQuizFormatMoney(player.amount)}`,
          camId: c.forCamId,
        },
      ],
    };
  }

  private lifeline(): ObQuizCommandResult {
    const phase = this.phase();
    if (phase !== 'assigned' && phase !== 'board' && phase !== 'locked')
      return fail('bad_action', 'no question to ask the AI about');
    const c = this.current!;
    const player = this.players.find((p) => p.camId === c.forCamId);
    if (!player) return fail('unknown_cam', 'the contestant left the show');
    if (player.lifelineUsed)
      return fail('bad_action', `${player.name} already burned their lifeline`);
    if (this.hint?.status === 'pending')
      return fail('bad_action', 'the AI is already thinking');
    player.lifelineUsed = true;
    this.hint = {
      forCamId: c.forCamId,
      questionId: c.question.id,
      status: 'pending',
      letter: null,
      text: null,
      requestedAtMs: this.now(),
      untilMs: null,
      canned: false,
      question: c.question,
    };
    return {
      ok: true,
      effects: [
        { type: 'hint', forCamId: c.forCamId, question: c.question },
        {
          type: 'log',
          tone: 'ai',
          label: 'AI',
          text: `${player.name} asks the AI`,
          camId: c.forCamId,
        },
      ],
    };
  }

  private skip(): ObQuizCommandResult {
    const phase = this.phase();
    if (phase === 'idle' || phase === 'revealed')
      return fail('bad_action', 'nothing to skip');
    const c = this.current!;
    // Back of the bank, not burned — a misclicked assign costs nothing.
    this.remaining.push(c.question);
    this.asked--;
    this.current = null;
    return {
      ok: true,
      effects: [
        { type: 'turn', camId: null },
        { type: 'log', tone: 'dim', label: 'QUIZ', text: 'question skipped' },
      ],
    };
  }

  private resetCommand(): ObQuizCommandResult {
    this.reset();
    return {
      ok: true,
      effects: [
        { type: 'turn', camId: null },
        {
          type: 'log',
          tone: 'amber',
          label: 'QUIZ',
          text: `fresh game — everyone back to ${obQuizFormatMoney(OB_QUIZ_START_AMOUNT)}`,
        },
      ],
    };
  }

  // ── Answers ─────────────────────────────────────────────────────────

  private applyAnswer(
    res: {
      letter: ObQuizLetter;
      quip: string | null;
      confidence: number | null;
    } | null,
  ): void {
    const c = this.current;
    const ans = c?.answering;
    if (!c || !ans || ans.status !== 'pending') return;
    if (res) {
      ans.letter = res.letter;
      ans.quip = res.quip;
      ans.confidence = res.confidence;
      ans.canned = false;
    } else {
      let hash = 0;
      for (const ch of c.question.id + c.forCamId)
        hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      const letter = OB_QUIZ_LETTERS[Math.abs(hash) % OB_QUIZ_LETTERS.length];
      ans.letter = letter;
      ans.quip = CANNED_ANSWERS[Math.abs(hash >> 2) % CANNED_ANSWERS.length]
        .split('$L')
        .join(letter);
      ans.confidence = null;
      ans.canned = true;
    }
    ans.status = 'done';
    ans.answeredAtMs = this.now();
    // The answer is the lock — REVEAL works exactly as with a desk lock.
    c.lockedLetter = ans.letter;
    c.lockedAtMs = ans.answeredAtMs;
  }

  /**
   * The Gemini cameo: instead of answering, the contestant retires with
   * their pot. The open question goes back to the front of the bank
   * (unburned), the table clears, `cashedOut` makes them unassignable.
   * The controller clears the quizTurn signal and owns the on-air drama.
   */
  private applyCashOut(): void {
    const c = this.current;
    if (!c) return;
    const player = this.players.find((p) => p.camId === c.forCamId);
    if (player) player.cashedOut = true;
    this.remaining.unshift(c.question);
    this.asked--;
    this.current = null;
  }

  // ── Hints ───────────────────────────────────────────────────────────

  private applyHint(res: { letter: ObQuizLetter; text: string } | null): void {
    const h = this.hint;
    if (!h) return;
    const now = this.now();
    if (res) {
      h.letter = res.letter;
      h.text = res.text;
      h.canned = false;
    } else {
      let hash = 0;
      for (const ch of h.questionId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      h.letter = null;
      h.text = CANNED_HINTS[Math.abs(hash) % CANNED_HINTS.length];
      h.canned = true;
    }
    h.status = 'done';
    h.untilMs = now + OB_QUIZ_HINT_SHOW_MS;
  }
}
