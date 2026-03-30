import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { STATUS_CODES } from 'node:http';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { logRequest } from '../../dashboard';
import { config } from '../../config';
import { registerStorageRoutes } from '../storageRoutes';
import { registerSnakeGameRoutes } from '../../snakeGame/snakeGameRoutes';
import { registerTimelineRoutes } from '../../timeline/timelineRoutes';

import { roomRoutes } from './roomRoutes';
import { inputRoutes } from './inputRoutes';
import { recordingRoutes } from './recordingRoutes';
import { suggestionRoutes } from './suggestionRoutes';
import { sseRoutes } from './sseRoutes';
import {
  RoomConfigSchema,
  ShaderConfigSchema,
  DashboardLayoutSchema,
} from './schemas';

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

routes.register(suggestionRoutes);
routes.register(roomRoutes);
routes.register(inputRoutes);
routes.register(recordingRoutes);
routes.register(sseRoutes);

registerStorageRoutes(routes, {
  routePrefix: '/configs',
  dirPath: path.join(__dirname, '../../../configs'),
  filePrefix: 'config',
  resourceName: 'config',
  payloadKey: 'config',
  listKey: 'configs',
  bodySchema: RoomConfigSchema,
});

registerStorageRoutes(routes, {
  routePrefix: '/shader-presets',
  dirPath: path.join(__dirname, '../../../shader-presets'),
  filePrefix: 'preset',
  resourceName: 'shader preset',
  payloadKey: 'shaders',
  listKey: 'presets',
  bodySchema: Type.Array(ShaderConfigSchema),
  supportsUpdate: true,
});

registerStorageRoutes(routes, {
  routePrefix: '/dashboard-layouts',
  dirPath: path.join(__dirname, '../../../dashboard-layouts'),
  filePrefix: 'dashboard-layout',
  resourceName: 'dashboard layout',
  payloadKey: 'layout',
  listKey: 'layouts',
  bodySchema: DashboardLayoutSchema,
});

registerStorageRoutes(routes, {
  routePrefix: '/hls-streams',
  dirPath: path.join(__dirname, '../../../hls-streams'),
  filePrefix: 'hls',
  resourceName: 'HLS stream',
  payloadKey: 'stream',
  listKey: 'streams',
  bodySchema: Type.Object({ url: Type.String() }),
  supportsUpdate: true,
});

registerSnakeGameRoutes(routes);
registerTimelineRoutes(routes);
