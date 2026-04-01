import { v4 as uuidv4 } from 'uuid';
import type { FastifyPluginCallback } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { state } from '../serverState';
import { roomEventBus } from '../roomEventBus';
import { toPublicInputState } from '../publicInputState';
import { clearSnakeGameRoomInactivityTimer } from '../../snakeGame/snakeGameRoutes';
import type { RegisterInputOptions } from '../../room/types';
import {
  RESOLUTION_PRESETS,
  type Resolution,
  type ResolutionPreset,
} from '../../types';
import { Type } from '@sinclair/typebox';
import {
  RoomIdParamsSchema,
  CreateRoomSchema,
  UpdateRoomSchema,
  SetPendingWhipInputsSchema,
  type RoomIdParams,
} from './schemas';

export const roomRoutes: FastifyPluginCallback = (routes, _opts, done) => {
  routes.get('/active-rooms', async (_req, res) => {
    const rooms = state
      .getRooms()
      .filter((room) => !room.pendingDelete)
      .map((room) => ({ roomId: room.idPrefix, roomName: room.roomName }));
    res.status(200).send({ rooms });
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
        outputShaders: snapshot.outputShaders,
        viewportTop: snapshot.viewportTop,
        viewportLeft: snapshot.viewportLeft,
        viewportWidth: snapshot.viewportWidth,
        viewportHeight: snapshot.viewportHeight,
        viewportTransitionDurationMs: snapshot.viewportTransitionDurationMs,
        viewportTransitionEasing: snapshot.viewportTransitionEasing,
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
          outputShaders: snapshot.outputShaders,
          isRecording: room.hasActiveRecording(),
          audioAnalysisEnabled: room.isAudioAnalysisEnabled(),
          viewportTop: snapshot.viewportTop,
          viewportLeft: snapshot.viewportLeft,
          viewportWidth: snapshot.viewportWidth,
          viewportHeight: snapshot.viewportHeight,
          viewportTransitionDurationMs: snapshot.viewportTransitionDurationMs,
          viewportTransitionEasing: snapshot.viewportTransitionEasing,
        };
      })
      .filter(Boolean);

    res
      .status(200)
      .header('Content-Type', 'application/json')
      .send(JSON.stringify({ rooms: roomsInfo }, null, 2));
  });

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

      if (req.body.outputShaders !== undefined) {
        room.setOutputShaders(req.body.outputShaders);
      }

      const viewportFields = [
        'viewportTop',
        'viewportLeft',
        'viewportWidth',
        'viewportHeight',
        'viewportTransitionDurationMs',
        'viewportTransitionEasing',
      ] as const;
      const viewportUpdate: Record<string, unknown> = {};
      for (const key of viewportFields) {
        if (req.body[key] !== undefined) viewportUpdate[key] = req.body[key];
      }
      if (Object.keys(viewportUpdate).length > 0) {
        room.setViewport(viewportUpdate as any);
      }

      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<
    RoomIdParams & { Body: Static<typeof SetPendingWhipInputsSchema> }
  >(
    '/room/:roomId/pending-whip-inputs',
    {
      schema: {
        params: RoomIdParamsSchema,
        body: SetPendingWhipInputsSchema,
      },
    },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      room.pendingWhipInputs = req.body.pendingWhipInputs;
      res.status(200).send({ status: 'ok' });
    },
  );

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

  done();
};
