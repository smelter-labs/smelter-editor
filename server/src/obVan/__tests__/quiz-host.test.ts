import { describe, expect, it } from 'vitest';
import { cannedHostLine, createObQuizAi } from '../llm/quizHost';
import type { ObQuizHostEvent } from '../llm/quizHost';

const EVENTS: ObQuizHostEvent[] = [
  { kind: 'intro', eventName: 'SMELTERIONAIRE · AI' },
  { kind: 'assign', name: 'OPUS', number: 3 },
  { kind: 'board' },
  { kind: 'answer', name: 'GPT', letter: 'B', quip: 'easy' },
  {
    kind: 'reveal',
    name: 'GROK',
    verdict: 'correct',
    amountText: '1,500,000 TOK',
  },
  { kind: 'reveal', name: 'JEV', verdict: 'wrong', amountText: '500,000 TOK' },
  { kind: 'cashout', name: 'GEMINI', amountText: '1,000,000 TOK' },
  { kind: 'wrap', leaderName: 'OPUS', amountText: '3,375,000 TOK' },
];

describe('cannedHostLine', () => {
  it('always returns a short, deterministic line', () => {
    for (const evt of EVENTS) {
      const line = cannedHostLine(evt);
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(120);
      expect(cannedHostLine(evt)).toBe(line); // deterministic
    }
  });

  it('weaves the facts into the line', () => {
    expect(cannedHostLine(EVENTS[1])).toContain('OPUS');
    expect(cannedHostLine(EVENTS[1])).toContain('3');
    expect(cannedHostLine(EVENTS[4])).toContain('1,500,000 TOK');
    expect(cannedHostLine(EVENTS[5])).toContain('500,000 TOK');
    expect(cannedHostLine(EVENTS[6])).toContain('GEMINI');
    expect(cannedHostLine(EVENTS[6])).toContain('1,000,000 TOK');
    expect(cannedHostLine(EVENTS[7])).toContain('OPUS');
  });
});

describe('createObQuizAi', () => {
  it('works with zero keys: canned lines, no polish, contestants offline', async () => {
    const ai = createObQuizAi({} as NodeJS.ProcessEnv);
    expect(ai.cannedHostLine(EVENTS[0]).length).toBeGreaterThan(0);
    await expect(ai.polishHostLine(EVENTS[0])).resolves.toBeNull();
    expect(ai.contestants.opus.available()).toBe(false);
    ai.dispose();
  });

  it('never polishes non-intro/reveal beats', async () => {
    const ai = createObQuizAi({
      ANTHROPIC_API_KEY: 'ant-test',
    } as NodeJS.ProcessEnv);
    await expect(ai.polishHostLine(EVENTS[2])).resolves.toBeNull();
    await expect(ai.polishHostLine(EVENTS[3])).resolves.toBeNull();
    ai.dispose();
  });
});
