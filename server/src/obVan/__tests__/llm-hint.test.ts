import { describe, expect, it } from 'vitest';
import {
  OB_QUIZ_HINT_TOOL,
  buildQuizHintUser,
  parseQuizHintResult,
  quizHint,
} from '../llm/hint';
import { FakeLlmClient, USAGE } from './llm-fixtures';

const INPUT = {
  question: 'The shaders on this stream are written in…',
  answers: ['CSS', 'GLSL', 'WGSL', 'Excel formulas'] as [
    string,
    string,
    string,
    string,
  ],
};

describe('quizHint', () => {
  it('asks blind — the prompt carries the question and answers, never a correct letter', async () => {
    const client = new FakeLlmClient().tool({
      answer: 'C',
      quip: "I'm fairly sure it's C — that's what my overlays are written in.",
    });
    const result = await quizHint(client, INPUT);
    expect(result?.letter).toBe('C');
    expect(result?.text).toContain('fairly sure');
    const call = client.calls[0];
    expect(call.tool).toBe(OB_QUIZ_HINT_TOOL);
    expect(call.user).toContain('WGSL');
    expect(call.user.toLowerCase()).not.toContain('correct answer:');
    expect(call.system.toLowerCase()).toContain('not told the correct answer');
  });

  it('keeps whatever letter the model picked — wrong is part of the show', async () => {
    const client = new FakeLlmClient().tool({
      answer: 'B',
      quip: 'GLSL, obviously.',
    });
    const result = await quizHint(client, INPUT);
    expect(result?.letter).toBe('B');
  });

  it('reports usage and returns null when the model answers without the tool', async () => {
    const client = new FakeLlmClient().reply({
      toolInput: null,
      text: 'I refuse.',
      stopReason: 'end_turn',
    });
    const usages: unknown[] = [];
    const result = await quizHint(client, INPUT, {
      onUsage: (u) => usages.push(u),
    });
    expect(result).toBeNull();
    expect(usages).toEqual([USAGE]);
  });
});

describe('parseQuizHintResult', () => {
  it('rejects bad letters and empty quips', () => {
    expect(parseQuizHintResult({ answer: 'E', quip: 'x' })).toBeNull();
    expect(parseQuizHintResult({ answer: 'A', quip: '   ' })).toBeNull();
    expect(parseQuizHintResult(null)).toBeNull();
    expect(parseQuizHintResult({ answer: 'A', quip: ' go A ' })).toEqual({
      letter: 'A',
      text: 'go A',
    });
  });
});

describe('buildQuizHintUser', () => {
  it('letters the answers A–D', () => {
    const user = buildQuizHintUser(INPUT);
    expect(user).toContain('A. CSS');
    expect(user).toContain('D. Excel formulas');
  });
});
