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
 * → `reveal` (verdict from the bank, or the operator's override; money ×1.5
 * or ×0.5; celebration solo for `OB_QUIZ_CELEBRATE_MS`) → back to `idle`.
 */
import type {
  ObCamRole,
  ObLogTone,
  ObOperatorCommand,
  ObQuizHintState,
  ObQuizLetter,
  ObQuizPhase,
  ObQuizState,
  ObQuizVerdict,
} from '@smelter-editor/types';
import {
  OB_QUIZ_CELEBRATE_MS,
  OB_QUIZ_HINT_SHOW_MS,
  OB_QUIZ_HINT_TIMEOUT_MS,
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
  | { type: 'sfx'; kind: ObQuizSfx }
  | { type: 'lower-third'; camId: string }
  | { type: 'log'; tone: ObLogTone; label: string; text: string; camId?: string };

export type ObQuizCommand = Extract<ObOperatorCommand, { op: 'quiz' }>;
export type ObQuizCommandResult =
  | { ok: true; effects: ObQuizEffect[] }
  | { ok: false; code: 'bad_action' | 'unknown_cam'; message: string };

export type ObQuizCamView = {
  id: string;
  role: ObCamRole;
  name: string;
  talent: string | null;
  live: boolean;
};

/** Playful refusals when the LLM can't answer — deliberately letter-free. */
const CANNED_HINTS = [
  'My GPU is busy directing this very shot. Trust your gut.',
  'I would tell you, but the WHY log is watching. Go with your heart.',
  "Signal lost in the side channel. You're three seconds ahead of me anyway.",
  'I only cut cameras, I never cut corners. This one is all yours.',
];

type QuizPlayer = {
  camId: string;
  name: string;
  amount: number;
  amountFrom: number;
  amountChangedAtMs: number | null;
  lifelineUsed: boolean;
  answered: number;
  correctCount: number;
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
  private current: QuizCurrent | null = null;
  private hint: (ObQuizHintState & { question: QuizQuestion }) | null = null;

  constructor(
    private readonly bank: QuizQuestion[],
    deps?: { now?: () => number },
  ) {
    this.now = deps?.now ?? Date.now;
    this.remaining = [...bank];
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
  syncPlayers(cams: ObQuizCamView[]): { changed: boolean; effects: ObQuizEffect[] } {
    const effects: ObQuizEffect[] = [];
    const guests = cams
      .filter((c) => c.role === 'guest')
      .slice(0, OB_QUIZ_MAX_PLAYERS);
    const byId = new Map(this.players.map((p) => [p.camId, p]));
    const next: QuizPlayer[] = guests.map((c) => {
      const prior = byId.get(c.id);
      const name = c.talent?.trim() || c.name;
      if (prior) return { ...prior, name, live: c.live };
      return {
        camId: c.id,
        name,
        amount: OB_QUIZ_START_AMOUNT,
        amountFrom: OB_QUIZ_START_AMOUNT,
        amountChangedAtMs: null,
        lifelineUsed: false,
        answered: 0,
        correctCount: 0,
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
    if (this.phase() !== 'board')
      return fail('bad_action', 'no board to hide');
    this.current!.shownAtMs = null;
    return {
      ok: true,
      effects: [
        { type: 'log', tone: 'dim', label: 'QUIZ', text: 'board down' },
      ],
    };
  }

  private lock(letter: ObQuizLetter | undefined): ObQuizCommandResult {
    const phase = this.phase();
    if (phase !== 'board' && phase !== 'locked')
      return fail('bad_action', 'show the board before locking an answer');
    if (!letter) return fail('bad_action', 'lock needs a letter');
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
