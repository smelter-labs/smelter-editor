import { describe, expect, it } from 'vitest';
import {
  OB_PANEL_ANSWER_LEAD_MS,
  OB_PANEL_ANSWER_TIMEOUT_MS,
  OB_PANEL_HISTORY_MAX,
} from '@smelter-editor/types';
import {
  ObPanelDiscussion,
  panelCaptionChunks,
  type ObPanelEffect,
} from '../panel';

const T0 = 1_000_000;

const cam = (
  id: string,
  model: 'opus' | 'gpt' | 'gemini' | null,
  overrides: Partial<{
    role: string;
    name: string;
    talent: string | null;
    live: boolean;
  }> = {},
) => ({
  id,
  role: (overrides.role ?? 'guest') as 'guest',
  name: overrides.name ?? id.toUpperCase(),
  talent: overrides.talent ?? (model ? model.toUpperCase() : null),
  model,
  live: overrides.live ?? true,
});

/** A seated two-model panel. */
function seated() {
  const panel = new ObPanelDiscussion();
  panel.syncSpeakers([cam('cam-opus', 'opus'), cam('cam-gpt', 'gpt')]);
  return panel;
}

const askOf = (effects: ObPanelEffect[]) =>
  effects.find(
    (e): e is Extract<ObPanelEffect, { type: 'ask' }> => e.type === 'ask',
  );
const turnsOf = (effects: ObPanelEffect[]) =>
  effects
    .filter(
      (e): e is Extract<ObPanelEffect, { type: 'turn' }> => e.type === 'turn',
    )
    .map((e) => e.camId);

describe('ObPanelDiscussion · seating', () => {
  it('seats the first opus and gpt guest cams, ignores the rest', () => {
    const panel = new ObPanelDiscussion();
    const r = panel.syncSpeakers([
      cam('cam-h', null, { role: 'speaker', name: 'HOST' }),
      cam('cam-1', 'opus'),
      cam('cam-2', 'gemini'), // not a panel model
      cam('cam-3', 'gpt'),
      cam('cam-4', 'opus'), // duplicate model — first wins
      cam('cam-5', null), // human guest
    ]);
    expect(r.changed).toBe(true);
    const s = panel.state();
    expect(s.speakers.map((x) => [x.model, x.camId])).toEqual([
      ['opus', 'cam-1'],
      ['gpt', 'cam-3'],
    ]);
  });

  it('losing every panelist mid-question drops it and clears the turn', () => {
    const panel = seated();
    panel.hostTurn('What is the meaning of life?', T0 + 5_000, T0);
    expect(panel.phase()).toBe('thinking');
    const r = panel.syncSpeakers([]);
    expect(panel.phase()).toBe('idle');
    expect(turnsOf(r.effects)).toEqual([null]);
  });
});

describe('ObPanelDiscussion · asking', () => {
  it('idle hostTurn emits one ask with history, order and notBeforeMs', () => {
    const panel = seated();
    const fx = panel.hostTurn('Will AI replace directors?', T0 + 6_000, T0);
    const ask = askOf(fx)!;
    expect(ask).toBeTruthy();
    expect(ask.seq).toBe(1);
    expect(ask.question).toBe('Will AI replace directors?');
    expect(ask.history).toEqual([]); // the current question is not history
    expect(ask.order).toEqual(['opus', 'gpt']);
    expect(ask.notBeforeMs).toBe(T0 + 6_000 + OB_PANEL_ANSWER_LEAD_MS);
    expect(panel.phase()).toBe('thinking');
    expect(panel.state().speakers.every((s) => s.status === 'thinking')).toBe(
      true,
    );
  });

  it('who answers first alternates per question', () => {
    const panel = seated();
    const first = askOf(panel.hostTurn('Q1?', T0, T0))!;
    expect(first.order).toEqual(['opus', 'gpt']);
    panel.resolveAnswers(first.seq, [
      { model: 'opus', text: 'a' },
      { model: 'gpt', text: 'b' },
    ]);
    panel.speechStarted(first.seq, 'opus');
    panel.speechEnded(first.seq, 'opus', T0 + 1);
    panel.speechStarted(first.seq, 'gpt');
    panel.speechEnded(first.seq, 'gpt', T0 + 2);
    expect(panel.phase()).toBe('idle');
    const second = askOf(panel.hostTurn('Q2?', T0, T0 + 10))!;
    expect(second.order).toEqual(['gpt', 'opus']);
  });

  it('a question during a question parks as pending — latest wins', () => {
    const panel = seated();
    panel.hostTurn('Q1?', T0, T0);
    panel.hostTurn('Q2, impatient?', T0 + 20_000, T0 + 1_000);
    panel.hostTurn('Q3, final form?', T0 + 25_000, T0 + 2_000);
    const s = panel.state();
    expect(s.question).toBe('Q1?');
    expect(s.pendingQuestion).toBe('Q3, final form?');
  });

  it('the pending question fires after the last answer ends', () => {
    const panel = seated();
    const ask1 = askOf(panel.hostTurn('Q1?', T0, T0))!;
    panel.hostTurn('Q2?', T0 + 20_000, T0 + 1_000);
    panel.resolveAnswers(ask1.seq, [
      { model: 'opus', text: 'a' },
      { model: 'gpt', text: 'b' },
    ]);
    panel.speechStarted(ask1.seq, 'opus');
    panel.speechEnded(ask1.seq, 'opus', T0 + 5_000);
    panel.speechStarted(ask1.seq, 'gpt');
    const fx = panel.speechEnded(ask1.seq, 'gpt', T0 + 9_000);
    const ask2 = askOf(fx)!;
    expect(ask2).toBeTruthy();
    expect(ask2.question).toBe('Q2?');
    expect(ask2.seq).toBe(2);
    // The parked question already aired? No — its air-end is still ahead.
    expect(ask2.notBeforeMs).toBe(T0 + 20_000 + OB_PANEL_ANSWER_LEAD_MS);
    expect(panel.state().pendingQuestion).toBeNull();
  });
});

describe('ObPanelDiscussion · answers', () => {
  it('resolveAnswers is seq-guarded and fills canned lines for failures', () => {
    const panel = seated();
    const ask = askOf(panel.hostTurn('Q?', T0, T0))!;
    expect(panel.resolveAnswers(ask.seq + 5, []).ok).toBe(false);
    const r = panel.resolveAnswers(ask.seq, [
      { model: 'opus', text: 'Real answer.' },
      { model: 'gpt', text: null },
    ]);
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => [l.model, l.canned])).toEqual([
      ['opus', false],
      ['gpt', true],
    ]);
    expect(r.lines[1].text.length).toBeGreaterThan(0);
    expect(panel.phase()).toBe('answering');
    // A second resolve of the same seq is a no-op.
    expect(panel.resolveAnswers(ask.seq, []).ok).toBe(false);
  });

  it('speech brackets move the turn and the statuses', () => {
    const panel = seated();
    const ask = askOf(panel.hostTurn('Q?', T0, T0))!;
    panel.resolveAnswers(ask.seq, [
      { model: 'opus', text: 'a' },
      { model: 'gpt', text: 'b' },
    ]);
    expect(turnsOf(panel.speechStarted(ask.seq, 'opus'))).toEqual(['cam-opus']);
    expect(panel.state().turnCamId).toBe('cam-opus');
    expect(panel.state().speakers.find((s) => s.model === 'opus')?.status).toBe(
      'speaking',
    );
    expect(turnsOf(panel.speechEnded(ask.seq, 'opus', T0 + 1))).toEqual([null]);
    expect(turnsOf(panel.speechStarted(ask.seq, 'gpt'))).toEqual(['cam-gpt']);
    const last = panel.speechEnded(ask.seq, 'gpt', T0 + 2);
    expect(turnsOf(last)).toEqual([null]);
    expect(panel.phase()).toBe('idle');
    expect(panel.state().speakers.every((s) => s.status === 'idle')).toBe(true);
  });

  it('finishWithoutSpeech closes a resolved turn at once (TTS off)', () => {
    const panel = seated();
    const ask = askOf(panel.hostTurn('Q?', T0, T0))!;
    expect(panel.finishWithoutSpeech(ask.seq, T0 + 1).length).toBe(0); // not resolved yet
    panel.resolveAnswers(ask.seq, [
      { model: 'opus', text: 'a' },
      { model: 'gpt', text: 'b' },
    ]);
    panel.finishWithoutSpeech(ask.seq, T0 + 2);
    expect(panel.phase()).toBe('idle');
  });

  it('tick times a stuck question out and promotes the pending one', () => {
    const panel = seated();
    const ask = askOf(panel.hostTurn('Q1?', T0, T0))!;
    panel.hostTurn('Q2?', T0 + 3_000, T0 + 1_000);
    expect(panel.tick(T0 + 1_000).changed).toBe(false);
    const t = panel.tick(T0 + OB_PANEL_ANSWER_TIMEOUT_MS + 1);
    expect(t.changed).toBe(true);
    expect(turnsOf(t.effects)).toEqual([null]);
    const ask2 = askOf(t.effects)!;
    expect(ask2.question).toBe('Q2?');
    // The dead question's late answers land nowhere.
    expect(panel.resolveAnswers(ask.seq, []).ok).toBe(false);
  });
});

describe('ObPanelDiscussion · history', () => {
  it('feeds prior Q&A to the next ask and caps the window', () => {
    const panel = seated();
    const ask1 = askOf(panel.hostTurn('Q1?', T0, T0))!;
    panel.resolveAnswers(ask1.seq, [
      { model: 'opus', text: 'A1 opus' },
      { model: 'gpt', text: 'A1 gpt' },
    ]);
    panel.finishWithoutSpeech(ask1.seq, T0 + 1);
    const ask2 = askOf(panel.hostTurn('Q2?', T0, T0 + 2))!;
    expect(ask2.history).toEqual([
      { speaker: 'host', text: 'Q1?' },
      { speaker: 'opus', text: 'A1 opus' },
      { speaker: 'gpt', text: 'A1 gpt' },
    ]);
    // Cap: run enough rounds that the window saturates.
    let seq = ask2.seq;
    for (let i = 0; i < OB_PANEL_HISTORY_MAX; i++) {
      panel.resolveAnswers(seq, [
        { model: 'opus', text: `a${i}` },
        { model: 'gpt', text: `b${i}` },
      ]);
      panel.finishWithoutSpeech(seq, T0 + 10 + i);
      seq = askOf(panel.hostTurn(`Q${i + 3}?`, T0, T0 + 20 + i))!.seq;
    }
    const lastAsk = panel.state();
    expect(lastAsk.question).toBe(`Q${OB_PANEL_HISTORY_MAX + 2}?`);
    // The next ask sees at most the cap.
    panel.resolveAnswers(seq, [
      { model: 'opus', text: 'x' },
      { model: 'gpt', text: 'y' },
    ]);
    panel.finishWithoutSpeech(seq, T0 + 99);
    const askN = askOf(panel.hostTurn('Final?', T0, T0 + 100))!;
    expect(askN.history.length).toBeLessThanOrEqual(OB_PANEL_HISTORY_MAX);
    // The freshest exchange survived the cap (answer order alternates).
    expect(
      askN.history
        .slice(-2)
        .map((e) => e.text)
        .sort(),
    ).toEqual(['x', 'y']);
  });
});

describe('panelCaptionChunks', () => {
  it('keeps a short line whole', () => {
    expect(panelCaptionChunks('One tidy answer.')).toEqual([
      'One tidy answer.',
    ]);
  });
  it('splits at sentence boundaries under the cap', () => {
    const chunks = panelCaptionChunks(
      'This is the first sentence of the answer, fairly long on its own. And here comes the second one, also quite long indeed.',
    );
    expect(chunks).toEqual([
      'This is the first sentence of the answer, fairly long on its own.',
      'And here comes the second one, also quite long indeed.',
    ]);
  });
  it('breaks an overlong sentence at word boundaries', () => {
    const chunks = panelCaptionChunks('word '.repeat(60).trim(), 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    expect(chunks.join(' ')).toBe('word '.repeat(60).trim());
  });
  it('whitespace-only input gives no chunks', () => {
    expect(panelCaptionChunks('   ')).toEqual([]);
  });
});
