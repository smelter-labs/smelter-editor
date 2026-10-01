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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  OB_CAM_ROLES,
  OB_CONFIG_LIMITS,
  OB_CONTROL_ACTIONS,
  OB_GRADES,
  OB_PRESET_IDS,
  OB_QUIZ_ACTIONS,
  OB_QUIZ_LETTERS,
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
import { DATA_DIR } from '../dataDir';
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
  simulateObHost(camId: string | null): ObCommandResult;
  attachObMp4Cam(
    role: ObCamRole,
    fileName: string,
    meta?: { name?: string; talent?: string | null; subtitle?: string | null },
  ): Promise<{ camId: string; inputId: string }>;
  adoptObInput(
    inputId: string,
    role: ObCamRole,
    meta?: { name?: string; talent?: string | null; subtitle?: string | null },
  ): Promise<{ camId: string }>;
  syncObFileCams(playFromMs?: number): Promise<string[]>;
  obFileCamsMediaZeroAirMs(): number | null;
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
    action: literals(['role', 'name', 'talent', 'subtitle', 'kick'] as const),
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
  Type.Object({
    op: Type.Literal('quiz'),
    action: literals(OB_QUIZ_ACTIONS),
    camId: Type.Optional(CamId),
    letter: Type.Optional(literals(OB_QUIZ_LETTERS)),
    verdict: Type.Optional(literals(['correct', 'wrong'] as const)),
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
  subtitles: Type.Optional(Type.Boolean()),
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
  subtitle: Type.Optional(
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
  subtitle: Type.Optional(
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

const SimulateHostSchema = Type.Object({
  camId: Type.Union([CamId, Type.Null()]),
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

// ── Demo manifests (data/mp4s/ob-demo/<name>/cams.json) ───────────────────
// The same manifests scripts/ob-demo-run.mjs uses; `load-demo` replays its
// setup sequence server-side so the editor can do it with one button.

const OB_DEMO_ROOT = path.join(DATA_DIR, 'mp4s', 'ob-demo');

const LoadDemoSchema = Type.Object({
  dir: Type.String({ maxLength: 128, pattern: '^ob-demo/[A-Za-z0-9._-]+$' }),
});

type ObDemoManifest = {
  eventName?: string;
  presetId?: string;
  captions?: boolean;
  brief?: string;
  audio?: { mode?: string; cam?: string };
  ruleOverrides?: Record<string, Record<string, unknown>>;
  config?: Record<string, unknown>;
  rundown?: { id?: string; title?: string; atS?: number }[];
  resumeAfterMs?: number;
  cams?: {
    file: string;
    role: string;
    name?: string;
    talent?: string | null;
    subtitle?: string | null;
    optional?: boolean;
  }[];
};

type ObDemoCam = NonNullable<ObDemoManifest['cams']>[number] & {
  fileName: string;
};

function readObDemo(dir: string): {
  m: ObDemoManifest;
  cams: ObDemoCam[];
  skipped: string[];
  rundown: { id: string; title: string }[];
} {
  const abs = path.join(OB_DEMO_ROOT, dir.slice('ob-demo/'.length));
  const camsPath = path.join(abs, 'cams.json');
  if (!existsSync(camsPath)) throw new Error(`no cams.json under ${dir}`);
  const m = JSON.parse(readFileSync(camsPath, 'utf8')) as ObDemoManifest;
  const timingPath = path.join(abs, 'timing.json');
  const timing = existsSync(timingPath)
    ? (JSON.parse(readFileSync(timingPath, 'utf8')) as {
        rundown?: { id?: string; title?: string }[];
      })
    : null;
  const cams: ObDemoCam[] = [];
  const skipped: string[] = [];
  for (const c of m.cams ?? []) {
    const fileName = sanitizeFbMp4FileName(`${dir}/${c.file}`);
    if (!fileName) throw new Error(`bad cam file name: ${c.file}`);
    if (!existsSync(path.join(abs, c.file))) {
      if (c.optional) {
        skipped.push(c.file);
        continue;
      }
      throw new Error(`${dir}/${c.file} not found`);
    }
    if (!isObCamRole(c.role)) throw new Error(`unknown role: ${c.role}`);
    cams.push({ ...c, fileName });
  }
  if (!cams.length) throw new Error('cams.json lists no cameras');
  const rundown = (m.rundown ?? timing?.rundown ?? []).map((r, i) => ({
    id: String(r.id ?? `seg-${i + 1}`).slice(0, 40),
    title: String(r.title ?? '').slice(0, 60),
  }));
  return { m, cams, skipped, rundown };
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
          ...(req.body.subtitle !== undefined
            ? { subtitle: req.body.subtitle }
            : {}),
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
        const room = getRoom(req.params.roomId);
        const restarted = await room.syncObFileCams(req.body.playFromMs ?? 0);
        return res.status(200).send({
          ok: true,
          restarted: restarted.length,
          // When media 0 airs (wall clock): the clips resume after the delay.
          mediaZeroAirMs: room.obFileCamsMediaZeroAirMs(),
        });
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
          ...(req.body.subtitle !== undefined
            ? { subtitle: req.body.subtitle }
            : {}),
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

  // Dev-only host injector (OB_SIM=1): fake the LLM confirming the host on a
  // camera (null clears), so the FOLLOW rules can be driven end to end
  // without a worker or an API key.
  routes.post<Body<typeof SimulateHostSchema>>(
    '/room/:roomId/ob-van/simulate-host',
    { schema: { params: RoomIdParamsSchema, body: SimulateHostSchema } },
    async (req, res) => {
      if (process.env.OB_SIM !== '1')
        return res.status(404).send({
          statusCode: 404,
          error: STATUS_CODES[404],
          message: 'Not found',
        });
      const r = getRoom(req.params.roomId).simulateObHost(req.body.camId);
      if (!r.ok) return sendError(res, r.code, r.message);
      return res.status(200).send({ ok: true });
    },
  );

  // Demo manifests on disk — what the QUICK DEMOS buttons can load.
  routes.get('/ob-van/demos', async (_req, res) => {
    const demos: {
      dir: string;
      eventName: string;
      presetId: string;
      cams: number;
    }[] = [];
    if (existsSync(OB_DEMO_ROOT))
      for (const name of readdirSync(OB_DEMO_ROOT).sort()) {
        const camsPath = path.join(OB_DEMO_ROOT, name, 'cams.json');
        if (!existsSync(camsPath)) continue;
        try {
          const m = JSON.parse(
            readFileSync(camsPath, 'utf8'),
          ) as ObDemoManifest;
          demos.push({
            dir: `ob-demo/${name}`,
            eventName: m.eventName ?? name,
            presetId: m.presetId ?? 'talk',
            cams: (m.cams ?? []).length,
          });
        } catch {
          /* skip a broken manifest */
        }
      }
    return res.status(200).send({ demos });
  });

  // One-click demo: replay ob-demo-run's setup sequence for a cams.json —
  // config (BEFORE the cams: signal opts bake at attach) → rule overrides →
  // file cams with talent/subtitle → sync to 0:00.
  routes.post<Body<typeof LoadDemoSchema>>(
    '/room/:roomId/ob-van/load-demo',
    { schema: { params: RoomIdParamsSchema, body: LoadDemoSchema } },
    async (req, res) => {
      const room = getRoom(req.params.roomId);
      console.log('[request] OB Van load-demo', {
        roomId: req.params.roomId,
        dir: req.body.dir,
      });
      let demo: ReturnType<typeof readObDemo>;
      try {
        demo = readObDemo(req.body.dir);
      } catch (err) {
        return sendError(res, 'bad_action', errMessage(err));
      }
      const { m, cams, skipped, rundown } = demo;
      try {
        room.setObConfig({
          eventName: m.eventName ?? 'OB VAN DEMO',
          ...(m.presetId
            ? { presetId: m.presetId as ObConfig['presetId'] }
            : {}),
          captions: m.captions ?? true,
          brief: m.brief ?? '',
          rundown,
          autoPilot: false,
          resumeAfterMs: m.resumeAfterMs ?? 20000,
          titleBugVisible: true,
          ...(m.audio?.mode === 'mix' || m.audio?.mode === 'follow'
            ? { audio: { mode: m.audio.mode } }
            : {}),
          ...((m.config ?? {}) as ObConfigPatch),
        });
        const overrides = Object.entries(m.ruleOverrides ?? {});
        if (overrides.length) {
          const ruleset = structuredClone(room.getObState().ruleset);
          for (const [id, patch] of overrides) {
            const rule = ruleset.rules.find((r) => r.id === id);
            if (rule) Object.assign(rule, patch);
          }
          const r = room.setObRuleset(ruleset);
          if ('errors' in r)
            return sendError(res, 'invalid_ruleset', r.errors.join('; '), {
              errors: r.errors,
            });
        }
        const attached: { camId: string; role: string; file: string }[] = [];
        for (const c of cams) {
          const { camId } = await room.attachObMp4Cam(
            c.role as ObCamRole,
            c.fileName,
            {
              ...(c.name ? { name: c.name } : {}),
              talent: c.talent ?? null,
              subtitle: c.subtitle ?? null,
            },
          );
          attached.push({ camId, role: c.role, file: c.file });
        }
        if (m.audio?.mode === 'master') {
          const hit =
            attached.find((c) => c.role === m.audio?.cam) ??
            attached.find((c) => c.file === m.audio?.cam);
          if (hit)
            room.setObConfig({ audio: { mode: 'master', cam: hit.camId } });
        }
        await room.syncObFileCams(0);
        return res.status(200).send({
          state: room.getObState(),
          attached: attached.length,
          skipped,
        });
      } catch (err) {
        return sendError(res, 'bad_action', errMessage(err));
      }
    },
  );
}
