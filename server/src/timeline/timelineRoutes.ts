import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { state } from '../core/serverState';
import { roomEventBus } from '../core/roomEventBus';
import { logTimelineEvent } from '../dashboard';
import type { TimelinePlaybackUpdatedEvent } from '@smelter-editor/types';
import {
  TimelinePlaySchema,
  TimelineSeekSchema,
  TimelineApplySchema,
} from './schemas';
import type {
  TimelinePlayBody,
  TimelineSeekBody,
  TimelineApplyBody,
} from './schemas';
import type { TimelineConfig } from './types';

type RoomIdParams = { Params: { roomId: string } };

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

function logTimelineSync(
  phase: string,
  details: Record<string, unknown>,
): void {
  console.log(`[${new Date().toISOString()}] [sync][server-${phase}]`, details);
}

const timelinePlaybackForwarders = new Map<string, () => void>();

function broadcastTimelinePlaybackState(roomId: string): void {
  const room = state.getRoom(roomId);
  const playback = room.getTimelinePlaybackState();
  const event: TimelinePlaybackUpdatedEvent = {
    type: 'timeline_playback_updated',
    roomId,
    isTimelinePlaying: playback.isPlaying,
    isPaused: playback.isPaused,
    playheadMs: playback.playheadMs,
    totalDurationMs: playback.totalDurationMs,
  };
  roomEventBus.broadcast(roomId, event);
}

function ensureTimelinePlaybackForwarder(roomId: string): void {
  if (timelinePlaybackForwarders.has(roomId)) {
    return;
  }

  const room = state.getRoom(roomId);
  let lastIsPlaying = room.getTimelinePlaybackState().isPlaying;

  const unsubscribe = room.addTimelineListener((data) => {
    if (data.isPlaying !== lastIsPlaying) {
      lastIsPlaying = data.isPlaying;
      broadcastTimelinePlaybackState(roomId);
    }

    if (!data.isPlaying && !data.isPaused) {
      unsubscribeTimelinePlaybackForwarder(roomId);
    }
  });

  timelinePlaybackForwarders.set(roomId, unsubscribe);
}

function unsubscribeTimelinePlaybackForwarder(roomId: string): void {
  const unsubscribe = timelinePlaybackForwarders.get(roomId);
  if (!unsubscribe) {
    return;
  }

  timelinePlaybackForwarders.delete(roomId);
  unsubscribe();
}

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
      const { tracks, totalDurationMs, keyframeInterpolationMode, fromMs } =
        req.body;
      logTimelineSync('receive', {
        route: '/room/:roomId/timeline/play',
        method: 'POST',
        roomId,
        tracks: tracks.length,
        totalDurationMs,
        fromMs,
      });
      logTimelineEvent(
        roomId,
        `PLAY from ${fromMs ?? 0}ms (${tracks.length} tracks, ${totalDurationMs}ms)`,
      );
      // TypeBox schema validates structure; cast to TimelineConfig since
      // TransitionType is narrower than the schema's `string`.
      const config = {
        tracks,
        totalDurationMs,
        keyframeInterpolationMode,
      } as TimelineConfig;
      ensureTimelinePlaybackForwarder(roomId);
      try {
        await room.startTimelinePlayback(config, fromMs);
        broadcastTimelinePlaybackState(roomId);
      } catch (error) {
        unsubscribeTimelinePlaybackForwarder(roomId);
        throw error;
      }
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/timeline/pause',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      logTimelineSync('receive', {
        route: '/room/:roomId/timeline/pause',
        method: 'POST',
        roomId,
      });
      logTimelineEvent(roomId, 'PAUSE');
      const result = await room.pauseTimeline();
      broadcastTimelinePlaybackState(roomId);
      res.status(200).send(result);
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/timeline/stop',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      logTimelineSync('receive', {
        route: '/room/:roomId/timeline/stop',
        method: 'POST',
        roomId,
      });
      logTimelineEvent(roomId, 'STOP');
      await room.stopTimelinePlayback();
      broadcastTimelinePlaybackState(roomId);
      unsubscribeTimelinePlaybackForwarder(roomId);
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
      logTimelineSync('receive', {
        route: '/room/:roomId/timeline/seek',
        method: 'POST',
        roomId,
        ms,
      });
      logTimelineEvent(roomId, `SEEK to ${ms}ms`);
      await room.seekTimeline(ms);
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<RoomIdParams & { Body: TimelineApplyBody }>(
    '/room/:roomId/timeline/apply',
    {
      schema: {
        params: RoomIdParamsSchema,
        body: TimelineApplySchema,
      },
    },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      const { tracks, totalDurationMs, keyframeInterpolationMode, playheadMs } =
        req.body;
      logTimelineSync('receive', {
        route: '/room/:roomId/timeline/apply',
        method: 'POST',
        roomId,
        tracks: tracks.length,
        totalDurationMs,
        playheadMs,
      });
      logTimelineEvent(roomId, `APPLY snapshot at ${playheadMs}ms`);
      const config = {
        tracks,
        totalDurationMs,
        keyframeInterpolationMode,
      } as TimelineConfig;
      await room.applyTimelineState(config, playheadMs);
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
      logTimelineSync('broadcast', {
        route: '/room/:roomId/timeline/sse',
        roomId,
        event: 'timeline_state',
        isPlaying: current.isPlaying,
        isPaused: current.isPaused,
        playheadMs: current.playheadMs,
      });
      res.raw.write(`data: ${JSON.stringify(current)}\n\n`);

      const unsubscribe = room.addTimelineListener((data) => {
        logTimelineSync('broadcast', {
          route: '/room/:roomId/timeline/sse',
          roomId,
          event: 'timeline_state',
          isPlaying: data.isPlaying,
          isPaused: data.isPaused,
          playheadMs: data.playheadMs,
        });
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
