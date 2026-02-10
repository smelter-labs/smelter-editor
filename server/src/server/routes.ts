import Fastify from 'fastify';
import { Type } from '@sinclair/typebox';
import type { Static, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { state } from './serverState';
import { TwitchChannelSuggestions } from '../twitch/TwitchChannelMonitor';
import type { RoomInputState, RegisterInputOptions } from './roomState';
import { config } from '../config';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../pictures/pictureSuggestionMonitor';
import { KickChannelSuggestions } from '../kick/KickChannelMonitor';
import type { ShaderConfig } from '../shaders/shaders';
import shadersController from '../shaders/shaders';
import { RESOLUTION_PRESETS, type Resolution, type ResolutionPreset } from '../smelter';

type RoomIdParams = { Params: { roomId: string } };
type RoomAndInputIdParams = { Params: { roomId: string; inputId: string } };

type InputState = {
  inputId: string;
  title: string;
  description: string;
  showTitle: boolean;
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  type: 'local-mp4' | 'twitch-channel' | 'kick-channel' | 'whip' | 'image' | 'text-input';
  shaders: ShaderConfig[];
  orientation: 'horizontal' | 'vertical';
  channelId?: string;
  imageId?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
};

export const routes = Fastify({
  logger: config.logger,
}).withTypeProvider<TypeBoxTypeProvider>();

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

const CreateRoomSchema = Type.Object({
  initInputs: Type.Optional(Type.Array(Type.Any())),
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

routes.get<RoomIdParams>('/room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const room = state.getRoom(roomId);
  const [inputs, layout] = room.getState();

  res.status(200).send({
    inputs: inputs.map(publicInputState),
    layout,
    whepUrl: room.getWhepUrl(),
    pendingDelete: room.pendingDelete,
    isPublic: room.isPublic,
    resolution: room.getResolution(),
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
      const [inputs, layout] = room.getState();
      return {
        roomId: room.idPrefix,
        inputs: inputs.map(publicInputState),
        layout,
        whepUrl: room.getWhepUrl(),
        pendingDelete: room.pendingDelete,
        createdAt: room.creationTimestamp,
        isPublic: room.isPublic,
      };
    })
    .filter(Boolean);

  res
    .status(200)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify({ rooms: roomsInfo }, null, 2));
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
    ])
  ),
  isPublic: Type.Optional(Type.Boolean()),
});

// No multiple-pictures shader defaults API - kept local in layout

routes.post<RoomIdParams & { Body: Static<typeof UpdateRoomSchema> }>(
  '/room/:roomId',
  { schema: { body: UpdateRoomSchema } },
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

    res.status(200).send({ status: 'ok' });
  }
);

// (Removed endpoints for multiple-pictures shader defaults)

const AddInputSchema = Type.Union([
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
]);

routes.post<RoomIdParams & { Body: Static<typeof AddInputSchema> }>(
  '/room/:roomId/input',
  { schema: { body: AddInputSchema } },
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

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/whip/ack', async (req, res) => {
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

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/connect', async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Connect input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.connectInput(inputId);
  res.status(200).send({ status: 'ok' });
});

routes.post<RoomAndInputIdParams>('/room/:roomId/input/:inputId/disconnect', async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Disconnect input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.disconnectInput(inputId);
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
            paramValue: Type.Number(),
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
  textScrollNudge: Type.Optional(Type.Number()),
});

routes.post<RoomAndInputIdParams & { Body: Static<typeof UpdateInputSchema> }>(
  '/room/:roomId/input/:inputId',
  { schema: { body: UpdateInputSchema } },
  async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Update input', { roomId, inputId, body: JSON.stringify(req.body) });
    const room = state.getRoom(roomId);
    await room.updateInput(inputId, req.body);
    res.status(200).send({ status: 'ok' });
  }
);

routes.delete<RoomAndInputIdParams>('/room/:roomId/input/:inputId', async (req, res) => {
  const { roomId, inputId } = req.params;
  console.log('[request] Remove input', { roomId, inputId });
  const room = state.getRoom(roomId);
  await room.removeInput(inputId);
  res.status(200).send({ status: 'ok' });
});

function publicInputState(input: RoomInputState): InputState {
  switch (input.type) {
    case 'local-mp4':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: 'always-live',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
      };
    case 'image':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: 'always-live',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
        imageId: input.imageId,
      };
    case 'twitch-channel':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
        channelId: input.channelId,
      };
    case 'kick-channel':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
        channelId: input.channelId,
      };
    case 'whip':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
      };
    case 'text-input':
      return {
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        sourceState: 'always-live',
        status: input.status,
        volume: input.volume,
        type: input.type,
        shaders: input.shaders,
        orientation: input.orientation,
        text: input.text,
        textAlign: input.textAlign,
        textColor: input.textColor,
        textMaxLines: input.textMaxLines,
        textScrollSpeed: input.textScrollSpeed,
      };
    default:
      throw new Error('Unknown input state');
  }
}
