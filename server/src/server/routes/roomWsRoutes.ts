import { v4 as uuidv4 } from 'uuid';
import type { FastifyPluginCallback } from 'fastify';
import { roomEventBus } from '../roomEventBus';
import { RoomIdParamsSchema, type RoomIdParams } from './schemas';

/**
 * WebSocket route for real-time room event streaming.
 *
 * Registered separately from the REST room routes so that the WS upgrade
 * handling doesn't need to live inside `routes.after()` inside roomRoutes.ts.
 * Must be registered on a Fastify instance that has the @fastify/websocket
 * plugin active.
 */
export const roomWsRoutes: FastifyPluginCallback = (routes, _opts, done) => {
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

  done();
};
