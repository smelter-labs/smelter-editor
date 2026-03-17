import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { state } from '../server/serverState';
import { TimelinePlaySchema, TimelineSeekSchema } from './schemas';
import type { TimelinePlayBody, TimelineSeekBody } from './schemas';
import type { TimelineConfig } from './types';

type RoomIdParams = { Params: { roomId: string } };

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

export function registerTimelineRoutes(routes: FastifyInstance): void {
  routes.post<RoomIdParams & { Body: TimelinePlayBody }>(
    '/room/:roomId/timeline/play',
    {
      schema: {
        params: RoomIdParamsSchema,
        body: TimelinePlaySchema,
      },
    },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      const { tracks, totalDurationMs, fromMs } = req.body;
      console.log('[timeline] Start playback', {
        roomId,
        tracks: tracks.length,
        totalDurationMs,
        fromMs,
      });
      // TypeBox schema validates structure; cast to TimelineConfig since
      // TransitionType is narrower than the schema's `string`.
      const config = { tracks, totalDurationMs } as TimelineConfig;
      await room.startTimelinePlayback(config, fromMs);
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/timeline/stop',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      console.log('[timeline] Stop playback', { roomId });
      await room.stopTimelinePlayback();
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<RoomIdParams & { Body: TimelineSeekBody }>(
    '/room/:roomId/timeline/seek',
    {
      schema: {
        params: RoomIdParamsSchema,
        body: TimelineSeekSchema,
      },
    },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      const { ms } = req.body;
      console.log('[timeline] Seek', { roomId, ms });
      await room.seekTimeline(ms);
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.get<RoomIdParams>(
    '/room/:roomId/timeline/sse',
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

      // Send current state immediately
      const current = room.getTimelinePlaybackState();
      res.raw.write(`data: ${JSON.stringify(current)}\n\n`);

      const unsubscribe = room.addTimelineListener((data) => {
        res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
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
}
