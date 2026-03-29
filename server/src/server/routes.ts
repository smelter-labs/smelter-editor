import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';
import { ensureDir, pathExists, readdir, readFile, stat } from 'fs-extra';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getMp4DurationMs } from './mp4Duration';
import { Type } from '@sinclair/typebox';
import type {
  Static,
  TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox';
import { state } from './serverState';
import { roomEventBus } from './roomEventBus';
import { registerStorageRoutes } from './storageRoutes';
import { logRequest, addLogListener, getLogBuffer } from '../dashboard';
import {
  registerSnakeGameRoutes,
  clearSnakeGameRoomInactivityTimer,
} from '../snakeGame/snakeGameRoutes';
import { registerTimelineRoutes } from '../timeline/timelineRoutes';
import { TwitchChannelSuggestions } from '../twitch/TwitchChannelMonitor';
import type { RegisterInputOptions, PendingWhipInputData } from '../types';
import { toPublicInputState } from './publicInputState';
import { config } from '../config';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../pictures/pictureSuggestionMonitor';
import { KickChannelSuggestions } from '../kick/KickChannelMonitor';
import shadersController from '../shaders/shaders';
import {
  RESOLUTION_PRESETS,
  type Resolution,
  type ResolutionPreset,
} from '../types';

const execFileAsync = promisify(execFile);
const THUMBNAILS_DIR = path.join(process.cwd(), 'thumbnails', 'mp4');
const HLS_THUMBNAILS_DIR = path.join(process.cwd(), 'thumbnails', 'hls');
const HLS_STREAMS_DIR = path.join(__dirname, '../../hls-streams');

async function ensureHlsThumbnail(jsonFileName: string): Promise<string> {
  const safeName = path.basename(jsonFileName);
  const thumbName = safeName.replace(/\.json$/, '.jpg');
  const thumbPath = path.join(HLS_THUMBNAILS_DIR, thumbName);

  if (await pathExists(thumbPath)) {
    return thumbPath;
  }

  const jsonPath = path.join(HLS_STREAMS_DIR, safeName);
  if (!(await pathExists(jsonPath))) {
    throw Object.assign(new Error('HLS stream not found'), { statusCode: 404 });
  }

  const content = JSON.parse(await readFile(jsonPath, 'utf-8'));
  const hlsUrl: string | undefined = content?.stream?.url;
  if (!hlsUrl) {
    throw Object.assign(new Error('No URL in saved stream'), {
      statusCode: 400,
    });
  }

  await ensureDir(HLS_THUMBNAILS_DIR);

  await execFileAsync(
    'ffmpeg',
    ['-ss', '2', '-i', hlsUrl, '-vframes', '1', '-vf', 'scale=320:-1', '-q:v', '4', '-y', thumbPath],
    { timeout: 10_000 },
  );

  return thumbPath;
}

async function ensureMp4Thumbnail(mp4FileName: string): Promise<string> {
  const safeName = path.basename(mp4FileName);
  const thumbName = safeName.replace(/\.[^.]+$/, '.jpg');
  const thumbPath = path.join(THUMBNAILS_DIR, thumbName);

  if (await pathExists(thumbPath)) {
    return thumbPath;
  }

  const mp4Path = path.join(process.cwd(), 'mp4s', safeName);
  if (!(await pathExists(mp4Path))) {
    throw Object.assign(new Error('MP4 file not found'), { statusCode: 404 });
  }

  await ensureDir(THUMBNAILS_DIR);

  await execFileAsync('ffmpeg', [
    '-ss',
    '1',
    '-i',
    mp4Path,
    '-vframes',
    '1',
    '-vf',
    'scale=320:-1',
    '-q:v',
    '4',
    '-y',
    thumbPath,
  ]);

  return thumbPath;
}

type RoomIdParams = { Params: { roomId: string } };
type RoomAndInputIdParams = { Params: { roomId: string; inputId: string } };
type RecordingFileParams = { Params: { fileName: string } };

export const routes = Fastify({
  logger: config.logger,
}).withTypeProvider<TypeBoxTypeProvider>();

routes.register(cors, { origin: true });
routes.register(websocket, {
  options: {
    perMessageDeflate: false,
  },
});

routes.addHook('onResponse', (req, reply, done) => {
  logRequest(req.method, req.url, reply.statusCode);
  done();
});

routes.setErrorHandler((err: unknown, _req, res) => {
  const e = err as {
    statusCode?: number;
    status?: number;
    code?: string;
    message?: string;
  };
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

routes.get<{ Params: { fileName: string } }>(
  '/suggestions/mp4-duration/:fileName',
  { schema: { params: Type.Object({ fileName: Type.String() }) } },
  async (req, res) => {
    const { fileName } = req.params;
    const safeName = path.basename(fileName);
    const filePath = path.join(process.cwd(), 'mp4s', safeName);

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: 'MP4 file not found' });
    }

    try {
      const durationMs = await getMp4DurationMs(filePath);
      return res.status(200).send({ durationMs });
    } catch (err: any) {
      console.error('Failed to get MP4 duration via ffprobe', {
        fileName: safeName,
        err: err?.message,
      });
      return res.status(500).send({ error: 'Failed to read MP4 duration' });
    }
  },
);

routes.get<{ Params: { fileName: string } }>(
  '/suggestions/mp4-thumbnail/:fileName',
  { schema: { params: Type.Object({ fileName: Type.String() }) } },
  async (req, res) => {
    const { fileName } = req.params;
    try {
      const thumbPath = await ensureMp4Thumbnail(fileName);
      const data = await readFile(thumbPath);
      res.header('Content-Type', 'image/jpeg');
      res.header('Cache-Control', 'public, max-age=86400');
      res.send(data);
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      const message = err?.message ?? 'Failed to generate thumbnail';
      console.error('MP4 thumbnail error', { fileName, err: message });
      res.status(status).send({ error: message });
    }
  },
);

routes.get<{ Params: { fileName: string } }>(
  '/hls-streams/thumbnail/:fileName',
  { schema: { params: Type.Object({ fileName: Type.String() }) } },
  async (req, res) => {
    const { fileName } = req.params;
    try {
      const thumbPath = await ensureHlsThumbnail(fileName);
      const data = await readFile(thumbPath);
      res.header('Content-Type', 'image/jpeg');
      res.header('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      const message = err?.message ?? 'Failed to generate HLS thumbnail';
      console.error('HLS thumbnail error', { fileName, err: message });
      res.status(status).send({ error: message });
    }
  },
);

routes.get('/suggestions/pictures', async (_req, res) => {
  res.status(200).send({ pictures: pictureSuggestionsMonitor.pictureFiles });
});

routes.get<{ Params: { fileName: string } }>(
  '/suggestions/pictures/:fileName',
  { schema: { params: Type.Object({ fileName: Type.String() }) } },
  async (req, res) => {
    const { fileName } = req.params;
    const safeName = path.basename(fileName);
    const filePath = path.join(process.cwd(), 'pictures', safeName);

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: 'Picture not found' });
    }

    try {
      const ext = path.extname(safeName).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
      };
      const data = await readFile(filePath);
      res.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      res.header('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch (err: any) {
      console.error('Failed to read picture file', { filePath, err });
      res.status(500).send({ error: 'Failed to read picture file' });
    }
  },
);

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

routes.get('/active-rooms', async (_req, res) => {
  const rooms = state
    .getRooms()
    .filter((room) => !room.pendingDelete)
    .map((room) => ({ roomId: room.idPrefix, roomName: room.roomName }));
  res.status(200).send({ rooms });
});

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

const RoomAndInputIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
  inputId: Type.String({ maxLength: 512, minLength: 1 }),
});

const ActiveTransitionSchema = Type.Object({
  type: Type.String(),
  durationMs: Type.Number(),
  direction: Type.Union([Type.Literal('in'), Type.Literal('out')]),
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
    type: Type.Literal('hls'),
    url: Type.String(),
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
    textAlign: Type.Optional(
      Type.Union([
        Type.Literal('left'),
        Type.Literal('center'),
        Type.Literal('right'),
      ]),
    ),
  }),
  Type.Object({
    type: Type.Literal('game'),
    title: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('hands'),
    sourceInputId: Type.String(),
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
    ]),
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
        resolution =
          RESOLUTION_PRESETS[req.body.resolution as ResolutionPreset];
      } else {
        resolution = req.body.resolution;
      }
    }

    const { roomId, roomName, room } = await state.createRoom(
      initInputs,
      skipDefaultInputs,
      resolution,
    );
    res.status(200).send({
      roomId,
      roomName,
      whepUrl: room.getWhepUrl(),
      resolution: room.getResolution(),
    });
  },
);

routes.get('/shaders', async (_req, res) => {
  const visible = shadersController.shaders.filter((s) => s.isVisible);
  res.status(200).send({ shaders: visible });
});

routes.get<RoomIdParams>(
  '/room/:roomId',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const room = state.getRoom(roomId);
    const snapshot = room.getState();

    res.status(200).send({
      roomName: room.roomName,
      inputs: snapshot.inputs.map(toPublicInputState),
      layout: snapshot.layout,
      whepUrl: room.getWhepUrl(),
      pendingDelete: room.pendingDelete,
      isPublic: room.isPublic,
      resolution: room.getResolution(),
      pendingWhipInputs: room.pendingWhipInputs,
      swapDurationMs: snapshot.swapDurationMs,
      swapOutgoingEnabled: snapshot.swapOutgoingEnabled,
      swapFadeInDurationMs: snapshot.swapFadeInDurationMs,
      newsStripFadeDuringSwap: snapshot.newsStripFadeDuringSwap,
      swapFadeOutDurationMs: snapshot.swapFadeOutDurationMs,
      newsStripEnabled: snapshot.newsStripEnabled,
      isRecording: room.hasActiveRecording(),
      isFrozen: room.isFrozen(),
      audioAnalysisEnabled: room.isAudioAnalysisEnabled(),
    });
  },
);

routes.after(() => {
  routes.route<RoomIdParams>({
    method: 'GET',
    url: '/room/:roomId/ws',
    schema: { params: RoomIdParamsSchema },
    handler: async (_req, res) => {
      res.status(426).send({
        error: 'Upgrade Required',
        message: 'Use a WebSocket client to connect to this endpoint.',
      });
    },
    wsHandler: (socket, req) => {
      const { roomId } = req.params;
      const clientId = uuidv4();
      roomEventBus.subscribe(roomId, clientId, socket);
    },
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
    .map((room) => {
      if (!room) {
        return undefined;
      }
      const snapshot = room.getState();
      return {
        roomId: room.idPrefix,
        roomName: room.roomName,
        inputs: snapshot.inputs.map(toPublicInputState),
        layout: snapshot.layout,
        whepUrl: room.getWhepUrl(),
        pendingDelete: room.pendingDelete,
        createdAt: room.creationTimestamp,
        isPublic: room.isPublic,
        swapDurationMs: snapshot.swapDurationMs,
        swapOutgoingEnabled: snapshot.swapOutgoingEnabled,
        swapFadeInDurationMs: snapshot.swapFadeInDurationMs,
        newsStripFadeDuringSwap: snapshot.newsStripFadeDuringSwap,
        swapFadeOutDurationMs: snapshot.swapFadeOutDurationMs,
        newsStripEnabled: snapshot.newsStripEnabled,
        isRecording: room.hasActiveRecording(),
        audioAnalysisEnabled: room.isAudioAnalysisEnabled(),
      };
    })
    .filter(Boolean);

  res
    .status(200)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify({ rooms: roomsInfo }, null, 2));
});

routes.post<RoomIdParams>(
  '/room/:roomId/record/start',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Start recording', { roomId });
    try {
      const room = state.getRoom(roomId);
      const { fileName } = await room.startRecording();
      res.status(200).send({ status: 'recording', fileName });
    } catch (err: any) {
      console.error('Failed to start recording', err?.body ?? err);
      res.status(400).send({
        status: 'error',
        message: err?.message ?? 'Failed to start recording',
      });
    }
  },
);

routes.post<RoomIdParams>(
  '/room/:roomId/record/stop',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Stop recording', { roomId });
    try {
      const room = state.getRoom(roomId);
      const { fileName } = await room.stopRecording();

      const forwardedProto = (
        req.headers['x-forwarded-proto'] as string | undefined
      )?.split(',')[0];
      const protocol = forwardedProto || (req.protocol as string) || 'http';
      const host = (req.headers['host'] as string) || 'localhost';
      const baseUrl = `${protocol}://${host}`;
      const downloadUrl = `${baseUrl}/recordings/${encodeURIComponent(fileName)}`;

      res.status(200).send({ status: 'stopped', fileName, downloadUrl });
    } catch (err: any) {
      console.error('Failed to stop recording', err?.body ?? err);
      res.status(400).send({
        status: 'error',
        message: err?.message ?? 'Failed to stop recording',
      });
    }
  },
);

const SCREENSHOTS_DIR = path.join(__dirname, '../../screenshots');


routes.get<{ Params: { fileName: string } }>(
  '/screenshots/:fileName',
  async (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(SCREENSHOTS_DIR, path.basename(fileName));

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: 'Screenshot not found' });
    }

    try {
      const fileStat = await stat(filePath);
      const data = await readFile(filePath);

      res.header('Content-Type', 'image/jpeg');
      res.header('Cache-Control', 'public, max-age=3600');
      res.header('Content-Length', fileStat.size.toString());
      res.send(data);
    } catch (err: any) {
      console.error('Failed to read screenshot file', { filePath, err });
      res.status(500).send({ error: 'Failed to read screenshot file' });
    }
  },
);

const RECORDINGS_DIR = path.join(__dirname, '../../recordings');

routes.get('/recordings', async (_req, res) => {
  const recordingsDir = RECORDINGS_DIR;

  if (!(await pathExists(recordingsDir))) {
    return res.status(200).send({ recordings: [] });
  }

  try {
    const files = await readdir(recordingsDir);
    const mp4Files = files.filter((f) => f.endsWith('.mp4'));
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

routes.get<RoomIdParams>(
  '/room/:roomId/recordings',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const recordingsDir = RECORDINGS_DIR;

    if (!(await pathExists(recordingsDir))) {
      return res.status(200).send({ recordings: [] });
    }

    try {
      const files = await readdir(recordingsDir);
      const mp4Files = files.filter((f) => f.endsWith('.mp4'));
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
  },
);

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

registerStorageRoutes(routes, {
  routePrefix: '/configs',
  dirPath: path.join(__dirname, '../../configs'),
  filePrefix: 'config',
  resourceName: 'config',
  payloadKey: 'config',
  listKey: 'configs',
  bodySchema: Type.Any(),
});

registerStorageRoutes(routes, {
  routePrefix: '/shader-presets',
  dirPath: path.join(__dirname, '../../shader-presets'),
  filePrefix: 'preset',
  resourceName: 'shader preset',
  payloadKey: 'shaders',
  listKey: 'presets',
  bodySchema: Type.Array(Type.Any()),
  supportsUpdate: true,
});

registerStorageRoutes(routes, {
  routePrefix: '/dashboard-layouts',
  dirPath: path.join(__dirname, '../../dashboard-layouts'),
  filePrefix: 'dashboard-layout',
  resourceName: 'dashboard layout',
  payloadKey: 'layout',
  listKey: 'layouts',
  bodySchema: Type.Any(),
});

registerStorageRoutes(routes, {
  routePrefix: '/hls-streams',
  dirPath: path.join(__dirname, '../../hls-streams'),
  filePrefix: 'hls',
  resourceName: 'HLS stream',
  payloadKey: 'stream',
  listKey: 'streams',
  bodySchema: Type.Object({ url: Type.String() }),
  supportsUpdate: true,
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
      Type.Literal('picture-on-picture'),
    ]),
  ),
  isPublic: Type.Optional(Type.Boolean()),
  swapDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  swapOutgoingEnabled: Type.Optional(Type.Boolean()),
  swapFadeInDurationMs: Type.Optional(
    Type.Number({ minimum: 0, maximum: 5000 }),
  ),
  swapFadeOutDurationMs: Type.Optional(
    Type.Number({ minimum: 0, maximum: 5000 }),
  ),
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
  },
);

const PendingWhipInputSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  volume: Type.Number(),
  showTitle: Type.Boolean(),
  shaders: Type.Array(Type.Any()),
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
  },
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
  },
);

routes.post<RoomAndInputIdParams>(
  '/room/:roomId/input/:inputId/whip/ack',
  { schema: { params: RoomAndInputIdParamsSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] WHIP ack', { roomId, inputId });
    try {
      const input = state
        .getRoom(roomId)
        .getInputs()
        .find((i) => i.inputId === inputId);
      if (!input || input.type !== 'whip') {
        return res.status(400).send({ error: 'Not a WHIP input' });
      }
      await state.getRoom(roomId).ackWhipInput(inputId);
      res.status(200).send({ status: 'ok' });
    } catch (err: any) {
      res
        .status(400)
        .send({ status: 'error', message: err?.message ?? 'Invalid input' });
    }
  },
);

routes.post<RoomAndInputIdParams>(
  '/room/:roomId/input/:inputId/connect',
  { schema: { params: RoomAndInputIdParamsSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Connect input', { roomId, inputId });
    const room = state.getRoom(roomId);
    await room.connectInput(inputId);
    res.status(200).send({ status: 'ok' });
  },
);

routes.post<RoomAndInputIdParams>(
  '/room/:roomId/input/:inputId/disconnect',
  { schema: { params: RoomAndInputIdParamsSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Disconnect input', { roomId, inputId });
    const room = state.getRoom(roomId);
    await room.disconnectInput(inputId);
    res.status(200).send({ status: 'ok' });
  },
);

const HideInputBodySchema = Type.Object({
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

routes.post<
  RoomAndInputIdParams & { Body: Static<typeof HideInputBodySchema> }
>(
  '/room/:roomId/input/:inputId/hide',
  { schema: { params: RoomAndInputIdParamsSchema, body: HideInputBodySchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    const { activeTransition } = req.body ?? {};
    console.log('[request] Hide input', {
      roomId,
      inputId,
      hasTransition: !!activeTransition,
    });
    const room = state.getRoom(roomId);
    await room.hideInput(inputId, activeTransition);
    const updatedInput = room.getInputs().find((i) => i.inputId === inputId);
    if (updatedInput) {
      const sourceId =
        (req.headers['x-source-id'] as string | undefined) ?? null;
      roomEventBus.broadcast(roomId, {
        type: 'input_updated',
        roomId,
        inputId,
        input: toPublicInputState(updatedInput),
        sourceId,
      });
    }
    res.status(200).send({ status: 'ok' });
  },
);

const ShowInputBodySchema = Type.Object({
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

routes.post<
  RoomAndInputIdParams & { Body: Static<typeof ShowInputBodySchema> }
>(
  '/room/:roomId/input/:inputId/show',
  { schema: { params: RoomAndInputIdParamsSchema, body: ShowInputBodySchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    const { activeTransition } = req.body ?? {};
    console.log('[request] Show input', {
      roomId,
      inputId,
      hasTransition: !!activeTransition,
    });
    const room = state.getRoom(roomId);
    await room.showInput(inputId, activeTransition);
    const updatedInput = room.getInputs().find((i) => i.inputId === inputId);
    if (updatedInput) {
      const sourceId =
        (req.headers['x-source-id'] as string | undefined) ?? null;
      roomEventBus.broadcast(roomId, {
        type: 'input_updated',
        roomId,
        inputId,
        input: toPublicInputState(updatedInput),
        sourceId,
      });
    }
    res.status(200).send({ status: 'ok' });
  },
);

const Mp4RestartSchema = Type.Object({
  playFromMs: Type.Number({ minimum: 0 }),
  loop: Type.Boolean(),
});

routes.post<RoomAndInputIdParams & { Body: Static<typeof Mp4RestartSchema> }>(
  '/room/:roomId/input/:inputId/mp4-restart',
  { schema: { params: RoomAndInputIdParamsSchema, body: Mp4RestartSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] MP4 restart', { roomId, inputId, body: req.body });
    const room = state.getRoom(roomId);
    await room.restartMp4Input(inputId, req.body.playFromMs, req.body.loop);
    res.status(200).send({ status: 'ok' });
  },
);

const MotionDetectionSchema = Type.Object({
  enabled: Type.Boolean(),
});

routes.post<
  RoomAndInputIdParams & { Body: Static<typeof MotionDetectionSchema> }
>(
  '/room/:roomId/input/:inputId/motion-detection',
  {
    schema: { params: RoomAndInputIdParamsSchema, body: MotionDetectionSchema },
  },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Toggle motion detection', {
      roomId,
      inputId,
      enabled: req.body.enabled,
    });
    const room = state.getRoom(roomId);
    await room.setMotionEnabled(inputId, req.body.enabled);
    res.status(200).send({ status: 'ok' });
  },
);

routes.get<RoomIdParams>(
  '/room/:roomId/motion-scores/sse',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const room = state.getRoom(roomId);

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const unsubscribe = room.addMotionScoreListener((scores) => {
      res.raw.write(`data: ${JSON.stringify(scores)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      if (res.raw.destroyed) {
        clearInterval(heartbeat);
        unsubscribe();
        return;
      }
      res.raw.write(': heartbeat\n\n');
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

const UpdateInputSchema = Type.Object({
  title: Type.Optional(Type.String()),
  volume: Type.Optional(Type.Number({ maximum: 1, minimum: 0 })),
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
          }),
        ),
      }),
    ),
  ),
  text: Type.Optional(Type.String()),
  textAlign: Type.Optional(
    Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
    ]),
  ),
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
  snake1Shaders: Type.Optional(Type.Any()),
  snake2Shaders: Type.Optional(Type.Any()),
  attachedInputIds: Type.Optional(Type.Array(Type.String())),
  absolutePosition: Type.Optional(Type.Boolean()),
  absoluteTop: Type.Optional(Type.Number()),
  absoluteLeft: Type.Optional(Type.Number()),
  absoluteWidth: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteHeight: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteTransitionDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteTransitionEasing: Type.Optional(Type.String()),
  cropTop: Type.Optional(Type.Number({ minimum: 0 })),
  cropLeft: Type.Optional(Type.Number({ minimum: 0 })),
  cropRight: Type.Optional(Type.Number({ minimum: 0 })),
  cropBottom: Type.Optional(Type.Number({ minimum: 0 })),
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

routes.post<RoomAndInputIdParams & { Body: Static<typeof UpdateInputSchema> }>(
  '/room/:roomId/input/:inputId',
  { schema: { params: RoomAndInputIdParamsSchema, body: UpdateInputSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Update input', {
      roomId,
      inputId,
      body: JSON.stringify(req.body),
    });
    const room = state.getRoom(roomId);
    await room.updateInput(inputId, req.body);
    const updatedInput = room.getInputs().find((i) => i.inputId === inputId);
    if (updatedInput) {
      const sourceId =
        (req.headers['x-source-id'] as string | undefined) ?? null;
      roomEventBus.broadcast(roomId, {
        type: 'input_updated',
        roomId,
        inputId,
        input: toPublicInputState(updatedInput),
        sourceId,
      });
    }
    res.status(200).send({ status: 'ok' });
  },
);

registerSnakeGameRoutes(routes);
registerTimelineRoutes(routes);

routes.delete<RoomAndInputIdParams>(
  '/room/:roomId/input/:inputId',
  { schema: { params: RoomAndInputIdParamsSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Remove input', { roomId, inputId });
    const room = state.getRoom(roomId);
    await room.removeInput(inputId);
    const sourceId = (req.headers['x-source-id'] as string | undefined) ?? null;
    roomEventBus.broadcast(roomId, {
      type: 'input_deleted',
      roomId,
      inputId,
      sourceId,
    });
    res.status(200).send({ status: 'ok' });
  },
);

// ── Audio analysis ─────────────────────────────────────────────

const AudioAnalysisSchema = Type.Object({
  enabled: Type.Boolean(),
});

routes.post<RoomIdParams & { Body: Static<typeof AudioAnalysisSchema> }>(
  '/room/:roomId/audio-analysis',
  { schema: { params: RoomIdParamsSchema, body: AudioAnalysisSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Toggle audio analysis', {
      roomId,
      enabled: req.body.enabled,
    });
    const room = state.getRoom(roomId);
    await room.setAudioAnalysisEnabled(req.body.enabled);
    res.status(200).send({ status: 'ok' });
  },
);

routes.get<RoomIdParams>(
  '/room/:roomId/audio-levels/sse',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const room = state.getRoom(roomId);

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const unsubscribe = room.addAudioLevelListener((levels) => {
      res.raw.write(`data: ${JSON.stringify(levels)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      if (res.raw.destroyed) {
        clearInterval(heartbeat);
        unsubscribe();
        return;
      }
      res.raw.write(': heartbeat\n\n');
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

routes.get<RoomIdParams>(
  '/room/:roomId/state/sse',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    const room = state.getRoom(roomId);

    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendState = () => {
      if (res.raw.destroyed) return;
      const snapshot = room.getState();
      const payload = {
        roomName: room.roomName,
        inputs: snapshot.inputs.map(toPublicInputState),
        layout: snapshot.layout,
        whepUrl: room.getWhepUrl(),
        pendingDelete: room.pendingDelete,
        isPublic: room.isPublic,
        resolution: room.getResolution(),
        pendingWhipInputs: room.pendingWhipInputs,
        swapDurationMs: snapshot.swapDurationMs,
        swapOutgoingEnabled: snapshot.swapOutgoingEnabled,
        swapFadeInDurationMs: snapshot.swapFadeInDurationMs,
        newsStripFadeDuringSwap: snapshot.newsStripFadeDuringSwap,
        swapFadeOutDurationMs: snapshot.swapFadeOutDurationMs,
        newsStripEnabled: snapshot.newsStripEnabled,
        isRecording: room.hasActiveRecording(),
        isFrozen: room.isFrozen(),
        audioAnalysisEnabled: room.isAudioAnalysisEnabled(),
      };
      res.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendState();

    const unsubscribe = room.addStateChangeListener(sendState);

    const heartbeat = setInterval(() => {
      if (res.raw.destroyed) {
        clearInterval(heartbeat);
        unsubscribe();
        return;
      }
      res.raw.write(': heartbeat\n\n');
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

routes.get('/logs/sse', async (req, res) => {
  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const batch = getLogBuffer();
  if (batch.length > 0) {
    res.raw.write(`event: batch\ndata: ${JSON.stringify(batch)}\n\n`);
  }

  const unsubscribe = addLogListener((entry) => {
    if (!res.raw.destroyed) {
      res.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  });

  const heartbeat = setInterval(() => {
    if (res.raw.destroyed) {
      clearInterval(heartbeat);
      unsubscribe();
      return;
    }
    res.raw.write(': heartbeat\n\n');
  }, 15000);

  req.raw.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

routes.delete<RoomIdParams>(
  '/room/:roomId',
  { schema: { params: RoomIdParamsSchema } },
  async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Delete room', { roomId });
    clearSnakeGameRoomInactivityTimer(roomId);
    await state.deleteRoom(roomId);
    res.status(200).send({ status: 'ok' });
  },
);

