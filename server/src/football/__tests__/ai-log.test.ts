import { describe, expect, it } from 'vitest';
import { AI_LOG_CAP, FbAiLog, eventLabel, eventTitle } from '../aiLog';

const line = (text: string) =>
  ({ kind: 'event', tone: 'chalk', label: 'SHOT', text }) as const;

describe('FbAiLog', () => {
  it('numbers the entries, newest first, and drains each batch once', () => {
    const log = new FbAiLog();
    log.push(line('one'), 1000);
    log.push(line('two'), 2000);
    expect(log.snapshot().map((e) => [e.id, e.text, e.atMs])).toEqual([
      [2, 'two', 2000],
      [1, 'one', 1000],
    ]);
    // The flush batch is oldest first and is handed out once.
    expect(log.drain().map((e) => e.text)).toEqual(['one', 'two']);
    expect(log.drain()).toEqual([]);
    // A late spectator still gets the whole log.
    expect(log.snapshot()).toHaveLength(2);
  });

  it('keeps the newest `cap` entries', () => {
    const log = new FbAiLog(3);
    for (let i = 1; i <= 5; i++) log.push(line(`n${i}`), i);
    expect(log.snapshot().map((e) => e.text)).toEqual(['n5', 'n4', 'n3']);
    expect(AI_LOG_CAP).toBe(60);
  });

  it('snapshots are copies', () => {
    const log = new FbAiLog();
    log.push(line('x'), 1);
    log.snapshot()[0].text = 'mutated';
    expect(log.snapshot()[0].text).toBe('x');
  });
});

describe('event wording', () => {
  it('a goal is a question in the log and a statement on air', () => {
    expect(eventLabel('goal')).toEqual({ label: 'GOAL?', tone: 'amber' });
    expect(eventTitle('goal')).toBe('GOAL');
    expect(eventTitle('out')).toBe('OUT OF PLAY');
    expect(eventLabel('goal_kick').label).toBe('GOAL KICK');
  });
});
