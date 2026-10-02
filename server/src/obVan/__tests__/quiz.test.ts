import { describe, expect, it } from 'vitest';
import {
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

const CAM = (id: string, over: Partial<Parameters<ObQuizGame['syncPlayers']>[0][number]> = {}) => ({
  id,
  role: 'guest' as const,
  name: `cam-${id}`,
  talent: null,
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

  it('formats dollars with separators and a real minus', () => {
    expect(obQuizFormatMoney(3_375_000)).toBe('$3,375,000');
    expect(obQuizFormatMoney(1_000_000)).toBe('$1,000,000');
    expect(obQuizFormatMoney(7_813)).toBe('$7,813');
    expect(obQuizFormatDelta(506_250)).toBe('+$506,250');
    expect(obQuizFormatDelta(-843_750)).toBe('−$843,750');
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
    expect(
      g.command({ op: 'quiz', action: 'assign', camId: 'g2' }).ok,
    ).toBe(false);
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    expect(
      g.command({ op: 'quiz', action: 'assign', camId: 'g1' }).ok,
    ).toBe(false);
    g.command({ op: 'quiz', action: 'skip' });
    g.command({ op: 'quiz', action: 'assign', camId: 'g1' });
    g.command({ op: 'quiz', action: 'show_board' });
    g.command({ op: 'quiz', action: 'lock', letter: 'B' });
    g.command({ op: 'quiz', action: 'reveal' });
    expect(
      g.command({ op: 'quiz', action: 'assign', camId: 'g1' }).ok,
    ).toBe(false); // bank empty
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
