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
import {
  RoomIdParamsSchema,
  CreateRoomSchema,
  UpdateRoomSchema,
  SetPendingWhipInputsSchema,
} from './schemas';
import type { RoomIdParams } from './schemas';

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
        layers: snapshot.layers,
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
      });
    },
  );

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
          layers: snapshot.layers,
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
      if (req.body.layers) {
        if (req.body.layers.length === 0) {
          return res.status(400).send({
            statusCode: 400,
            code: 'BAD_REQUEST',
            error: 'Bad Request',
            message: 'layers must contain at least one layer',
          });
        }
        await room.updateLayers(req.body.layers);
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

      const sourceId =
        (req.headers['x-source-id'] as string | undefined) ?? null;
      roomEventBus.broadcast(roomId, {
        type: 'room_updated',
        roomId,
        sourceId,
      });

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
