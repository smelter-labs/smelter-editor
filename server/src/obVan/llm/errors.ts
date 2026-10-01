/**
 * OB Van LLM — one error type for the whole layer. Transport failures from
 * the SDK are mapped to `rate | net | api` by `client.ts`; the brief / wrap /
 * analyst code adds the semantic codes. Routes map codes to HTTP statuses.
 */

export type ObLlmErrorCode =
  /** No API key configured on the server. */
  | 'llm_unavailable'
  /** Per-event run / token budget spent. */
  | 'budget'
  /** Another brief / wrap call is already running. */
  | 'busy'
  /** 429 or 529 (overloaded) — back off. */
  | 'rate'
  /** Connection failure, timeout or a 5xx — transient. */
  | 'net'
  /** Any other API rejection (auth, bad request, not found…) — not transient. */
  | 'api'
  /** The model's ruleset could not be read. */
  | 'invalid_ruleset'
  /** The model did not call the tool, even after one retry. */
  | 'no_tool'
  /** The model declined (`stop_reason: refusal`). */
  | 'refused'
  /** The model answered with no usable text. */
  | 'empty'
  /** Aborted by `kill()` / `dispose()`. */
  | 'aborted';

export class ObLlmError extends Error {
  readonly code: ObLlmErrorCode;
  /** Parser errors (`invalid_ruleset`). */
  readonly details: string[];

  constructor(code: ObLlmErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'ObLlmError';
    this.code = code;
    this.details = details;
  }
}

export function isObLlmError(e: unknown): e is ObLlmError {
  return e instanceof ObLlmError;
}

/** HTTP status for an LLM error (routes). */
export function obLlmErrorStatus(code: ObLlmErrorCode): number {
  switch (code) {
    case 'llm_unavailable':
      return 503;
    case 'invalid_ruleset':
      return 422;
    case 'budget':
      return 429;
    case 'busy':
      return 409;
    default:
      return 502;
  }
}
