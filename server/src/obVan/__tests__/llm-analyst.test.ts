import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ObLogEntry,
  ObLlmStatus,
  ObOperatorCommand,
} from '@smelter-editor/types';
import type { ObSituation } from '../contracts';
import {
  analystIntervalFromEnv,
  isKnownName,
  ObAnalyst,
  OB_ANALYST_MAX_BACKOFF_MS,
  parseDirectActions,
} from '../llm/analyst';
import { ObLlmBudget } from '../llm/budget';
import { ObLlmError } from '../llm/errors';
import { createObLlm } from '../llm';
import { ObTranscriptRing } from '../llm/transcripts';
import {
  deferred,
  FakeLlmClient,
  flush,
  ManualTimers,
  situation,
  USAGE,
} from './llm-fixtures';

type Applied = { cmd: ObOperatorCommand; reasons: string[] };
type LogIn = Omit<ObLogEntry, 'id' | 'atMs'>;

function setup(
  opts: {
    situation?: ObSituation;
    limits?: { maxRuns: number; maxInputTokens: number };
  } = {},
) {
  let t = 100_000;
  let sit = opts.situation ?? situation();
  const client = new FakeLlmClient();
  const budget = new ObLlmBudget(
    'claude-sonnet-5',
    opts.limits ?? { maxRuns: 100, maxInputTokens: 1_000_000 },
  );
  const ring = new ObTranscriptRing();
  const applied: Applied[] = [];
  const logs: LogIn[] = [];
  const timers = new ManualTimers();
  const analyst = new ObAnalyst({
    client,
    budget,
    ring,
    getSituation: () => ({ ...sit, atMs: t }),
    apply: (cmd, reasons) => applied.push({ cmd, reasons }),
    log: (e) => logs.push(e),
    onChange: () => undefined,
    now: () => t,
    intervalS: 30,
    timers,
  });
  return {
    client,
    budget,
    ring,
    applied,
    logs,
    timers,
    analyst,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
    setSituation: (s: ObSituation) => {
      sit = s;
    },
    live: () => {
      analyst.setPhase('on-air');
      analyst.setEnabled(true);
    },
  };
}

describe('ObAnalyst gating', () => {
  it('does nothing while disabled or outside on-air', async () => {
    const s = setup();
    expect(await s.analyst.tick()).toBe('disabled');
    s.analyst.setEnabled(true);
    expect(await s.analyst.tick()).toBe('phase');
    s.analyst.setPhase('wrap');
    expect(await s.analyst.tick()).toBe('phase');
    expect(s.client.calls).toHaveLength(0);
  });

  it('skips when the situation hash is unchanged, runs again on new transcript words', async () => {
    const s = setup();
    s.live();
    s.client.tool({ actions: [] }).tool({ actions: [] });
    expect(await s.analyst.tick()).toBe('ran');
    s.advance(30_000);
    expect(await s.analyst.tick()).toBe('unchanged');
    s.ring.push(2, 'So the next slide shows latency.', s.now());
    expect(await s.analyst.tick()).toBe('ran');
    expect(s.client.calls).toHaveLength(2);
    expect(s.client.calls[1].user).toContain(
      '[cam 2] -0s: So the next slide shows latency.',
    );
    expect(s.client.calls[1]).toMatchObject({
      effort: 'low',
      maxTokens: 1500,
      timeoutMs: 25_000,
    });
  });

  it('skips while a call is in flight', async () => {
    const s = setup();
    s.live();
    const d = deferred<{ toolInput: unknown }>();
    s.client.reply(d.promise);
    const first = s.analyst.tick();
    expect(s.analyst.state().busy).toBe(true);
    expect(await s.analyst.tick()).toBe('busy');
    d.resolve({ toolInput: { actions: [] } });
    expect(await first).toBe('ran');
    expect(s.analyst.state().busy).toBe(false);
  });

  it('runs the timer only while enabled and on air', () => {
    const s = setup();
    s.analyst.setEnabled(true);
    expect(s.timers.active).toBeNull();
    s.analyst.setPhase('on-air');
    expect(s.timers.active?.ms).toBe(30_000);
    s.analyst.setIntervalS(5); // clamped to the 10 s minimum
    expect(s.timers.active?.ms).toBe(10_000);
    s.analyst.setPhase('wrap');
    expect(s.timers.active).toBeNull();
  });
});

describe('ObAnalyst actions', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.live();
  });

  it('maps every action to an operator command (source is the llm path)', async () => {
    s.ring.push(3, 'Thanks Łukasz Wójcik for joining us.', s.now() - 5000);
    s.client.tool({
      actions: [
        {
          type: 'set_lower_third',
          cam: 3,
          name: 'Łukasz Wójcik',
          subtitle: 'Guest',
          ms: 6000,
          why: 'new voice',
        },
        { type: 'prefer_cam', cam: 2, forMs: 20000, why: 'Anna leads' },
        { type: 'note', text: 'Good rhythm so far.' },
      ],
    });
    expect(await s.analyst.tick()).toBe('ran');
    expect(s.applied.map((a) => a.cmd)).toEqual([
      {
        op: 'lower_third',
        camId: 'c3',
        name: 'Łukasz Wójcik',
        subtitle: 'Guest',
        ms: 6000,
      },
      { op: 'prefer_cam', camId: 'c2', forMs: 20000 },
      { op: 'note', text: 'Good rhythm so far.' },
    ]);
    expect(s.applied[0].reasons).toEqual(['llm analyst', 'new voice']);
    expect(s.analyst.state().lastNote).toBe('Good rhythm so far.');
  });

  it('applies segment next and pacing', async () => {
    s.client.tool({
      actions: [
        { type: 'advance_segment', why: 'panel started' },
        {
          type: 'set_pacing',
          minHoldMs: 100,
          maxHoldMs: 999_999,
          why: 'slower',
        },
      ],
    });
    await s.analyst.tick();
    expect(s.applied.map((a) => a.cmd)).toEqual([
      { op: 'segment', action: 'next' },
      { op: 'pacing', minHoldMs: 500, maxHoldMs: 60000 }, // clamped to the DSL limits
    ]);
  });

  it('applies at most 3 actions and one per type', async () => {
    s.client.tool({
      actions: [
        { type: 'note', text: 'one' },
        { type: 'note', text: 'two' },
        { type: 'prefer_cam', cam: 1, forMs: 5000, why: 'a' },
        { type: 'set_pacing', minHoldMs: 3000, why: 'b' },
        { type: 'advance_segment', why: 'c' },
      ],
    });
    await s.analyst.tick();
    expect(s.applied.map((a) => a.cmd.op)).toEqual([
      'note',
      'prefer_cam',
      'pacing',
    ]);
    expect(s.logs.at(-1)?.text).toContain('duplicate note ignored');
  });

  it('rejects unknown cameras, names never heard and a segment past the end', async () => {
    s.setSituation(situation({ segment: { index: 2, title: 'Q&A' } }));
    s.client.tool({
      actions: [
        { type: 'prefer_cam', cam: 7, forMs: 5000, why: 'x' },
        { type: 'set_lower_third', cam: 2, name: 'Jan Nowak', why: 'y' },
        { type: 'advance_segment', why: 'z' },
      ],
    });
    await s.analyst.tick();
    expect(s.applied).toEqual([]);
    const log = s.logs.at(-1);
    expect(log).toMatchObject({ source: 'llm', kind: 'llm', tone: 'amber' });
    expect(log?.reasons).toEqual([
      'prefer_cam: camera 7 does not exist',
      'set_lower_third: "Jan Nowak" was not heard or listed as talent',
      'advance_segment: no next segment',
    ]);
  });

  it('accepts a talent-field name for a lower third', async () => {
    s.client.tool({
      actions: [
        {
          type: 'set_lower_third',
          cam: 2,
          name: 'anna kowalska',
          why: 'intro',
        },
      ],
    });
    await s.analyst.tick();
    expect(s.applied[0].cmd).toEqual({
      op: 'lower_third',
      camId: 'c2',
      name: 'anna kowalska',
      subtitle: null,
    });
  });
});

describe('ObAnalyst failures and guardrails', () => {
  it('backs off after a rate error, doubling up to 5 minutes', async () => {
    const s = setup();
    s.live();
    s.client.reply(
      new ObLlmError('rate', '429'),
      new ObLlmError('net', 'reset'),
    );
    expect(await s.analyst.tick()).toBe('error');
    expect(s.analyst.state().backoffUntilMs).toBe(s.now() + 30_000);
    s.advance(10_000);
    expect(await s.analyst.tick()).toBe('backoff');
    s.advance(20_000);
    expect(await s.analyst.tick()).toBe('error');
    expect(s.analyst.state().backoffUntilMs).toBe(s.now() + 60_000);
    for (let i = 0; i < 6; i++) {
      s.advance(OB_ANALYST_MAX_BACKOFF_MS);
      s.client.reply(new ObLlmError('rate', '429'));
      await s.analyst.tick();
    }
    expect(s.analyst.state().backoffUntilMs).toBe(
      s.now() + OB_ANALYST_MAX_BACKOFF_MS,
    );
    // A success clears the backoff.
    s.advance(OB_ANALYST_MAX_BACKOFF_MS);
    s.client.tool({ actions: [] });
    expect(await s.analyst.tick()).toBe('ran');
    expect(s.analyst.state()).toMatchObject({
      backoffUntilMs: null,
      error: null,
      enabled: true,
    });
  });

  it('turns itself off after 3 api errors in a row', async () => {
    const s = setup();
    s.live();
    s.client.reply(
      new ObLlmError('api', 'bad key'),
      new ObLlmError('api', 'bad key'),
      new ObLlmError('api', 'bad key'),
    );
    await s.analyst.tick();
    await s.analyst.tick();
    expect(s.analyst.state().enabled).toBe(true);
    await s.analyst.tick();
    expect(s.analyst.state()).toMatchObject({ enabled: false });
    expect(s.analyst.state().error).toContain('3 API errors');
    expect(s.timers.active).toBeNull();
  });

  it('stops when the budget is spent', async () => {
    const s = setup({ limits: { maxRuns: 1, maxInputTokens: 1_000_000 } });
    s.live();
    s.client.tool({ actions: [] });
    expect(await s.analyst.tick()).toBe('ran');
    expect(s.budget.runs).toBe(1);
    s.ring.push(1, 'new words', s.now());
    expect(await s.analyst.tick()).toBe('budget');
    expect(s.analyst.state().enabled).toBe(false);
    expect(s.analyst.state().error).toContain('run limit');
    expect(s.client.calls).toHaveLength(1);
  });

  it('kill aborts the call in flight and drops its answer', async () => {
    const s = setup();
    s.live();
    const d = deferred<{ toolInput: unknown }>();
    s.client.reply(d.promise);
    const pending = s.analyst.tick();
    const signal = s.client.calls[0].signal;
    s.analyst.kill();
    expect(signal?.aborted).toBe(true);
    d.resolve({ toolInput: { actions: [{ type: 'note', text: 'too late' }] } });
    expect(await pending).toBe('disabled');
    expect(s.applied).toEqual([]);
    expect(s.analyst.state()).toMatchObject({ enabled: false, busy: false });
    expect(await s.analyst.tick()).toBe('disabled');
  });
});

describe('helpers', () => {
  it('parseDirectActions ignores garbage', () => {
    const { actions, rejected } = parseDirectActions({
      actions: [
        { type: 'explode' },
        'x',
        { type: 'prefer_cam', cam: 'two' },
        { type: 'note', text: 'ok' },
      ],
    });
    expect(actions).toEqual([{ type: 'note', text: 'ok' }]);
    expect(rejected).toEqual([
      'invalid explode',
      'unreadable action',
      'invalid prefer_cam',
    ]);
  });

  it('isKnownName keeps diacritics significant but ignores case', () => {
    const cams = situation().cams;
    const lines = [{ camNumber: 1, text: 'Witamy, Łukasz Wójcik!', airMs: 0 }];
    expect(isKnownName('ŁUKASZ WÓJCIK', cams, lines)).toBe(true);
    expect(isKnownName('Lukasz Wojcik', cams, lines)).toBe(false);
  });

  it('reads the interval from the environment, clamped', () => {
    expect(analystIntervalFromEnv({})).toBe(15);
    expect(analystIntervalFromEnv({ OB_VAN_LLM_ANALYST_INTERVAL_S: '5' })).toBe(
      10,
    );
    expect(
      analystIntervalFromEnv({ OB_VAN_LLM_ANALYST_INTERVAL_S: '45' }),
    ).toBe(45);
    expect(
      analystIntervalFromEnv({ OB_VAN_LLM_ANALYST_INTERVAL_S: 'soon' }),
    ).toBe(15);
  });
});

describe('ObTranscriptRing', () => {
  it('keeps a 60 s window and at most 200 lines', () => {
    const ring = new ObTranscriptRing();
    ring.push(1, 'old', 0);
    ring.push(2, 'new', 50_000);
    expect(ring.lines(59_000).map((l) => l.text)).toEqual(['old', 'new']);
    expect(ring.lines(61_000).map((l) => l.text)).toEqual(['new']);
    expect(ring.lastChangeAt).toBe(50_000);
    for (let i = 0; i < 250; i++) ring.push(3, `line ${i}`, 60_000 + i);
    const lines = ring.lines(60_300);
    expect(lines).toHaveLength(200);
    expect(lines.at(-1)?.text).toBe('line 249');
    expect(ring.linesFor(2, 60_300)).toEqual([]);
  });

  it('orders late lines by air time and ignores blanks', () => {
    const ring = new ObTranscriptRing();
    ring.push(1, 'b', 2000);
    ring.push(1, 'a', 1000);
    ring.push(1, '   ', 3000);
    expect(ring.lines(2000).map((l) => l.text)).toEqual(['a', 'b']);
    expect(ring.lastChangeAt).toBe(2000);
  });
});

describe('createObLlm analyst wiring', () => {
  it('ticks from the timer on air, applies through deps and publishes status', async () => {
    const t = 200_000;
    const client = new FakeLlmClient().tool({
      actions: [{ type: 'note', text: 'Wide is idle.' }],
    });
    const applied: Applied[] = [];
    const statuses: ObLlmStatus[] = [];
    const timers = new ManualTimers();
    const llm = createObLlm(
      {
        getSituation: () => situation({ atMs: t }),
        apply: (cmd, reasons) => applied.push({ cmd, reasons }),
        log: vi.fn(),
        onStatus: (st) => statuses.push(st),
        now: () => t,
      },
      client,
      {
        timers,
        intervalS: 20,
        limits: { maxRuns: 10, maxInputTokens: 1_000_000 },
      },
    );
    llm.setAnalyst(true);
    expect(timers.active).toBeNull(); // still in setup
    llm.setPhase('on-air');
    expect(timers.active?.ms).toBe(20_000);
    timers.fire();
    await flush();
    expect(applied).toEqual([
      { cmd: { op: 'note', text: 'Wide is idle.' }, reasons: ['llm analyst'] },
    ]);
    expect(llm.status()).toMatchObject({
      available: true,
      analyst: true,
      intervalS: 20,
      runs: 1,
      tokensIn: USAGE.in + USAGE.cacheRead,
      lastRunAtMs: t,
      lastNote: 'Wide is idle.',
      busy: false,
    });
    expect(statuses.some((st) => st.busy)).toBe(true);
    llm.kill();
    expect(llm.status().analyst).toBe(false);
    expect(timers.active).toBeNull();
  });

  it('resets the budget and transcripts when a new event starts', async () => {
    const client = new FakeLlmClient().reply({ text: 'Solid show.' });
    const llm = createObLlm(
      {
        getSituation: () => situation(),
        apply: vi.fn(),
        log: vi.fn(),
        onStatus: vi.fn(),
      },
      client,
      {
        timers: new ManualTimers(),
        limits: { maxRuns: 1, maxInputTokens: 1_000_000 },
      },
    );
    llm.setPhase('on-air');
    llm.setPhase('wrap');
    const notes = await llm.wrapNotes({
      stats: {
        startedAtMs: 0,
        endedAtMs: 600_000,
        cuts: 40,
        bySource: { operator: 5, auto: 33, llm: 2, system: 0 },
        onAirMsByCam: { c1: 200_000, c2: 400_000 },
        avgHoldMs: 15_000,
      },
      log: [],
      brief: 'panel',
      eventName: 'Panel',
    });
    expect(notes).toBe('Solid show.');
    expect(client.calls[0]).toMatchObject({ effort: 'medium' });
    expect(client.calls[0].tool).toBeUndefined();
    expect(client.calls[0].user).toContain('cam 2 CAM 2 (speaker): 400s');
    const err = await llm
      .wrapNotes({
        stats: {
          startedAtMs: null,
          endedAtMs: null,
          cuts: 0,
          bySource: { operator: 0, auto: 0, llm: 0, system: 0 },
          onAirMsByCam: {},
          avgHoldMs: 0,
        },
        log: [],
        brief: '',
        eventName: 'x',
      })
      .catch((e: unknown) => e);
    expect((err as ObLlmError).code).toBe('budget');
    llm.setPhase('setup');
    expect(llm.status().runs).toBe(0);
  });
});
