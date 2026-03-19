import type { FastifyPluginCallback } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { state } from '../serverState';
import { roomEventBus } from '../roomEventBus';
import { toPublicInputState } from '../publicInputState';
import { config } from '../../config';
import {
  RoomIdParamsSchema,
  RoomAndInputIdParamsSchema,
  InputSchema,
  UpdateInputSchema,
  HideInputBodySchema,
  ShowInputBodySchema,
  Mp4RestartSchema,
  MotionDetectionSchema,
  type RoomIdParams,
  type RoomAndInputIdParams,
} from './schemas';

export const inputRoutes: FastifyPluginCallback = (routes, _opts, done) => {
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
        res.status(400).send({
          status: 'error',
          message: err?.message ?? 'Invalid input',
        });
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

  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof HideInputBodySchema> }
  >(
    '/room/:roomId/input/:inputId/hide',
    {
      schema: {
        params: RoomAndInputIdParamsSchema,
        body: HideInputBodySchema,
      },
    },
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

  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof ShowInputBodySchema> }
  >(
    '/room/:roomId/input/:inputId/show',
    {
      schema: {
        params: RoomAndInputIdParamsSchema,
        body: ShowInputBodySchema,
      },
    },
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

  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof Mp4RestartSchema> }
  >(
    '/room/:roomId/input/:inputId/mp4-restart',
    {
      schema: { params: RoomAndInputIdParamsSchema, body: Mp4RestartSchema },
    },
    async (req, res) => {
      const { roomId, inputId } = req.params;
      console.log('[request] MP4 restart', {
        roomId,
        inputId,
        body: req.body,
      });
      const room = state.getRoom(roomId);
      await room.restartMp4Input(inputId, req.body.playFromMs, req.body.loop);
      res.status(200).send({ status: 'ok' });
    },
  );

  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof MotionDetectionSchema> }
  >(
    '/room/:roomId/input/:inputId/motion-detection',
    {
      schema: {
        params: RoomAndInputIdParamsSchema,
        body: MotionDetectionSchema,
      },
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

  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof UpdateInputSchema> }
  >(
    '/room/:roomId/input/:inputId',
    {
      schema: { params: RoomAndInputIdParamsSchema, body: UpdateInputSchema },
    },
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

  routes.delete<RoomAndInputIdParams>(
    '/room/:roomId/input/:inputId',
    { schema: { params: RoomAndInputIdParamsSchema } },
    async (req, res) => {
      const { roomId, inputId } = req.params;
      console.log('[request] Remove input', { roomId, inputId });
      const room = state.getRoom(roomId);
      await room.removeInput(inputId);
      const sourceId =
        (req.headers['x-source-id'] as string | undefined) ?? null;
      roomEventBus.broadcast(roomId, {
        type: 'input_deleted',
        roomId,
        inputId,
        sourceId,
      });
      res.status(200).send({ status: 'ok' });
    },
  );

  done();
};
