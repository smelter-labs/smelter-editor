/**
 * OB Van LLM — the one place that talks to the Claude API.
 *
 * `ObLlmClient.call()` makes a single-turn Messages request with an optional
 * single strict tool:
 * - the system prompt is one text block with `cache_control: ephemeral`
 *   (tools render before system, so the stable tool + system prefix caches);
 * - `tool_choice: auto` (+ `disable_parallel_tool_use`) and ONE retry with an
 *   explicit instruction when the model answers without calling the tool;
 * - `output_config.effort` per call (omitted on models that reject it, e.g.
 *   Haiku 4.5), thinking left at the model default;
 * - `maxRetries: 0` by default — the analyst has its own backoff, the brief
 *   opts into one SDK retry;
 * - transport errors are mapped to `ObLlmError` codes `rate | net | api`.
 *
 * `stop_reason: 'refusal'` and "no tool call" are NOT thrown here — the
 * result carries them (usage was spent) and the caller decides.
 */
import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { ObLlmError } from './errors';
import type { ObLlmToolDef } from './schema';

/** Default model (see `OB_VAN_LLM_MODEL`); the UI can switch it at runtime. */
export const OB_LLM_DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * `output_config.effort` is rejected with a 400 on Haiku 4.5 / Sonnet 4.5
 * (adaptive-thinking models accept it) — omit the field there.
 */
export function obLlmModelSupportsEffort(model: string): boolean {
  return !/haiku|sonnet-4-5/.test(model);
}

export type ObLlmEffort = 'low' | 'medium' | 'high';

export type ObLlmImage = { mediaType: 'image/jpeg'; dataB64: string };

export type ObLlmCallInput = {
  system: string;
  user: string;
  /** Images placed before the user text (host identify snapshots). */
  images?: ObLlmImage[];
  /** One strict tool; omitted = plain text answer. */
  tool?: ObLlmToolDef;
  /**
   * 'required' forces the tool call (no "answered without actions" retry,
   * so worst-case latency never doubles); default 'auto' + one nudge retry.
   */
  toolChoice?: 'auto' | 'required';
  maxTokens: number;
  effort: ObLlmEffort;
  timeoutMs: number;
  /** SDK retries on 408/409/429/5xx/connection errors (default 0). */
  retries?: number;
  signal?: AbortSignal;
};

export type ObLlmUsage = {
  /** Uncached input tokens. */
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ObLlmCallResult = {
  /** The tool's input when the tool was called (already JSON-parsed by the SDK). */
  toolInput: unknown | null;
  /** Concatenated text blocks of the final attempt. */
  text: string;
  /** Summed over all attempts (each attempt is billed). */
  usage: ObLlmUsage;
  stopReason: string | null;
  attempts: number;
};

export interface ObLlmClient {
  readonly model: string;
  /** Switch the model for later calls (calls in flight keep theirs). */
  setModel?(model: string): void;
  call(input: ObLlmCallInput): Promise<ObLlmCallResult>;
}

export const OB_LLM_ZERO_USAGE: ObLlmUsage = {
  in: 0,
  out: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function addObLlmUsage(a: ObLlmUsage, b: ObLlmUsage): ObLlmUsage {
  return {
    in: a.in + b.in,
    out: a.out + b.out,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Map anything thrown by the SDK (or our own code) to an `ObLlmError`. */
export function toObLlmError(e: unknown): ObLlmError {
  if (e instanceof ObLlmError) return e;
  if (e instanceof APIUserAbortError)
    return new ObLlmError('aborted', 'LLM call aborted');
  // APIConnectionTimeoutError extends APIConnectionError.
  if (e instanceof APIConnectionError)
    return new ObLlmError('net', `LLM connection failed: ${e.message}`);
  if (e instanceof RateLimitError)
    return new ObLlmError('rate', `LLM rate limited: ${e.message}`);
  if (e instanceof InternalServerError) {
    // 529 = overloaded: treat like a rate limit (back off longer).
    return e.status === 529
      ? new ObLlmError('rate', `LLM overloaded: ${e.message}`)
      : new ObLlmError('net', `LLM server error ${e.status}: ${e.message}`);
  }
  if (e instanceof APIError)
    return new ObLlmError(
      'api',
      `LLM API error ${e.status ?? ''}: ${e.message}`.trim(),
    );
  if (e instanceof Error && e.name === 'AbortError')
    return new ObLlmError('aborted', 'LLM call aborted');
  return new ObLlmError('net', e instanceof Error ? e.message : String(e));
}

function usageOf(u: Anthropic.Usage): ObLlmUsage {
  return {
    in: u.input_tokens ?? 0,
    out: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

const retryNudge = (tool: string) =>
  `\n\nIMPORTANT: answer ONLY by calling the \`${tool}\` tool with a complete, valid input. Do not answer in plain text.`;

/** The subset of the SDK the client needs (lets tests fake the transport). */
export type ObMessagesApi = {
  create(
    body: Anthropic.MessageCreateParamsNonStreaming,
    options?: { timeout?: number; maxRetries?: number; signal?: AbortSignal },
  ): PromiseLike<Anthropic.Message>;
};

export class AnthropicObLlmClient implements ObLlmClient {
  private currentModel: string;
  private readonly messages: ObMessagesApi;
  /** Set when the API rejected a strict schema; later calls go non-strict. */
  private strictRejected = false;

  constructor(opts: { model: string; messages: ObMessagesApi }) {
    this.currentModel = opts.model;
    this.messages = opts.messages;
  }

  get model(): string {
    return this.currentModel;
  }

  setModel(model: string): void {
    const m = model.trim();
    if (m) this.currentModel = m;
  }

  async call(input: ObLlmCallInput): Promise<ObLlmCallResult> {
    let usage = OB_LLM_ZERO_USAGE;
    let attempts = 0;
    let user = input.user;
    let maxTokens = input.maxTokens;
    const model = this.currentModel;
    const maxAttempts = input.tool ? 2 : 1;
    for (;;) {
      attempts++;
      const message = await this.send(model, input, user, maxTokens);
      usage = addObLlmUsage(usage, usageOf(message.usage));
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const toolUse = input.tool
        ? message.content.find(
            (b): b is Anthropic.ToolUseBlock =>
              b.type === 'tool_use' && b.name === input.tool?.name,
          )
        : undefined;
      const truncated = message.stop_reason === 'max_tokens';
      if (toolUse && !truncated) {
        return {
          toolInput: toolUse.input,
          text,
          usage,
          stopReason: message.stop_reason,
          attempts,
        };
      }
      if (
        !input.tool ||
        message.stop_reason === 'refusal' ||
        attempts >= maxAttempts
      ) {
        return {
          toolInput: null,
          text,
          usage,
          stopReason: message.stop_reason,
          attempts,
        };
      }
      // Retry once: insist on the tool; give more room if the answer was cut off.
      user = input.user + retryNudge(input.tool.name);
      if (truncated) maxTokens = Math.round(maxTokens * 1.5);
    }
  }

  private async send(
    model: string,
    input: ObLlmCallInput,
    user: string,
    maxTokens: number,
  ): Promise<Anthropic.Message> {
    const strict = !this.strictRejected;
    const content: string | Anthropic.ContentBlockParam[] = input.images?.length
      ? [
          ...input.images.map(
            (img): Anthropic.ImageBlockParam => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data: img.dataB64,
              },
            }),
          ),
          { type: 'text', text: user },
        ]
      : user;
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: input.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content }],
      ...(obLlmModelSupportsEffort(model)
        ? { output_config: { effort: input.effort } }
        : {}),
    };
    if (input.tool) {
      body.tools = [
        {
          name: input.tool.name,
          description: input.tool.description,
          input_schema: input.tool.inputSchema,
          strict,
        },
      ];
      body.tool_choice =
        input.toolChoice === 'required'
          ? {
              type: 'tool',
              name: input.tool.name,
              disable_parallel_tool_use: true,
            }
          : { type: 'auto', disable_parallel_tool_use: true };
    }
    const options = {
      timeout: input.timeoutMs,
      maxRetries: input.retries ?? 0,
      signal: input.signal,
    };
    try {
      return await this.messages.create(body, options);
    } catch (e) {
      // A 400 on a strict tool most likely means the schema uses a construct
      // the strict compiler rejects: fall back to a plain tool (we validate
      // the input ourselves anyway) and remember it for this process. The
      // API words these as "…: X is not supported" without saying "schema".
      if (
        e instanceof BadRequestError &&
        strict &&
        input.tool &&
        /schema|strict|not supported/i.test(e.message)
      ) {
        console.warn(
          `[ob-van][llm] strict tool schema rejected, retrying non-strict: ${e.message}`,
        );
        this.strictRejected = true;
        return this.send(model, input, user, maxTokens);
      }
      throw toObLlmError(e);
    }
  }
}

/**
 * The real client, or `null` when `ANTHROPIC_API_KEY` is not set (the UI shows
 * "LLM OFF" and presets keep working). Initial model: `OB_VAN_LLM_MODEL` or
 * `claude-haiku-4-5`; the panel can switch it per room.
 */
export function createObLlmClient(
  env: NodeJS.ProcessEnv = process.env,
): ObLlmClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.OB_VAN_LLM_MODEL?.trim() || OB_LLM_DEFAULT_MODEL;
  const sdk = new Anthropic({ apiKey });
  return new AnthropicObLlmClient({ model, messages: sdk.messages });
}
