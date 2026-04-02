import type { FastifyPluginCallback } from 'fastify';
import { state } from '../serverState';
import { toPublicInputState } from '../publicInputState';
import { RoomIdParamsSchema, type RoomIdParams } from './schemas';

export const sseRoutes: FastifyPluginCallback = (routes, _opts, done) => {
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
          outputShaders: snapshot.outputShaders,
          isRecording: room.hasActiveRecording(),
          isFrozen: room.isFrozen(),
          audioAnalysisEnabled: room.isAudioAnalysisEnabled(),
          viewportTop: snapshot.viewportTop,
          viewportLeft: snapshot.viewportLeft,
          viewportWidth: snapshot.viewportWidth,
          viewportHeight: snapshot.viewportHeight,
          viewportTransitionDurationMs: snapshot.viewportTransitionDurationMs,
          viewportTransitionEasing: snapshot.viewportTransitionEasing,
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

  done();
};
