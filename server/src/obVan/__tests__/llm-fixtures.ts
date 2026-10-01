/** Shared fixtures for the OB Van LLM tests (no network). */
import type { ObSituation } from '../contracts';
import type {
  ObLlmCallInput,
  ObLlmCallResult,
  ObLlmClient,
} from '../llm/client';
import type { ObTimers } from '../llm/analyst';

type Cam = ObSituation['cams'][number];

export function cam(
  number: number,
  role: Cam['role'],
  talent: string | null = null,
  over: Partial<Cam> = {},
): Cam {
  return {
    number,
    camId: `c${number}`,
    name: `CAM ${number}`,
    role,
    talent,
    live: true,
    onProgram: false,
    onPreview: false,
    signals: { speechShare: 0.2, rmsDb: -30, motion: 0.1, people: 1 },
    ...over,
  };
}

export function situation(over: Partial<ObSituation> = {}): ObSituation {
  return {
    atMs: 100_000,
    phase: 'on-air',
    eventName: 'Panel',
    brief: 'A panel about live video.',
    presetId: 'talk',
    segment: { index: 0, title: 'Intro' },
    rundown: ['Intro', 'Panel', 'Q&A'],
    cams: [
      cam(1, 'wide', null, { onProgram: true }),
      cam(2, 'speaker', 'Anna Kowalska'),
      cam(3, 'guest', null),
    ],
    program: {
      shot: { kind: 'solo', cam: 'c1' },
      sinceMs: 90_000,
      source: 'auto',
    },
    pacing: { minHoldMs: 2500, maxHoldMs: 20000 },
    lowerThird: null,
    lastCuts: [],
    ...over,
  };
}

export const USAGE = { in: 1000, out: 200, cacheRead: 3000, cacheWrite: 0 };

type Reply =
  | Partial<ObLlmCallResult>
  | Error
  | Promise<Partial<ObLlmCallResult>>;

/** Scripted `ObLlmClient`: each `call()` consumes the next reply. */
export class FakeLlmClient implements ObLlmClient {
  readonly model: string;
  readonly calls: ObLlmCallInput[] = [];
  private readonly replies: Reply[] = [];

  constructor(model = 'claude-sonnet-5') {
    this.model = model;
  }

  reply(...r: Reply[]): this {
    this.replies.push(...r);
    return this;
  }

  /** Reply with a tool call. */
  tool(toolInput: unknown): this {
    return this.reply({ toolInput, stopReason: 'tool_use' });
  }

  async call(input: ObLlmCallInput): Promise<ObLlmCallResult> {
    this.calls.push(input);
    const next = this.replies.shift();
    if (next === undefined) throw new Error('FakeLlmClient: no scripted reply');
    if (next instanceof Error) throw next;
    const r = await next;
    return {
      toolInput: null,
      text: '',
      usage: USAGE,
      stopReason: 'end_turn',
      attempts: 1,
      ...r,
    };
  }
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Timers that never fire on their own; `fire()` runs the registered callback. */
export class ManualTimers implements ObTimers {
  active: { fn: () => void; ms: number } | null = null;
  started = 0;
  setInterval = (fn: () => void, ms: number): unknown => {
    this.started++;
    this.active = { fn, ms };
    return this.active;
  };
  clearInterval = (h: unknown): void => {
    if (h === this.active) this.active = null;
  };
  fire(): void {
    this.active?.fn();
  }
}

/** Let pending promise callbacks run. */
export const flush = () => new Promise((r) => setImmediate(r));
