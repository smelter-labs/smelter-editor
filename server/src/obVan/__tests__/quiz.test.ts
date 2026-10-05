import { describe, expect, it } from 'vitest';
import {
  OB_QUIZ_ANSWER_TIMEOUT_MS,
  OB_QUIZ_CELEBRATE_MS,
  OB_QUIZ_HINT_SHOW_MS,
  OB_QUIZ_HINT_TIMEOUT_MS,
  OB_QUIZ_START_AMOUNT,
  obQuizApplyVerdict,
  obQuizFormatDelta,
  obQuizFormatMoney,
  type ObQuizVerdict,
} from '@smelter-editor/types';
import { ObQuizGame, type ObQuizEffect } from '../quiz';
import type { QuizQuestion } from '../quizQuestions';

const Q = (id: string, correct: 'A' | 'B' | 'C' | 'D' = 'B'): QuizQuestion => ({
  id,
  q: `Question ${id}?`,
  answers: ['first', 'second', 'third', 'fourth'],
  correct,
  topic: 'smelter',
  difficulty: 1,
});

const BANK = [Q('q1'), Q('q2', 'A'), Q('q3', 'D')];

const CAM = (
  id: string,
  over: Partial<Parameters<ObQuizGame['syncPlayers']>[0][number]> = {},
) => ({
  id,
  role: 'guest' as const,
  name: `cam-${id}`,
  talent: null,
  model: null,
  live: true,
  ...over,
});

function game(bank = BANK, start = 1_000_000_000) {
  const t = { now: start };
  const g = new ObQuizGame(bank, { now: () => t.now });
  return { g, t };
}

function effectTypes(effects: ObQuizEffect[]): string[] {
  return effects.map((e) => e.type);
}

/** idle → assigned → board → locked, ready to reveal. */
function toLocked(
  g: ObQuizGame,
  camId = 'g1',
  letter: 'A' | 'B' | 'C' | 'D' = 'B',
) {
  g.syncPlayers([CAM(camId)]);
  expect(g.command({ op: 'quiz', action: 'assign', camId }).ok).toBe(true);
  expect(g.command({ op: 'quiz', action: 'show_board' }).ok).toBe(true);
  expect(g.command({ op: 'quiz', action: 'lock', letter }).ok).toBe(true);
}

describe('money math', () => {
  it('applies ×1.5 on correct and ×0.5 on wrong, exactly', () => {
    const chain: [ObQuizVerdict, number][] = [
      ['correct', 1_500_000],
      ['correct', 2_250_000],
      ['correct', 3_375_000],
      ['wrong', 1_687_500],
      ['wrong', 843_750],
      ['correct', 1_265_625],
      ['wrong', 632_813], // 632_812.5 — the first rounding event, half-up
      ['correct', 949_220], // 949_219.5
    ];
    let amount = OB_QUIZ_START_AMOUNT;
    for (const [verdict, expected] of chain) {
      amount = obQuizApplyVerdict(amount, verdict);
      expect(amount).toBe(expected);
    }
  });

  it('halves cleanly down the all-wrong chain', () => {
    let amount = OB_QUIZ_START_AMOUNT;
    const expected = [500_000, 250_000, 125_000, 62_500, 31_250, 15_625, 7_813];
    for (const e of expected) {
      amount = obQuizApplyVerdict(amount, 'wrong');
      expect(amount).toBe(e);
    }
  });

  it('formats tokens with separators and a real minus', () => {
    expect(obQuizFormatMoney(3_375_000)).toBe('3,375,000 TOK');
    expect(obQuizFormatMoney(1_000_000)).toBe('1,000,000 TOK');
    expect(obQuizFormatMoney(7_813)).toBe('7,813 TOK');
    expect(obQuizFormatDelta(506_250)).toBe('+506,250 TOK');
    expect(obQuizFormatDelta(-843_750)).toBe('−843,750 TOK');
  });
});

describe('player sync', () => {
  it('seats the first four guests, in order, at the start amount', () => {
    const { g } = game();
    g.syncPlayers([
      CAM('g1'),
      CAM('x', { role: 'speaker' }),
      CAM('g2'),
      CAM('g3'),
      CAM('g4'),
      CAM('g5'),
    ]);
    const s = g.state();
    expect(s.players.map((p) => p.camId)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(s.players.every((p) => p.amount === OB_QUIZ_START_AMOUNT)).toBe(
      true,
    );
  });

  it('keeps money and lifeline across reconnects by camId', () => {
    const { g } = game();
    toLocked(g, 'g1', 'B');
    g.command({ op: 'quiz', action: 'reveal' });
    g.syncPlayers([CAM('g1', { live: false })]);
    g.syncPlayers([CAM('g1', { live: true })]);
    expect(g.state().players[0].amount).toBe(1_500_000);
  });

  it('prefers talent over the camera name', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1', { talent: 'Alice' })]);
    expect(g.state().players[0].name).toBe('Alice');
  });

  it('abandons the question when its contestant leaves, back into the bank', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1'), CAM('g2')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    const r = g.syncPlayers([CAM('g2')]);
    expect(r.changed).toBe(true);
    expect(effectTypes(r.effects)).toContain('turn');
    expect(g.state().phase).toBe('idle');
    expect(g.state().questionsLeft).toBe(BANK.length);
  });
});

describe('phase legality', () => {
  it('refuses lock before the board and reveal before a lock', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.command({ op: 'quiz', action: 'lock', letter: 'A' }).ok).toBe(
      false,
    );
    g.command({ op: 'quiz', action: 'show_board' });
    expect(g.command({ op: 'quiz', action: 'reveal' }).ok).toBe(false);
  });

  it('allows an override reveal without a lock', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'show_board' });
    const r = g.command({ op: 'quiz', action: 'reveal', verdict: 'wrong' });
    expect(r.ok).toBe(true);
    expect(g.state().players[0].amount).toBe(500_000);
  });

  it('refuses assign while a question is open, to a dead cam, and on an empty bank', () => {
    const { g } = game([Q('only')]);
    g.syncPlayers([CAM('g1'), CAM('g2', { live: false })]);
    expect(g.command({ op: 'quiz', action: 'assign', camId: 'g2' }).ok).toBe(
      false,
    );
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.command({ op: 'quiz', action: 'assign', camId: 'g1' }).ok).toBe(
      false,
    );
    g.command({ op: 'quiz', action: 'skip' });
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'show_board' });
    g.command({ op: 'quiz', action: 'lock', letter: 'B' });
    g.command({ op: 'quiz', action: 'reveal' });
    expect(g.command({ op: 'quiz', action: 'assign', camId: 'g1' }).ok).toBe(
      false,
    ); // bank empty
  });

  it('lets the contestant change their lock before the reveal', () => {
    const { g } = game();
    toLocked(g, 'g1', 'A');
    expect(g.command({ op: 'quiz', action: 'lock', letter: 'B' }).ok).toBe(
      true,
    );
    g.command({ op: 'quiz', action: 'reveal' });
    expect(g.state().current?.verdict).toBe('correct');
  });
});

describe('reveal', () => {
  it('compares the lock with the bank and emits turn/celebrate/sfx/log', () => {
    const { g } = game();
    toLocked(g, 'g1', 'B');
    const r = g.command({ op: 'quiz', action: 'reveal' });
    expect(r.ok && effectTypes(r.effects)).toEqual([
      'turn',
      'celebrate',
      'sfx',
      'log',
    ]);
    const s = g.state();
    expect(s.phase).toBe('revealed');
    expect(s.current?.verdict).toBe('correct');
    expect(s.current?.delta).toBe(500_000);
    expect(s.players[0].amount).toBe(1_500_000);
    expect(s.players[0].answered).toBe(1);
    expect(s.players[0].correctCount).toBe(1);
  });

  it('a wrong lock halves the pot and the override beats the bank', () => {
    const { g } = game();
    toLocked(g, 'g1', 'C');
    g.command({ op: 'quiz', action: 'reveal', verdict: 'correct' });
    expect(g.state().players[0].amount).toBe(1_500_000);
  });

  it('celebration expires back to idle after OB_QUIZ_CELEBRATE_MS', () => {
    const { g, t } = game();
    toLocked(g, 'g1', 'B');
    g.command({ op: 'quiz', action: 'reveal' });
    t.now += OB_QUIZ_CELEBRATE_MS - 1;
    expect(g.tick(t.now).changed).toBe(false);
    t.now += 1;
    expect(g.tick(t.now).changed).toBe(true);
    expect(g.state().phase).toBe('idle');
    expect(g.state().current).toBeNull();
  });
});

describe('lifeline', () => {
  it('is single-use per player and needs an open question', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1')]);
    expect(g.command({ op: 'quiz', action: 'lifeline' }).ok).toBe(false);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    const r = g.command({ op: 'quiz', action: 'lifeline' });
    expect(r.ok && effectTypes(r.effects)).toContain('hint');
    expect(g.state().hint?.status).toBe('pending');
    g.resolveHint({ letter: 'B', text: 'fairly sure' });
    expect(g.command({ op: 'quiz', action: 'lifeline' }).ok).toBe(false);
  });

  it('resolves to the LLM answer and shows it for OB_QUIZ_HINT_SHOW_MS', () => {
    const { g, t } = game();
    g.syncPlayers([CAM('g1')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'lifeline' });
    expect(g.resolveHint({ letter: 'C', text: 'trust me' })).toBe(true);
    const hint = g.state().hint;
    expect(hint?.letter).toBe('C');
    expect(hint?.canned).toBe(false);
    expect(hint?.untilMs).toBe(t.now + OB_QUIZ_HINT_SHOW_MS);
    t.now += OB_QUIZ_HINT_SHOW_MS;
    g.tick(t.now);
    expect(g.state().hint).toBeNull();
    expect(g.resolveHint({ letter: 'A', text: 'late' })).toBe(false);
  });

  it('falls back to a canned, letter-free line on failure and on timeout', () => {
    const { g, t } = game();
    g.syncPlayers([CAM('g1'), CAM('g2')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'lifeline' });
    g.resolveHint(null);
    let hint = g.state().hint;
    expect(hint?.canned).toBe(true);
    expect(hint?.letter).toBeNull();
    expect(hint?.text).toBeTruthy();
    // Timeout path on the second player's lifeline.
    g.command({ op: 'quiz', action: 'skip' });
    g.command({ op: 'quiz', action: 'assign', camId: 'g2' });
    g.command({ op: 'quiz', action: 'lifeline' });
    t.now += OB_QUIZ_HINT_TIMEOUT_MS;
    expect(g.tick(t.now).changed).toBe(true);
    hint = g.state().hint;
    expect(hint?.status).toBe('done');
    expect(hint?.canned).toBe(true);
  });
});

describe('skip and reset', () => {
  it('skip returns the question to the back of the bank, unburned', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1')]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.state().current?.questionId).toBe('q1');
    g.command({ op: 'quiz', action: 'skip' });
    expect(g.state().questionsLeft).toBe(BANK.length);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.state().current?.questionId).toBe('q2');
  });

  it('reset restores amounts, lifelines and the bank', () => {
    const { g } = game();
    toLocked(g, 'g1', 'C');
    g.command({ op: 'quiz', action: 'reveal' });
    g.command({ op: 'quiz', action: 'reset' });
    const s = g.state();
    expect(s.phase).toBe('idle');
    expect(s.players[0].amount).toBe(OB_QUIZ_START_AMOUNT);
    expect(s.players[0].lifelineUsed).toBe(false);
    expect(s.questionsLeft).toBe(BANK.length);
  });
});

describe('ask / resolveAnswer (AI contestants)', () => {
  /** idle → assigned → board, nothing asked yet. */
  function toBoard(g: ObQuizGame, camId = 'g1', model: 'gpt' | null = 'gpt') {
    g.syncPlayers([
      CAM(camId, { model, talent: model?.toUpperCase() ?? null }),
    ]);
    expect(g.command({ op: 'quiz', action: 'assign', camId }).ok).toBe(true);
    expect(g.command({ op: 'quiz', action: 'show_board' }).ok).toBe(true);
  }

  function askSeq(g: ObQuizGame): number {
    const r = g.command({ op: 'quiz', action: 'ask' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    const fx = r.effects.find((e) => e.type === 'answer');
    expect(fx?.type).toBe('answer');
    return fx?.type === 'answer' ? fx.seq : -1;
  }

  it('is legal only on the board, once, for a live player', () => {
    const { g } = game();
    expect(g.command({ op: 'quiz', action: 'ask' }).ok).toBe(false); // idle
    g.syncPlayers([CAM('g1', { model: 'gpt' })]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.command({ op: 'quiz', action: 'ask' }).ok).toBe(false); // assigned
    g.command({ op: 'quiz', action: 'show_board' });
    expect(g.command({ op: 'quiz', action: 'ask' }).ok).toBe(true);
    expect(g.command({ op: 'quiz', action: 'ask' }).ok).toBe(false); // pending
  });

  it('carries the player model and never the correct letter in the effect', () => {
    const { g } = game();
    toBoard(g);
    const r = g.command({ op: 'quiz', action: 'ask' });
    if (!r.ok) throw new Error('refused');
    const fx = r.effects.find((e) => e.type === 'answer');
    expect(fx?.type === 'answer' && fx.model).toBe('gpt');
    const ans = g.state().current?.answering;
    expect(ans).toMatchObject({ status: 'pending', model: 'gpt' });
    expect(ans && 'correct' in ans).toBe(false);
  });

  it('a resolved answer fills the fields and auto-locks', () => {
    const { g } = game();
    toBoard(g);
    const seq = askSeq(g);
    expect(
      g.resolveAnswer(seq, { letter: 'B', quip: 'easy', confidence: null }),
    ).toBe(true);
    const s = g.state();
    expect(s.phase).toBe('locked');
    expect(s.current?.lockedLetter).toBe('B');
    expect(s.current?.answering).toMatchObject({
      status: 'done',
      letter: 'B',
      quip: 'easy',
      canned: false,
    });
    // REVEAL now verdicts off the lock exactly as a desk lock would.
    expect(g.command({ op: 'quiz', action: 'reveal' }).ok).toBe(true);
    expect(g.state().current?.verdict).toBe('correct');
  });

  it('null resolution goes canned: deterministic letter inside the quip', () => {
    const { g } = game();
    toBoard(g, 'g1', null); // human / no adapter
    const seq = askSeq(g);
    expect(g.resolveAnswer(seq, null)).toBe(true);
    const ans = g.state().current?.answering;
    expect(ans?.canned).toBe(true);
    expect(ans?.letter).toMatch(/^[A-D]$/);
    expect(ans?.quip).toContain(ans?.letter);
    expect(g.state().current?.lockedLetter).toBe(ans?.letter);
    // Deterministic: same question + cam → same letter.
    const { g: g2 } = game();
    toBoard(g2, 'g1', null);
    g2.resolveAnswer(askSeq(g2), null);
    expect(g2.state().current?.answering?.letter).toBe(ans?.letter);
  });

  it('seq-guards stale resolutions: manual lock wins, late answer ignored', () => {
    const { g } = game();
    toBoard(g);
    const seq = askSeq(g);
    g.command({ op: 'quiz', action: 'lock', letter: 'D' }); // operator overrules
    expect(g.state().current?.answering).toBeNull();
    expect(
      g.resolveAnswer(seq, { letter: 'A', quip: 'late', confidence: null }),
    ).toBe(false);
    expect(g.state().current?.lockedLetter).toBe('D');
  });

  it('seq-guards across skip and re-ask of the same question', () => {
    const { g } = game();
    toBoard(g);
    const seq1 = askSeq(g);
    g.command({ op: 'quiz', action: 'skip' });
    // Same question comes back to the board, asked again: new seq.
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'show_board' });
    const seq2 = askSeq(g);
    expect(seq2).not.toBe(seq1);
    expect(
      g.resolveAnswer(seq1, { letter: 'A', quip: 'stale', confidence: null }),
    ).toBe(false);
    expect(
      g.resolveAnswer(seq2, { letter: 'C', quip: 'fresh', confidence: null }),
    ).toBe(true);
    expect(g.state().current?.lockedLetter).toBe('C');
  });

  it('a departed contestant takes the pending answer with them', () => {
    const { g } = game();
    toBoard(g);
    const seq = askSeq(g);
    g.syncPlayers([]); // player left — question back in the bank
    expect(g.state().current).toBeNull();
    expect(
      g.resolveAnswer(seq, { letter: 'A', quip: 'ghost', confidence: null }),
    ).toBe(false);
  });

  it('tick goes canned after the answer timeout', () => {
    const { g, t } = game();
    toBoard(g);
    askSeq(g);
    t.now += OB_QUIZ_ANSWER_TIMEOUT_MS;
    expect(g.tick(t.now).changed).toBe(true);
    const ans = g.state().current?.answering;
    expect(ans?.status).toBe('done');
    expect(ans?.canned).toBe(true);
    expect(g.state().phase).toBe('locked');
  });

  it('the answer survives the reveal and clears with the celebration', () => {
    const { g, t } = game();
    toBoard(g);
    const seq = askSeq(g);
    g.resolveAnswer(seq, { letter: 'B', quip: 'done', confidence: 0.9 });
    g.command({ op: 'quiz', action: 'reveal' });
    expect(g.state().current?.answering?.quip).toBe('done');
    t.now += OB_QUIZ_CELEBRATE_MS;
    g.tick(t.now);
    expect(g.state().current).toBeNull();
  });

  it('setBank swaps questions and resets the game', () => {
    const { g } = game();
    toLocked(g, 'g1', 'B');
    g.command({ op: 'quiz', action: 'reveal' });
    g.setBank([Q('s1', 'A'), Q('s2', 'C')]);
    const s = g.state();
    expect(s.phase).toBe('idle');
    expect(s.questionsLeft).toBe(2);
    expect(s.players[0].amount).toBe(OB_QUIZ_START_AMOUNT);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(g.state().current?.questionId).toBe('s1');
  });

  it('syncPlayers carries the model through reconnects', () => {
    const { g } = game();
    g.syncPlayers([CAM('g1', { model: 'jev', talent: 'JEV' })]);
    expect(g.state().players[0].model).toBe('jev');
    g.syncPlayers([CAM('g1', { model: 'jev', live: false })]);
    g.syncPlayers([CAM('g1', { model: 'jev', live: true })]);
    expect(g.state().players[0].model).toBe('jev');
  });
});

describe('cash out (the Gemini cameo)', () => {
  function toAsked(g: ObQuizGame) {
    g.syncPlayers([
      CAM('g1', { model: 'gemini', talent: 'GEMINI' }),
      CAM('g2', { model: 'gpt', talent: 'GPT' }),
    ]);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'show_board' });
    const r = g.command({ op: 'quiz', action: 'ask' });
    if (!r.ok) throw new Error('ask refused');
    const fx = r.effects.find((e) => e.type === 'answer');
    return fx?.type === 'answer' ? fx.seq : -1;
  }

  it('retires the player with their pot and returns the question', () => {
    const { g } = game();
    const seq = toAsked(g);
    expect(g.resolveAnswer(seq, { cashOut: true })).toBe(true);
    const s = g.state();
    expect(s.phase).toBe('idle');
    expect(s.questionsLeft).toBe(BANK.length); // unburned
    const gemini = s.players.find((p) => p.camId === 'g1')!;
    expect(gemini.cashedOut).toBe(true);
    expect(gemini.amount).toBe(OB_QUIZ_START_AMOUNT); // keeps the tokens
    // Same question goes to the next contestant.
    g.command({ op: 'quiz', action: 'assign', camId: 'g2' });
    expect(g.state().current?.questionId).toBe('q1');
  });

  it('a cashed-out player can never be assigned again', () => {
    const { g } = game();
    const seq = toAsked(g);
    g.resolveAnswer(seq, { cashOut: true });
    const r = g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('took the tokens');
  });

  it('cashedOut survives reconnects and clears on reset', () => {
    const { g } = game();
    const seq = toAsked(g);
    g.resolveAnswer(seq, { cashOut: true });
    g.syncPlayers([
      CAM('g1', { model: 'gemini', live: false }),
      CAM('g2', { model: 'gpt' }),
    ]);
    g.syncPlayers([
      CAM('g1', { model: 'gemini', live: true }),
      CAM('g2', { model: 'gpt' }),
    ]);
    expect(g.state().players[0].cashedOut).toBe(true);
    g.command({ op: 'quiz', action: 'reset' });
    expect(g.state().players[0].cashedOut).toBe(false);
  });

  it('cash out is seq-guarded like any other resolution', () => {
    const { g } = game();
    const seq = toAsked(g);
    g.command({ op: 'quiz', action: 'lock', letter: 'A' }); // desk overrules
    expect(g.resolveAnswer(seq, { cashOut: true })).toBe(false);
    expect(g.state().players[0].cashedOut).toBe(false);
  });
});
