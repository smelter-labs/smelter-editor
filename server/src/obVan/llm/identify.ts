/**
 * OB Van LLM — host identification. One vision call per candidate: a camera
 * snapshot plus the host's natural-language description, answered through the
 * strict `identify_host` tool. Fast and cheap by design (Haiku-friendly: one
 * ≤640 px JPEG ≈ 300 input tokens, `maxTokens` 300, 10 s timeout, no retry —
 * the controller's cooldowns own the retry policy).
 */
import type { ObLlmClient, ObLlmUsage } from './client';
import { toStrictSchema, type ObLlmToolDef } from './schema';

export type ObIdentifyInput = {
  /** JPEG snapshot of the camera frame (base64, no data: prefix). */
  imageB64: string;
  /** The host's distinguishing description (`config.host.description`). */
  hostDescription: string;
  /** For the prompt and the log, e.g. `CAM 3`. */
  camLabel: string;
};

export type ObIdentifyResult = {
  isHost: boolean;
  /** 0..1 — how sure the model is of its yes / no. */
  confidence: number;
  reason: string;
};

export type ObIdentifyOptions = {
  onUsage?: (usage: ObLlmUsage) => void;
  signal?: AbortSignal;
};

export const OB_IDENTIFY_HOST_TOOL: ObLlmToolDef = {
  name: 'identify_host',
  description:
    'Report whether the show host is visible in the attached camera frame.',
  // toStrictSchema: strict tools reject numeric bounds — it moves them into
  // the description (parseIdentifyResult clamps anyway).
  inputSchema: toStrictSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      isHost: {
        type: 'boolean',
        description:
          'true only when a person matching the host description is clearly visible.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'How sure you are of the isHost answer.',
      },
      reason: {
        type: 'string',
        maxLength: 200,
        description: 'One short sentence: what you saw.',
      },
    },
    required: ['isHost', 'confidence', 'reason'],
  }),
};

/**
 * Fixed system prompt (a stable prefix caches across identify calls; the
 * per-call description lives in the user turn).
 */
export const OB_IDENTIFY_SYSTEM = `You verify whether the show HOST is visible in a single camera frame of a live multi-camera broadcast.
You are given the host's distinguishing description and one frame. People other than the host may be in the shot; the frame may be dark, blurry or sideways-lit.
Answer ONLY by calling the identify_host tool. Say isHost=true only when a person clearly matching the description is visible; when in doubt, answer isHost=false with low confidence.`;

export function buildIdentifyUser(
  input: Pick<ObIdentifyInput, 'hostDescription' | 'camLabel'>,
): string {
  return [
    `Host description: ${input.hostDescription}`,
    `Camera: ${input.camLabel}`,
    'Is the host visible in this frame? Call identify_host.',
  ].join('\n');
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tool input → result; null when the shape is off (strict should prevent it). */
export function parseIdentifyResult(raw: unknown): ObIdentifyResult | null {
  if (!isRec(raw)) return null;
  if (typeof raw.isHost !== 'boolean') return null;
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0;
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : '';
  return { isHost: raw.isHost, confidence, reason };
}

/**
 * One identify call; `null` when the model refused or answered without the
 * tool (usage was still spent and reported through `onUsage`).
 */
export async function identifyHost(
  client: ObLlmClient,
  input: ObIdentifyInput,
  opts: ObIdentifyOptions = {},
): Promise<ObIdentifyResult | null> {
  const result = await client.call({
    system: OB_IDENTIFY_SYSTEM,
    user: buildIdentifyUser(input),
    images: [{ mediaType: 'image/jpeg', dataB64: input.imageB64 }],
    tool: OB_IDENTIFY_HOST_TOOL,
    maxTokens: 300,
    effort: 'low',
    timeoutMs: 10_000,
    signal: opts.signal,
  });
  opts.onUsage?.(result.usage);
  return parseIdentifyResult(result.toolInput);
}
