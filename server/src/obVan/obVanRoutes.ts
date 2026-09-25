/**
 * OB Van REST routes (`/room/:roomId/ob-van/...`). Handlers delegate to the
 * room (RoomState → ObVanController); `getRoom` is typed with the small
 * `ObRoomApi` so this file does not depend on RoomState. Refusals are
 * `{statusCode, code, error, message}` (400 command refused / bad input,
 * 404 unknown camera, 409 wrong phase / busy, 422 invalid ruleset).
 *
 * Schemas: every field a client sends is declared (Fastify strips undeclared
 * ones only under `additionalProperties: false`, which TypeBox objects do not
 * set, but the declared shape is the contract). The command body is a
 * TypeBox union of the whole `ObOperatorCommand` vocabulary; the controller
 * re-validates the semantics (cameras exist and are live, phase).
 */
import { STATUS_CODES } from 'node:http';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  OB_CAM_ROLES,
  OB_CONFIG_LIMITS,
  OB_CONTROL_ACTIONS,
  OB_GRADES,
  OB_PRESET_IDS,
  OB_TRANSITION_TYPES,
  type ObCamRole,
  type ObConfig,
  type ObConfigPatch,
  type ObControlAction,
  type ObErrorCode,
  type ObOperatorCommand,
  type ObRuleset,
  type ObState,
  isObCamRole,
} from '@smelter-editor/types';
import { sanitizeFbMp4FileName } from '../football/mp4CamFileName';
import type { ObCommandResult, ObSimSample } from './ObVanController';

/** What the routes need from a room (RoomState satisfies it structurally). */
export interface ObRoomApi {
  getObState(): ObState;
  setObConfig(patch: ObConfigPatch): ObConfig;
  controlObVan(action: ObControlAction, camId?: string): ObCommandResult;
  operateObVan(cmd: ObOperatorCommand): ObCommandResult;
  setObRuleset(
    raw: unknown,
  ): { ruleset: ObRuleset; warnings: string[] } | { errors: string[] };
  simulateObSignal(camId: string, sample: ObSimSample): ObCommandResult;
  attachObMp4Cam(
    role: ObCamRole,
    fileName: string,
    meta?: { name?: string; talent?: string | null },
  ): Promise<{ camId: string; inputId: string }>;
  adoptObInput(
    inputId: string,
    role: ObCamRole,
    meta?: { name?: string; talent?: string | null },
  ): Promise<{ camId: string }>;
  syncObFileCams(playFromMs?: number): Promise<string[]>;
}

type RoomIdParams = { Params: { roomId: string } };
const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

const literals = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((v) => Type.Literal(v)));

// ── Shared sub-schemas ─────────────────────────────────────────────────────

const CamId = Type.String({ minLength: 1, maxLength: 80 });
const CamRoleSchema = Type.Union([
  literals(OB_CAM_ROLES),
  Type.String({ pattern: '^custom:[\\w .-]{1,24}$' }),
]);
const PipCorner = literals(['tl', 'tr', 'bl', 'br'] as const);
const PipSize = literals(['S', 'M', 'L'] as const);
const AttentionTarget = literals([
  'speaker',
  'largest',
  'ball',
  'centroid',
  'motion',
] as const);
const Zoom = literals(['tight', 'normal', 'wide'] as const);

export const ObShotSchema = Type.Union([
  Type.Object({ kind: Type.Literal('solo'), cam: CamId }),
  Type.Object({
    kind: Type.Literal('split'),
    cams: Type.Tuple([CamId, CamId]),
  }),
  Type.Object({
    kind: Type.Literal('pip'),
    main: CamId,
    inset: CamId,
    corner: Type.Optional(PipCorner),
    size: Type.Optional(PipSize),
  }),
  Type.Object({
    kind: Type.Literal('quad'),
    cams: Type.Array(CamId, { minItems: 1, maxItems: 4 }),
  }),
  Type.Object({
    kind: Type.Literal('grid'),
    cams: Type.Array(CamId, { maxItems: 8 }),
  }),
  Type.Object({
    kind: Type.Literal('speaker-slides'),
    speaker: CamId,
    slides: CamId,
  }),
  Type.Object({
    kind: Type.Literal('virtual'),
    cam: CamId,
    target: Type.Optional(AttentionTarget),
    zoom: Type.Optional(Zoom),
  }),
]);

const TransitionType = literals(OB_TRANSITION_TYPES);
const TransitionSchema = Type.Object({
  type: TransitionType,
  durationMs: Type.Number(),
  holdMs: Type.Optional(Type.Number()),
});
const TransitionPatchSchema = Type.Partial(TransitionSchema);
const EffectsPatchSchema = Type.Object({
  grade: Type.Optional(literals(OB_GRADES)),
  spotlight: Type.Optional(Type.Boolean()),
  softBackground: Type.Optional(Type.Boolean()),
});
const AudioPolicySchema = Type.Union([
  Type.Object({ mode: Type.Literal('follow') }),
  Type.Object({ mode: Type.Literal('master'), cam: CamId }),
  Type.Object({ mode: Type.Literal('mix') }),
]);

export const ObOperatorCommandSchema = Type.Union([
  Type.Object({ op: Type.Literal('preview'), shot: ObShotSchema }),
  Type.Object({
    op: Type.Literal('take'),
    transition: Type.Optional(TransitionSchema),
  }),
  Type.Object({ op: Type.Literal('cut') }),
  Type.Object({
    op: Type.Literal('shot'),
    shot: ObShotSchema,
    mode: literals(['take', 'cut', 'preview'] as const),
  }),
  Type.Object({
    op: Type.Literal('transition'),
    transition: TransitionPatchSchema,
  }),
  Type.Object({ op: Type.Literal('fx'), effects: EffectsPatchSchema }),
  Type.Object({
    op: Type.Literal('lower_third'),
    camId: Type.Optional(CamId),
    name: Type.Optional(Type.String({ maxLength: 60 })),
    subtitle: Type.Optional(
      Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
    ),
    ms: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    clear: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    op: Type.Literal('title_bug'),
    event: Type.Optional(Type.String({ maxLength: 60 })),
    segment: Type.Optional(
      Type.Union([Type.String({ maxLength: 60 }), Type.Null()]),
    ),
    visible: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ op: Type.Literal('audio'), audio: AudioPolicySchema }),
  Type.Object({ op: Type.Literal('auto'), enabled: Type.Boolean() }),
  Type.Object({
    op: Type.Literal('dip'),
    holdMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    op: Type.Literal('segment'),
    action: literals(['next', 'prev', 'goto'] as const),
    index: Type.Optional(Type.Integer()),
  }),
  Type.Object({
    op: Type.Literal('replay'),
    camId: Type.Optional(CamId),
    mediaMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    op: Type.Literal('cam'),
    action: literals(['role', 'name', 'talent', 'kick'] as const),
    camId: CamId,
    value: Type.Optional(Type.String({ maxLength: 60 })),
  }),
  Type.Object({
    op: Type.Literal('pacing'),
    minHoldMs: Type.Optional(Type.Number()),
    maxHoldMs: Type.Optional(Type.Number()),
    clear: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    op: Type.Literal('prefer_cam'),
    camId: CamId,
    forMs: Type.Number(),
    boost: Type.Optional(Type.Number()),
  }),
  Type.Object({
    op: Type.Literal('note'),
    text: Type.String({ minLength: 1, maxLength: 240 }),
  }),
]);

const RundownItemSchema = Type.Object({
  id: Type.String({ maxLength: 40 }),
  title: Type.String({ maxLength: 60 }),
  preset: Type.Optional(literals(OB_PRESET_IDS)),
});

/** `ruleset` is parsed by the controller (`parseObRuleset`), so it is `Any` here. */
const ObConfigPatchSchema = Type.Object({
  eventName: Type.Optional(
    Type.String({ maxLength: OB_CONFIG_LIMITS.eventName.max }),
  ),
  presetId: Type.Optional(literals([...OB_PRESET_IDS, 'custom'] as const)),
  ruleset: Type.Optional(Type.Any()),
  pacingDial: Type.Optional(literals(['calm', 'lively', 'frantic'] as const)),
  autoPilot: Type.Optional(Type.Boolean()),
  resumeAfterMs: Type.Optional(Type.Number()),
  transition: Type.Optional(TransitionPatchSchema),
  audio: Type.Optional(AudioPolicySchema),
  effects: Type.Optional(EffectsPatchSchema),
  lowerThirdMs: Type.Optional(Type.Number()),
  titleBugVisible: Type.Optional(Type.Boolean()),
  captions: Type.Optional(Type.Boolean()),
  brief: Type.Optional(Type.String({ maxLength: OB_CONFIG_LIMITS.brief.max })),
  rundown: Type.Optional(
    Type.Array(RundownItemSchema, { maxItems: OB_CONFIG_LIMITS.rundown.max }),
  ),
  llm: Type.Optional(
    Type.Object({
      analyst: Type.Optional(Type.Boolean()),
      analystIntervalS: Type.Optional(Type.Number()),
    }),
  ),
  joinUrls: Type.Optional(
    Type.Object({ cam: Type.Optional(Type.String({ maxLength: 2048 })) }),
  ),
});

const ControlSchema = Type.Object({
  action: literals(OB_CONTROL_ACTIONS),
  camId: Type.Optional(CamId),
});
const OperateSchema = Type.Object({ cmd: ObOperatorCommandSchema });
const Mp4CamSchema = Type.Object({
  role: CamRoleSchema,
  fileName: Type.String({ maxLength: 512 }),
  name: Type.Optional(Type.String({ maxLength: 40 })),
  talent: Type.Optional(
    Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  ),
});
const Mp4SyncSchema = Type.Object({
  playFromMs: Type.Optional(Type.Number({ minimum: 0 })),
});
const AdoptSchema = Type.Object({
  inputId: Type.String({ minLength: 1, maxLength: 200 }),
  role: CamRoleSchema,
  name: Type.Optional(Type.String({ maxLength: 40 })),
  talent: Type.Optional(
    Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  ),
});
const RulesetSchema = Type.Object({ ruleset: Type.Any() });

const BoxSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  w: Type.Number(),
  h: Type.Number(),
  conf: Type.Optional(Type.Number()),
});
const SimulateSchema = Type.Object({
  camId: CamId,
  sample: Type.Union([
    Type.Object({
      kind: Type.Literal('audio'),
      rms: Type.Number(),
      speechProb: Type.Number(),
      speech: Type.Boolean(),
      onset: Type.Boolean(),
      bands: Type.Optional(Type.Array(Type.Number(), { maxItems: 8 })),
    }),
    Type.Object({
      kind: Type.Literal('video'),
      frameW: Type.Number(),
      frameH: Type.Number(),
      persons: Type.Array(BoxSchema, { maxItems: 32 }),
      ball: Type.Union([BoxSchema, Type.Null()]),
      motion: Type.Number(),
    }),
    Type.Object({
      kind: Type.Literal('transcript'),
      text: Type.String({ minLength: 1, maxLength: 400 }),
    }),
  ]),
});

// ── Error mapping ──────────────────────────────────────────────────────────

function statusOf(code: ObErrorCode): number {
  switch (code) {
    case 'unknown_cam':
      return 404;
    case 'bad_phase':
    case 'replay_busy':
    case 'room_full':
      return 409;
    case 'invalid_ruleset':
      return 422;
    case 'llm_unavailable':
      return 503;
    default:
      return 400;
  }
}

function sendError(
  res: FastifyReply,
  code: ObErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  const statusCode = statusOf(code);
  return res.status(statusCode).send({
    statusCode,
    code,
    error: STATUS_CODES[statusCode] ?? 'Unknown Error',
    message,
    ...extra,
  });
}

const errMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

type Body<S extends TSchema> = RoomIdParams & { Body: Static<S> };

export function registerObVanRoutes(
  routes: FastifyInstance,
  getRoom: (roomId: string) => ObRoomApi,
): void {
  routes.post<Body<typeof ObConfigPatchSchema>>(
    '/room/:roomId/ob-van/config',
    { schema: { params: RoomIdParamsSchema, body: ObConfigPatchSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van config', {
        roomId: req.params.roomId,
        keys: Object.keys(req.body),
      });
      // `ruleset` arrives as `any` (parsed downstream by parseObRuleset).
      const patch: ObConfigPatch = req.body;
      return res.status(200).send({ config: room.setObConfig(patch) });
    },
  );

  routes.post<Body<typeof ControlSchema>>(
    '/room/:roomId/ob-van/control',
    { schema: { params: RoomIdParamsSchema, body: ControlSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van control', {
        roomId: req.params.roomId,
        action: req.body.action,
      });
      const r = room.controlObVan(req.body.action, req.body.camId);
      if (!r.ok) return sendError(res, r.code, r.message);
      return res.status(200).send({ state: room.getObState() });
    },
  );

  routes.get<RoomIdParams>(
    '/room/:roomId/ob-van/state',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) =>
      res.status(200).send({ state: getRoom(req.params.roomId).getObState() }),
  );

  routes.post<Body<typeof OperateSchema>>(
    '/room/:roomId/ob-van/operate',
    { schema: { params: RoomIdParamsSchema, body: OperateSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      // TypeBox's Static of a string-literal union is exactly ObOperatorCommand.
      const cmd: ObOperatorCommand = req.body.cmd;
      const r = room.operateObVan(cmd);
      if (!r.ok) return sendError(res, r.code, r.message);
      return res.status(200).send({ state: room.getObState() });
    },
  );

  routes.post<Body<typeof Mp4CamSchema>>(
    '/room/:roomId/ob-van/mp4-cam',
    { schema: { params: RoomIdParamsSchema, body: Mp4CamSchema } },
    async (req, res) => {
      const fileName = sanitizeFbMp4FileName(req.body.fileName);
      if (!fileName)
        return sendError(
          res,
          'bad_action',
          'fileName must be an .mp4 path relative to data/mp4s',
        );
      const role = req.body.role;
      if (!isObCamRole(role))
        return sendError(res, 'bad_action', 'Unknown camera role.');
      const room = getRoom(req.params.roomId);
      try {
        const { camId, inputId } = await room.attachObMp4Cam(role, fileName, {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.talent !== undefined ? { talent: req.body.talent } : {}),
        });
        return res.status(200).send({ camId, inputId });
      } catch (err) {
        return sendError(res, 'bad_action', errMessage(err));
      }
    },
  );

  routes.post<Body<typeof Mp4SyncSchema>>(
    '/room/:roomId/ob-van/mp4-cam/sync',
    { schema: { params: RoomIdParamsSchema, body: Mp4SyncSchema } },
    async (req, res) => {
      try {
        await getRoom(req.params.roomId).syncObFileCams(
          req.body.playFromMs ?? 0,
        );
        return res.status(200).send({ ok: true });
      } catch (err) {
        return sendError(res, 'bad_action', errMessage(err));
      }
    },
  );

  routes.post<Body<typeof AdoptSchema>>(
    '/room/:roomId/ob-van/adopt-input',
    { schema: { params: RoomIdParamsSchema, body: AdoptSchema } },
    async (req, res) => {
      const role = req.body.role;
      if (!isObCamRole(role))
        return sendError(res, 'bad_action', 'Unknown camera role.');
      const room = getRoom(req.params.roomId);
      try {
        const { camId } = await room.adoptObInput(req.body.inputId, role, {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.talent !== undefined ? { talent: req.body.talent } : {}),
        });
        return res.status(200).send({ camId });
      } catch (err) {
        return sendError(res, 'bad_action', errMessage(err));
      }
    },
  );

  routes.post<Body<typeof RulesetSchema>>(
    '/room/:roomId/ob-van/ruleset',
    { schema: { params: RoomIdParamsSchema, body: RulesetSchema } },
    async (req, res) => {
      const r = getRoom(req.params.roomId).setObRuleset(req.body.ruleset);
      if ('errors' in r)
        return sendError(res, 'invalid_ruleset', r.errors.join('; '), {
          errors: r.errors,
        });
      return res.status(200).send(r);
    },
  );

  // Dev-only signal injector (OB_SIM=1): drive the auto pilot without the worker.
  routes.post<Body<typeof SimulateSchema>>(
    '/room/:roomId/ob-van/simulate-signal',
    { schema: { params: RoomIdParamsSchema, body: SimulateSchema } },
    async (req, res) => {
      if (process.env.OB_SIM !== '1')
        return res.status(404).send({
          statusCode: 404,
          error: STATUS_CODES[404],
          message: 'Not found',
        });
      const r = getRoom(req.params.roomId).simulateObSignal(
        req.body.camId,
        req.body.sample,
      );
      if (!r.ok) return sendError(res, r.code, r.message);
      return res.status(200).send({ ok: true });
    },
  );
}
