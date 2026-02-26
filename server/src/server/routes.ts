import Fastify from 'fastify';
import cors from '@fastify/cors';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';
import { ensureDir, pathExists, readdir, readFile, remove, stat, writeFile } from 'fs-extra';
import { Type } from '@sinclair/typebox';
import type { Static, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { state } from './serverState';
import { logRequest, setGlobalGameState } from '../dashboard';
import { TwitchChannelSuggestions } from '../twitch/TwitchChannelMonitor';
import type { RegisterInputOptions, PendingWhipInputData } from './roomState';
import { toPublicInputState } from './publicInputState';
import { config } from '../config';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../pictures/pictureSuggestionMonitor';
import { KickChannelSuggestions } from '../kick/KickChannelMonitor';
import type { ShaderConfig } from '../shaders/shaders';
import shadersController from '../shaders/shaders';
import { RESOLUTION_PRESETS, type Resolution, type ResolutionPreset } from '../smelter';

type RoomIdParams = { Params: { roomId: string } };
type RoomAndInputIdParams = { Params: { roomId: string; inputId: string } };
type RecordingFileParams = { Params: { fileName: string } };

let gameRoomCreationInProgress: Promise<void> | null = null;

export const routes = Fastify({
  logger: config.logger,
}).withTypeProvider<TypeBoxTypeProvider>();

routes.register(cors, { origin: true });

routes.addHook('onResponse', (req, reply, done) => {
  logRequest(req.method, req.url, reply.statusCode);
  done();
});

routes.setErrorHandler((err: unknown, _req, res) => {
  const e = err as { statusCode?: number; status?: number; code?: string; message?: string };
  const statusCode = e.statusCode ?? e.status ?? 500;
  const code = e.code ?? 'INTERNAL_ERROR';
  const message = e.message ?? 'Internal server error';
  res.status(statusCode).send({
    statusCode,
    code,
    error: STATUS_CODES[statusCode] ?? 'Unknown Error',
    message,
  });
});

routes.get('/suggestions/mp4s', async (_req, res) => {
  res.status(200).send({ mp4s: mp4SuggestionsMonitor.mp4Files });
});

routes.get('/suggestions/pictures', async (_req, res) => {
  res.status(200).send({ pictures: pictureSuggestionsMonitor.pictureFiles });
});

routes.get('/suggestions/twitch', async (_req, res) => {
  res.status(200).send({ twitch: TwitchChannelSuggestions.getTopStreams() });
});

routes.get('/suggestions/kick', async (_req, res) => {
  console.log('[request] Get kick suggestions');
  res.status(200).send({ kick: KickChannelSuggestions.getTopStreams() });
});

routes.get('/suggestions', async (_req, res) => {
  res.status(200).send({ twitch: TwitchChannelSuggestions.getTopStreams() });
});

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

const RoomAndInputIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
  inputId: Type.String({ maxLength: 512, minLength: 1 }),
});

const InputSchema = Type.Union([
  Type.Object({
    type: Type.Literal('twitch-channel'),
    channelId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('kick-channel'),
    channelId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('whip'),
    username: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('local-mp4'),
    source: Type.Union([
      Type.Object({ fileName: Type.String() }),
      Type.Object({ url: Type.String() }),
    ]),
  }),
  Type.Object({
    type: Type.Literal('image'),
    fileName: Type.Optional(Type.String()),
    imageId: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('text-input'),
    text: Type.String(),
    textAlign: Type.Optional(Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
    ])),
  }),
  Type.Object({
    type: Type.Literal('game'),
    title: Type.Optional(Type.String()),
  }),
]);

const CreateRoomSchema = Type.Object({
  initInputs: Type.Optional(Type.Array(InputSchema)),
  skipDefaultInputs: Type.Optional(Type.Boolean()),
  resolution: Type.Optional(
    Type.Union([
      Type.Object({
        width: Type.Number({ minimum: 1 }),
        height: Type.Number({ minimum: 1 }),
      }),
      Type.Union([
        Type.Literal('720p'),
        Type.Literal('1080p'),
        Type.Literal('1440p'),
        Type.Literal('4k'),
        Type.Literal('720p-vertical'),
        Type.Literal('1080p-vertical'),
        Type.Literal('1440p-vertical'),
        Type.Literal('4k-vertical'),
      ]),
    ])
  ),
});

routes.post<{ Body: Static<typeof CreateRoomSchema> }>(
  '/room',
  { schema: { body: CreateRoomSchema } },
  async (req, res) => {
    console.log('[request] Create new room', { body: req.body });

    const initInputs = (req.body.initInputs as RegisterInputOptions[]) || [];
    const skipDefaultInputs = req.body.skipDefaultInputs === true;

    let resolution: Resolution | undefined;
    if (req.body.resolution) {
      if (typeof req.body.resolution === 'string') {
        resolution = RESOLUTION_PRESETS[req.body.resolution as ResolutionPreset];
      } else {
        resolution = req.body.resolution;
      }
    }

    const { roomId, room } = await state.createRoom(initInputs, skipDefaultInputs, resolution);
    res.status(200).send({
      roomId,
      whepUrl: room.getWhepUrl(),
      resolution: room.getResolution(),
    });
  }
);

routes.get('/shaders', async (_req, res) => {
  const visible = shadersController.shaders.filter(s => s.isVisible);
  res.status(200).send({ shaders: visible });
});

routes.get<RoomIdParams>('/room/:roomId', { schema: { params: RoomIdParamsSchema } }, async (req, res) => {
  const { roomId } = req.params;
  const room = state.getRoom(roomId);
  const [inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs, newsStripEnabled] = room.getState();

  res.status(200).send({
    inputs: inputs.map(toPublicInputState),
    layout,
    whepUrl: room.getWhepUrl(),
    pendingDelete: room.pendingDelete,
    isPublic: room.isPublic,
    resolution: room.getResolution(),
    pendingWhipInputs: room.pendingWhipInputs,
    swapDurationMs,
    swapOutgoingEnabled,
    swapFadeInDurationMs,
    newsStripFadeDuringSwap,
    swapFadeOutDurationMs,
    newsStripEnabled,
  });
});

routes.get('/rooms', async (_req, res) => {
  // const adminKey = _req.headers['x-admin-key'];
  // if (!adminKey || adminKey !== 'super-secret-hardcode-admin-key') {
  //   return res.status(401).send({ error: 'Unauthorized' });
  // }

  res.header('Refresh', '2');

  const allRooms = state.getRooms();

  const roomsInfo = allRooms
    .map(room => {
      if (!room) {
        return undefined;
      }
      const [inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs, newsStripEnabled] = room.getState();
      return {
        roomId: room.idPrefix,
        inputs: inputs.map(toPublicInputState),
        layout,
        whepUrl: room.getWhepUrl(),
        pendingDelete: room.pendingDelete,
        createdAt: room.creationTimestamp,
        isPublic: room.isPublic,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        newsStripFadeDuringSwap,
        swapFadeOutDurationMs,
        newsStripEnabled,
      };
    })
    .filter(Boolean);

  res
    .status(200)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify({ rooms: roomsInfo }, null, 2));
});

routes.post<RoomIdParams>('/room/:roomId/record/start', { schema: { params: RoomIdParamsSchema } }, async (req, res) => {
  const { roomId } = req.params;
  console.log('[request] Start recording', { roomId });
  try {
    const room = state.getRoom(roomId);
    const { fileName } = await room.startRecording();
    res.status(200).send({ status: 'recording', fileName });
  } catch (err: any) {
    console.error('Failed to start recording', err?.body ?? err);
    res
      .status(400)
      .send({ status: 'error', message: err?.message ?? 'Failed to start recording' });
  }
});

routes.post<RoomIdParams>('/room/:roomId/record/stop', { schema: { params: RoomIdParamsSchema } }, async (req, res) => {
  const { roomId } = req.params;
  console.log('[request] Stop recording', { roomId });
  try {
    const room = state.getRoom(roomId);
    const { fileName } = await room.stopRecording();

    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(
      ','
    )[0];
    const protocol = forwardedProto || (req.protocol as string) || 'http';
    const host = (req.headers['host'] as string) || 'localhost';
    const baseUrl = `${protocol}://${host}`;
    const downloadUrl = `${baseUrl}/recordings/${encodeURIComponent(fileName)}`;

    res.status(200).send({ status: 'stopped', fileName, downloadUrl });
  } catch (err: any) {
    console.error('Failed to stop recording', err?.body ?? err);
    res
      .status(400)
      .send({ status: 'error', message: err?.message ?? 'Failed to stop recording' });
  }
});

const RECORDINGS_DIR = path.join(__dirname, '../../recordings');

routes.get('/recordings', async (_req, res) => {
  const recordingsDir = RECORDINGS_DIR;

  if (!(await pathExists(recordingsDir))) {
    return res.status(200).send({ recordings: [] });
  }

  try {
    const files = await readdir(recordingsDir);
    const mp4Files = files.filter(f => f.endsWith('.mp4'));
    const recordings = [];
    for (const fileName of mp4Files) {
      const filePath = path.join(recordingsDir, fileName);
      const fileStat = await stat(filePath);
      const match = fileName.match(/^recording-(.+)-(\d+)\.mp4$/);
      recordings.push({
        fileName,
        roomId: match ? match[1] : null,
        createdAt: match ? Number(match[2]) : fileStat.mtimeMs,
        size: fileStat.size,
      });
    }
    recordings.sort((a, b) => b.createdAt - a.createdAt);
    res.status(200).send({ recordings });
  } catch (err: any) {
    console.error('Failed to list recordings', err);
    res.status(500).send({ error: 'Failed to list recordings' });
  }
});

routes.get<RoomIdParams>('/room/:roomId/recordings', { schema: { params: RoomIdParamsSchema } }, async (req, res) => {
  const { roomId } = req.params;
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const recordingsDir = RECORDINGS_DIR;

  if (!(await pathExists(recordingsDir))) {
    return res.status(200).send({ recordings: [] });
  }

  try {
    const files = await readdir(recordingsDir);
    const mp4Files = files.filter(f => f.endsWith('.mp4'));
    const recordings = [];
    for (const fileName of mp4Files) {
      const match = fileName.match(/^recording-(.+)-(\d+)\.mp4$/);
      if (!match || match[1] !== safeRoomId) {
        continue;
      }
      const filePath = path.join(recordingsDir, fileName);
      const fileStat = await stat(filePath);
      recordings.push({
        fileName,
        roomId: match[1],
        createdAt: Number(match[2]),
        size: fileStat.size,
      });
    }
    recordings.sort((a, b) => b.createdAt - a.createdAt);
    res.status(200).send({ recordings });
  } catch (err: any) {
    console.error('Failed to list recordings for room', { roomId, err });
    res.status(500).send({ error: 'Failed to list recordings' });
  }
});

routes.get<RecordingFileParams>('/recordings/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const recordingsDir = RECORDINGS_DIR;
  const filePath = path.join(recordingsDir, fileName);

  if (!(await pathExists(filePath))) {
    return res.status(404).send({ error: 'Recording not found' });
  }

  try {
    const fileStat = await stat(filePath);
    const data = await readFile(filePath);

    res.header('Content-Type', 'video/mp4');
    res.header('Content-Disposition', `attachment; filename="${fileName}"`);
    res.header('Content-Length', fileStat.size.toString());
    res.send(data);
  } catch (err: any) {
    console.error('Failed to read recording file', { filePath, err });
    res.status(500).send({ error: 'Failed to read recording file' });
  }
});

const CONFIGS_DIR = path.join(__dirname, '../../configs');

const SaveConfigSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  config: Type.Any(),
});

routes.post<{ Body: Static<typeof SaveConfigSchema> }>(
  '/configs',
  { schema: { body: SaveConfigSchema } },
  async (req, res) => {
    const { name, config } = req.body;
    const safeName = name.replace(/[^a-zA-Z0-9_\-.\s]/g, '_').trim();
    const timestamp = Date.now();
    const fileName = `config-${safeName}-${timestamp}.json`;

    await ensureDir(CONFIGS_DIR);
    const filePath = path.join(CONFIGS_DIR, fileName);
    await writeFile(filePath, JSON.stringify({ name, config, savedAt: new Date().toISOString() }, null, 2));

    console.log('[request] Save config', { name, fileName });
    res.status(200).send({ status: 'ok', fileName, name });
  }
);

routes.get('/configs', async (_req, res) => {
  if (!(await pathExists(CONFIGS_DIR))) {
    return res.status(200).send({ configs: [] });
  }

  try {
    const files = await readdir(CONFIGS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const configs = [];
    for (const fileName of jsonFiles) {
      const filePath = path.join(CONFIGS_DIR, fileName);
      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const fileStat = await stat(filePath);
        configs.push({
          fileName,
          name: parsed.name ?? fileName,
          savedAt: parsed.savedAt ?? fileStat.mtimeMs,
          size: fileStat.size,
        });
      } catch {
        continue;
      }
    }
    configs.sort((a, b) => {
      const aTime = typeof a.savedAt === 'string' ? new Date(a.savedAt).getTime() : a.savedAt;
      const bTime = typeof b.savedAt === 'string' ? new Date(b.savedAt).getTime() : b.savedAt;
      return bTime - aTime;
    });
    res.status(200).send({ configs });
  } catch (err: any) {
    console.error('Failed to list configs', err);
    res.status(500).send({ error: 'Failed to list configs' });
  }
});

type ConfigFileParams = { Params: { fileName: string } };

routes.get<ConfigFileParams>('/configs/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const filePath = path.join(CONFIGS_DIR, fileName);

  if (!(await pathExists(filePath))) {
    return res.status(404).send({ error: 'Config not found' });
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    res.status(200).send(parsed);
  } catch (err: any) {
    console.error('Failed to read config file', { filePath, err });
    res.status(500).send({ error: 'Failed to read config file' });
  }
});

routes.delete<ConfigFileParams>('/configs/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const filePath = path.join(CONFIGS_DIR, fileName);

  if (!(await pathExists(filePath))) {
    return res.status(404).send({ error: 'Config not found' });
  }

  try {
    await remove(filePath);
    res.status(200).send({ status: 'ok' });
  } catch (err: any) {
    console.error('Failed to delete config', { filePath, err });
    res.status(500).send({ error: 'Failed to delete config' });
  }
});

const UpdateRoomSchema = Type.Object({
  inputOrder: Type.Optional(Type.Array(Type.String())),
  layout: Type.Optional(
    Type.Union([
      Type.Literal('grid'),
      Type.Literal('primary-on-left'),
      Type.Literal('primary-on-top'),
      Type.Literal('picture-in-picture'),
      Type.Literal('wrapped'),
      Type.Literal('wrapped-static'),
      Type.Literal('transition'),
      Type.Literal('picture-on-picture'),
      Type.Literal('softu-tv'),
    ])
  ),
  isPublic: Type.Optional(Type.Boolean()),
  swapDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  swapOutgoingEnabled: Type.Optional(Type.Boolean()),
  swapFadeInDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  swapFadeOutDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  newsStripFadeDuringSwap: Type.Optional(Type.Boolean()),
  newsStripEnabled: Type.Optional(Type.Boolean()),
});

// No multiple-pictures shader defaults API - kept local in layout

routes.post<RoomIdParams & { Body: Static<typeof UpdateRoomSchema> }>(
  '/room/:roomId',
  { schema: { params: RoomIdParamsSchema, body: UpdateRoomSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Update room', { body: req.body, roomId });
    const room = state.getRoom(roomId);

    if (req.body.inputOrder) {
      room.reorderInputs(req.body.inputOrder);
    }
    if (req.body.layout) {
      await room.updateLayout(req.body.layout);
    }
    if (req.body.isPublic !== undefined) {
      room.isPublic = req.body.isPublic;
    }
    if (req.body.swapDurationMs !== undefined) {
      room.setSwapDurationMs(req.body.swapDurationMs);
    }
    if (req.body.swapOutgoingEnabled !== undefined) {
      room.setSwapOutgoingEnabled(req.body.swapOutgoingEnabled);
    }
    if (req.body.swapFadeInDurationMs !== undefined) {
      room.setSwapFadeInDurationMs(req.body.swapFadeInDurationMs);
    }
    if (req.body.swapFadeOutDurationMs !== undefined) {
      room.setSwapFadeOutDurationMs(req.body.swapFadeOutDurationMs);
    }
    if (req.body.newsStripFadeDuringSwap !== undefined) {
      room.setNewsStripFadeDuringSwap(req.body.newsStripFadeDuringSwap);
    }
    if (req.body.newsStripEnabled !== undefined) {
      room.setNewsStripEnabled(req.body.newsStripEnabled);
    }

    res.status(200).send({ status: 'ok' });
  }
);

const PendingWhipInputSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  volume: Type.Number(),
  showTitle: Type.Boolean(),
  shaders: Type.Array(Type.Any()),
  orientation: Type.Union([Type.Literal('horizontal'), Type.Literal('vertical')]),
  position: Type.Number(),
});

const SetPendingWhipInputsSchema = Type.Object({
  pendingWhipInputs: Type.Array(PendingWhipInputSchema),
});

routes.post<RoomIdParams & { Body: Static<typeof SetPendingWhipInputsSchema> }>(
  '/room/:roomId/pending-whip-inputs',
  { schema: { params: RoomIdParamsSchema, body: SetPendingWhipInputsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const room = state.getRoom(roomId);
    room.pendingWhipInputs = req.body.pendingWhipInputs;
    res.status(200).send({ status: 'ok' });
  }
);

// (Removed endpoints for multiple-pictures shader defaults)

routes.post<RoomIdParams & { Body: Static<typeof InputSchema> }>(
  '/room/:roomId/input',
  { schema: { params: RoomIdParamsSchema, body: InputSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Create input', { body: req.body, roomId });
    const room = state.getRoom(roomId);
    const inputId = await room.addNewInput(req.body);
    console.log('[info] Added input', { inputId });
    let bearerToken = '';
    if (inputId) {
      bearerToken = await room.connectInput(inputId);
    }
    let whipUrl = `${config.whipBaseUrl}/${inputId}`;
    res.status(200).send({ inputId, bearerToken, whipUrl });
  }
);

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/whip/ack', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] WHIP ack', { roomId, inputId });
  try {
    const input = state
      .getRoom(roomId)
      .getInputs()
      .find(i => i.inputId === inputId);
    if (!input || input.type !== 'whip') {
      return res.status(400).send({ error: 'Not a WHIP input' });
    }
    await state.getRoom(roomId).ackWhipInput(inputId);
    res.status(200).send({ status: 'ok' });
  } catch (err: any) {
    res.status(400).send({ status: 'error', message: err?.message ?? 'Invalid input' });
  }
});

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/connect', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Connect input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.connectInput(inputId);
  res.status(200).send({ status: 'ok' });
});

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/disconnect', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Disconnect input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.disconnectInput(inputId);
  res.status(200).send({ status: 'ok' });
});

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/hide', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Hide input', { roomId, inputId });
  const room = state.getRoom(roomId);
  room.hideInput(inputId);
  res.status(200).send({ status: 'ok' });
});

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/show', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Show input', { roomId, inputId });
  const room = state.getRoom(roomId);
  room.showInput(inputId);
  res.status(200).send({ status: 'ok' });
});

const UpdateInputSchema = Type.Object({
  volume: Type.Number({ maximum: 1, minimum: 0 }),
  showTitle: Type.Optional(Type.Boolean()),
  shaders: Type.Optional(
    Type.Array(
      Type.Object({
        shaderName: Type.String(),
        shaderId: Type.String(),
        enabled: Type.Boolean(),
        params: Type.Array(
          Type.Object({
            paramName: Type.String(),
            paramValue: Type.Union([Type.Number(), Type.String()]),
          })
        ),
      })
    )
  ),
  orientation: Type.Optional(Type.Union([
    Type.Literal('horizontal'),
    Type.Literal('vertical'),
  ])),
  text: Type.Optional(Type.String()),
  textAlign: Type.Optional(Type.Union([
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
  ])),
  textColor: Type.Optional(Type.String()),
  textMaxLines: Type.Optional(Type.Number()),
  textScrollSpeed: Type.Optional(Type.Number()),
  textScrollLoop: Type.Optional(Type.Boolean()),
  textScrollNudge: Type.Optional(Type.Number()),
  textFontSize: Type.Optional(Type.Number()),
  borderColor: Type.Optional(Type.String()),
  borderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  gameBackgroundColor: Type.Optional(Type.String()),
  gameCellGap: Type.Optional(Type.Number({ minimum: 0 })),
  gameBoardBorderColor: Type.Optional(Type.String()),
  gameBoardBorderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  gameGridLineColor: Type.Optional(Type.String()),
  gameGridLineAlpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  snakeEventShaders: Type.Optional(Type.Any()),
  attachedInputIds: Type.Optional(Type.Array(Type.String())),
});

routes.post<RoomAndInputIdParams & { Body: Static<typeof UpdateInputSchema> }>(
  '/room/:roomId/input/:inputId',
  { schema: { params: RoomAndInputIdParamsSchema, body: UpdateInputSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Update input', { roomId, inputId, body: JSON.stringify(req.body) });
    const room = state.getRoom(roomId);
    await room.updateInput(inputId, req.body);
    res.status(200).send({ status: 'ok' });
  }
);

const GameStateSchema = Type.Object({
  board: Type.Object({
    width: Type.Number({ minimum: 1 }),
    height: Type.Number({ minimum: 1 }),
    cellSize: Type.Number({ minimum: 1 }),
    cellGap: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  cells: Type.Array(
    Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      color: Type.String(),
      size: Type.Optional(Type.Number({ minimum: 1 })),
      isHead: Type.Optional(Type.Boolean()),
      direction: Type.Optional(Type.Union([
        Type.Literal('up'),
        Type.Literal('down'),
        Type.Literal('left'),
        Type.Literal('right'),
      ])),
      progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    })
  ),
  backgroundColor: Type.String(),
  events: Type.Optional(Type.Array(
    Type.Object({
      type: Type.Union([
        Type.Literal('speed_up'),
        Type.Literal('cut_opponent'),
        Type.Literal('got_cut'),
        Type.Literal('cut_self'),
        Type.Literal('eat_block'),
        Type.Literal('bounce_block'),
        Type.Literal('no_moves'),
        Type.Literal('game_over'),
      ]),
    })
  )),
  gameOverData: Type.Optional(Type.Object({
    winnerName: Type.String(),
    reason: Type.String(),
    players: Type.Array(Type.Object({
      name: Type.String(),
      score: Type.Number(),
      eaten: Type.Number(),
      cuts: Type.Number(),
      color: Type.String(),
    })),
  })),
});

routes.post<RoomAndInputIdParams & { Body: Static<typeof GameStateSchema> }>(
  '/room/:roomId/input/:inputId/game-state',
  { schema: { params: RoomAndInputIdParamsSchema, body: GameStateSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    const room = state.getRoom(roomId);
    const gs = req.body;
    room.updateGameState(inputId, gs);
    if (gs.events && gs.events.length > 0) {
      room.ingestGameEvents(inputId, gs.events);
    }
    res.status(200).send({ status: 'ok' });
  }
);

// Global game state — no room needed, broadcasts to all game inputs
routes.post<{ Body: Static<typeof GameStateSchema> }>(
  '/game-state',
  { schema: { body: GameStateSchema } },
  async (req, res) => {
    const gs = req.body;
    setGlobalGameState({
      boardWidth: gs.board.width,
      boardHeight: gs.board.height,
      cellSize: gs.board.cellSize,
      cellGap: gs.board.cellGap ?? 0,
      cells: gs.cells,
      backgroundColor: gs.backgroundColor,
      boardBorderColor: '#ffffff',
      boardBorderWidth: 4,
      gridLineColor: '#111111',
      gridLineAlpha: 0.15,
      gameOverData: gs.gameOverData,
    });

    // Wait for any in-progress game room creation to finish before checking
    if (gameRoomCreationInProgress) {
      await gameRoomCreationInProgress;
    }

    // Check if any room has a game input
    const roomsWithGame = state.getRooms().filter(room =>
      room.getInputs().some(input => input.type === 'game')
    );

    let createdRoomId: string | undefined;

    if (roomsWithGame.length === 0) {
      // Auto-create a room with a single game input and picture-in-picture layout
      const createPromise = (async () => {
        const { roomId, room } = await state.createRoom(
          [{ type: 'game', title: 'Snake' }],
          true,
        );
        createdRoomId = roomId;
        await room.updateLayout('softu-tv');
        // Wait briefly for async init to register the game input
        await new Promise(resolve => setTimeout(resolve, 200));
        for (const input of room.getInputs()) {
          if (input.type === 'game') {
            room.updateGameState(input.inputId, gs);
            if (gs.events && gs.events.length > 0) {
              room.ingestGameEvents(input.inputId, gs.events);
            }
          }
        }
      })();
      gameRoomCreationInProgress = createPromise;
      try {
        await createPromise;
      } finally {
        gameRoomCreationInProgress = null;
      }
    } else {
      // Broadcast to all rooms that have game inputs
      for (const room of roomsWithGame) {
        for (const input of room.getInputs()) {
          if (input.type === 'game') {
            room.updateGameState(input.inputId, gs);
            if (gs.events && gs.events.length > 0) {
              room.ingestGameEvents(input.inputId, gs.events);
            }
          }
        }
      }
    }

    res.status(200).send({ status: 'ok', roomId: createdRoomId });
  }
);

routes.delete<RoomAndInputIdParams>('/room/:roomId/input/:inputId', { schema: { params: RoomAndInputIdParamsSchema } }, async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Remove input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.removeInput(inputId);
  res.status(200).send({ status: 'ok' });
});

routes.delete<RoomIdParams>('/room/:roomId', { schema: { params: RoomIdParamsSchema } }, async (req, res) => {
  const { roomId } = req.params;
  console.log('[request] Delete room', { roomId });
  await state.deleteRoom(roomId);
  res.status(200).send({ status: 'ok' });
});
