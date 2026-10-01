/**
 * OB Van LLM routes (`/room/:roomId/ob-van/llm/*`). Handlers delegate to the
 * room (RoomState → ObVanController → ObLlmModule); `getRoom` is typed with
 * the small `ObLlmRoomApi` so this file does not depend on RoomState.
 *
 * Errors: `ObLlmError` → `{statusCode, code, error, message[, errors]}` with
 * 503 `llm_unavailable`, 422 `invalid_ruleset`, 429 `budget`, 409 `busy`,
 * 502 for upstream failures. Anything else (e.g. unknown room → 404) goes to
 * the global Fastify error handler.
 */
import { STATUS_CODES } from 'node:http';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  OB_CONFIG_LIMITS,
  OB_LLM_MODEL_IDS,
  type ObLlmModelId,
  type ObLlmStatus,
} from '@smelter-editor/types';
import type { ObBriefResult } from './contracts';
import { isObLlmError, obLlmErrorStatus } from './llm/errors';

/** What the routes need from a room (RoomState satisfies it structurally). */
export interface ObLlmRoomApi {
  obLlmBrief(brief: string): Promise<ObBriefResult>;
  obLlmAnalyst(
    enabled: boolean,
    intervalS?: number,
    model?: ObLlmModelId,
  ): ObLlmStatus;
  obLlmStatus(): ObLlmStatus;
  obLlmWrap(): Promise<string>;
  obLlmKill(): ObLlmStatus;
}

type RoomIdParams = { Params: { roomId: string } };

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

const ObLlmBriefBodySchema = Type.Object({
  brief: Type.String({ minLength: 1, maxLength: OB_CONFIG_LIMITS.brief.max }),
});

const ObLlmAnalystBodySchema = Type.Object({
  enabled: Type.Boolean(),
  intervalS: Type.Optional(
    Type.Number({
      minimum: OB_CONFIG_LIMITS.analystIntervalS.min,
      maximum: OB_CONFIG_LIMITS.analystIntervalS.max,
    }),
  ),
  model: Type.Optional(
    Type.Union(OB_LLM_MODEL_IDS.map((id) => Type.Literal(id))),
  ),
});

/** Send an `ObLlmError` as JSON; rethrow anything else. */
function sendLlmError(res: FastifyReply, err: unknown): FastifyReply {
  if (!isObLlmError(err)) throw err;
  const statusCode = obLlmErrorStatus(err.code);
  return res.status(statusCode).send({
    statusCode,
    code: err.code,
    error: STATUS_CODES[statusCode] ?? 'Unknown Error',
    message: err.message,
    ...(err.details.length ? { errors: err.details } : {}),
  });
}

export function registerObVanLlmRoutes(
  routes: FastifyInstance,
  getRoom: (roomId: string) => ObLlmRoomApi,
): void {
  routes.post<RoomIdParams & { Body: Static<typeof ObLlmBriefBodySchema> }>(
    '/room/:roomId/ob-van/llm/brief',
    { schema: { params: RoomIdParamsSchema, body: ObLlmBriefBodySchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van LLM brief', {
        roomId: req.params.roomId,
        chars: req.body.brief.length,
      });
      try {
        const { ruleset, rationale, warnings } = await room.obLlmBrief(
          req.body.brief,
        );
        if (warnings.length)
          console.warn('[request] OB Van LLM brief warnings', warnings);
        return res.status(200).send({ ruleset, rationale, warnings });
      } catch (err) {
        return sendLlmError(res, err);
      }
    },
  );

  routes.post<RoomIdParams & { Body: Static<typeof ObLlmAnalystBodySchema> }>(
    '/room/:roomId/ob-van/llm/analyst',
    { schema: { params: RoomIdParamsSchema, body: ObLlmAnalystBodySchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van LLM analyst', {
        roomId: req.params.roomId,
        enabled: req.body.enabled,
        intervalS: req.body.intervalS,
        model: req.body.model,
      });
      try {
        const status = room.obLlmAnalyst(
          req.body.enabled,
          req.body.intervalS,
          req.body.model,
        );
        return res.status(200).send({ status });
      } catch (err) {
        return sendLlmError(res, err);
      }
    },
  );

  routes.get<RoomIdParams>(
    '/room/:roomId/ob-van/llm/status',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      return res.status(200).send({ status: room.obLlmStatus() });
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/ob-van/llm/wrap',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van LLM wrap notes', {
        roomId: req.params.roomId,
      });
      try {
        const notes = await room.obLlmWrap();
        return res.status(200).send({ notes });
      } catch (err) {
        return sendLlmError(res, err);
      }
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/ob-van/llm/kill',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van LLM kill', { roomId: req.params.roomId });
      return res.status(200).send({ status: room.obLlmKill() });
    },
  );
}
