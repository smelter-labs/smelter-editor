"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routes = void 0;
const fastify_1 = __importDefault(require("fastify"));
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = require("fs-extra");
const typebox_1 = require("@sinclair/typebox");
const serverState_1 = require("./serverState");
const TwitchChannelMonitor_1 = require("../twitch/TwitchChannelMonitor");
const config_1 = require("../config");
const mp4SuggestionMonitor_1 = __importDefault(require("../mp4/mp4SuggestionMonitor"));
const pictureSuggestionMonitor_1 = __importDefault(require("../pictures/pictureSuggestionMonitor"));
const KickChannelMonitor_1 = require("../kick/KickChannelMonitor");
const shaders_1 = __importDefault(require("../shaders/shaders"));
const smelter_1 = require("../smelter");
exports.routes = (0, fastify_1.default)({
    logger: config_1.config.logger,
}).withTypeProvider();
exports.routes.get('/suggestions/mp4s', async (_req, res) => {
    res.status(200).send({ mp4s: mp4SuggestionMonitor_1.default.mp4Files });
});
exports.routes.get('/suggestions/pictures', async (_req, res) => {
    res.status(200).send({ pictures: pictureSuggestionMonitor_1.default.pictureFiles });
});
exports.routes.get('/suggestions/twitch', async (_req, res) => {
    res.status(200).send({ twitch: TwitchChannelMonitor_1.TwitchChannelSuggestions.getTopStreams() });
});
exports.routes.get('/suggestions/kick', async (_req, res) => {
    console.log('[request] Get kick suggestions');
    res.status(200).send({ kick: KickChannelMonitor_1.KickChannelSuggestions.getTopStreams() });
});
exports.routes.get('/suggestions', async (_req, res) => {
    res.status(200).send({ twitch: TwitchChannelMonitor_1.TwitchChannelSuggestions.getTopStreams() });
});
const CreateRoomSchema = typebox_1.Type.Object({
    initInputs: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.Any())),
    skipDefaultInputs: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    resolution: typebox_1.Type.Optional(typebox_1.Type.Union([
        typebox_1.Type.Object({
            width: typebox_1.Type.Number({ minimum: 1 }),
            height: typebox_1.Type.Number({ minimum: 1 }),
        }),
        typebox_1.Type.Union([
            typebox_1.Type.Literal('720p'),
            typebox_1.Type.Literal('1080p'),
            typebox_1.Type.Literal('1440p'),
            typebox_1.Type.Literal('4k'),
            typebox_1.Type.Literal('720p-vertical'),
            typebox_1.Type.Literal('1080p-vertical'),
            typebox_1.Type.Literal('1440p-vertical'),
            typebox_1.Type.Literal('4k-vertical'),
        ]),
    ])),
});
exports.routes.post('/room', { schema: { body: CreateRoomSchema } }, async (req, res) => {
    console.log('[request] Create new room', { body: req.body });
    const initInputs = req.body.initInputs || [];
    const skipDefaultInputs = req.body.skipDefaultInputs === true;
    let resolution;
    if (req.body.resolution) {
        if (typeof req.body.resolution === 'string') {
            resolution = smelter_1.RESOLUTION_PRESETS[req.body.resolution];
        }
        else {
            resolution = req.body.resolution;
        }
    }
    const { roomId, room } = await serverState_1.state.createRoom(initInputs, skipDefaultInputs, resolution);
    res.status(200).send({
        roomId,
        whepUrl: room.getWhepUrl(),
        resolution: room.getResolution(),
    });
});
exports.routes.get('/shaders', async (_req, res) => {
    const visible = shaders_1.default.shaders.filter(s => s.isVisible);
    res.status(200).send({ shaders: visible });
});
exports.routes.get('/room/:roomId', async (req, res) => {
    const { roomId } = req.params;
    const room = serverState_1.state.getRoom(roomId);
    const [inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs] = room.getState();
    res.status(200).send({
        inputs: inputs.map(publicInputState),
        layout,
        whepUrl: room.getWhepUrl(),
        pendingDelete: room.pendingDelete,
        isPublic: room.isPublic,
        resolution: room.getResolution(),
        pendingWhipInputs: room.pendingWhipInputs,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        newsStripFadeDuringSwap,
        swapFadeOutDurationMs,
    });
});
exports.routes.get('/rooms', async (_req, res) => {
    // const adminKey = _req.headers['x-admin-key'];
    // if (!adminKey || adminKey !== 'super-secret-hardcode-admin-key') {
    //   return res.status(401).send({ error: 'Unauthorized' });
    // }
    res.header('Refresh', '2');
    const allRooms = serverState_1.state.getRooms();
    const roomsInfo = allRooms
        .map(room => {
        if (!room) {
            return undefined;
        }
        const [inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs] = room.getState();
        return {
            roomId: room.idPrefix,
            inputs: inputs.map(publicInputState),
            layout,
            whepUrl: room.getWhepUrl(),
            pendingDelete: room.pendingDelete,
            createdAt: room.creationTimestamp,
            isPublic: room.isPublic,
            swapDurationMs,
            swapOutgoingEnabled,
            swapFadeInDurationMs,
            newsStripFadeDuringSwap,
            swapFadeOutDurationMs,
        };
    })
        .filter(Boolean);
    res
        .status(200)
        .header('Content-Type', 'application/json')
        .send(JSON.stringify({ rooms: roomsInfo }, null, 2));
});
exports.routes.post('/room/:roomId/record/start', async (req, res) => {
    var _a, _b;
    const { roomId } = req.params;
    console.log('[request] Start recording', { roomId });
    try {
        const room = serverState_1.state.getRoom(roomId);
        const { fileName } = await room.startRecording();
        res.status(200).send({ status: 'recording', fileName });
    }
    catch (err) {
        console.error('Failed to start recording', (_a = err === null || err === void 0 ? void 0 : err.body) !== null && _a !== void 0 ? _a : err);
        res
            .status(400)
            .send({ status: 'error', message: (_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : 'Failed to start recording' });
    }
});
exports.routes.post('/room/:roomId/record/stop', async (req, res) => {
    var _a, _b, _c;
    const { roomId } = req.params;
    console.log('[request] Stop recording', { roomId });
    try {
        const room = serverState_1.state.getRoom(roomId);
        const { fileName } = await room.stopRecording();
        const forwardedProto = (_a = req.headers['x-forwarded-proto']) === null || _a === void 0 ? void 0 : _a.split(',')[0];
        const protocol = forwardedProto || req.protocol || 'http';
        const host = req.headers['host'] || 'localhost';
        const baseUrl = `${protocol}://${host}`;
        const downloadUrl = `${baseUrl}/recordings/${encodeURIComponent(fileName)}`;
        res.status(200).send({ status: 'stopped', fileName, downloadUrl });
    }
    catch (err) {
        console.error('Failed to stop recording', (_b = err === null || err === void 0 ? void 0 : err.body) !== null && _b !== void 0 ? _b : err);
        res
            .status(400)
            .send({ status: 'error', message: (_c = err === null || err === void 0 ? void 0 : err.message) !== null && _c !== void 0 ? _c : 'Failed to stop recording' });
    }
});
exports.routes.get('/recordings/:fileName', async (req, res) => {
    const { fileName } = req.params;
    const recordingsDir = node_path_1.default.join(process.cwd(), 'recordings');
    const filePath = node_path_1.default.join(recordingsDir, fileName);
    if (!(await (0, fs_extra_1.pathExists)(filePath))) {
        return res.status(404).send({ error: 'Recording not found' });
    }
    try {
        const fileStat = await (0, fs_extra_1.stat)(filePath);
        const data = await (0, fs_extra_1.readFile)(filePath);
        res.header('Content-Type', 'video/mp4');
        res.header('Content-Disposition', `attachment; filename="${fileName}"`);
        res.header('Content-Length', fileStat.size.toString());
        res.send(data);
    }
    catch (err) {
        console.error('Failed to read recording file', { filePath, err });
        res.status(500).send({ error: 'Failed to read recording file' });
    }
});
const UpdateRoomSchema = typebox_1.Type.Object({
    inputOrder: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.String())),
    layout: typebox_1.Type.Optional(typebox_1.Type.Union([
        typebox_1.Type.Literal('grid'),
        typebox_1.Type.Literal('primary-on-left'),
        typebox_1.Type.Literal('primary-on-top'),
        typebox_1.Type.Literal('picture-in-picture'),
        typebox_1.Type.Literal('wrapped'),
        typebox_1.Type.Literal('wrapped-static'),
        typebox_1.Type.Literal('transition'),
        typebox_1.Type.Literal('picture-on-picture'),
        typebox_1.Type.Literal('softu-tv'),
    ])),
    isPublic: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    swapDurationMs: typebox_1.Type.Optional(typebox_1.Type.Number({ minimum: 0, maximum: 5000 })),
    swapOutgoingEnabled: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    swapFadeInDurationMs: typebox_1.Type.Optional(typebox_1.Type.Number({ minimum: 0, maximum: 5000 })),
    swapFadeOutDurationMs: typebox_1.Type.Optional(typebox_1.Type.Number({ minimum: 0, maximum: 5000 })),
    newsStripFadeDuringSwap: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
});
// No multiple-pictures shader defaults API - kept local in layout
exports.routes.post('/room/:roomId', { schema: { body: UpdateRoomSchema } }, async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Update room', { body: req.body, roomId });
    const room = serverState_1.state.getRoom(roomId);
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
    res.status(200).send({ status: 'ok' });
});
const PendingWhipInputSchema = typebox_1.Type.Object({
    id: typebox_1.Type.String(),
    title: typebox_1.Type.String(),
    volume: typebox_1.Type.Number(),
    showTitle: typebox_1.Type.Boolean(),
    shaders: typebox_1.Type.Array(typebox_1.Type.Any()),
    orientation: typebox_1.Type.Union([typebox_1.Type.Literal('horizontal'), typebox_1.Type.Literal('vertical')]),
    position: typebox_1.Type.Number(),
});
const SetPendingWhipInputsSchema = typebox_1.Type.Object({
    pendingWhipInputs: typebox_1.Type.Array(PendingWhipInputSchema),
});
exports.routes.post('/room/:roomId/pending-whip-inputs', { schema: { body: SetPendingWhipInputsSchema } }, async (req, res) => {
    const { roomId } = req.params;
    const room = serverState_1.state.getRoom(roomId);
    room.pendingWhipInputs = req.body.pendingWhipInputs;
    res.status(200).send({ status: 'ok' });
});
// (Removed endpoints for multiple-pictures shader defaults)
const AddInputSchema = typebox_1.Type.Union([
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('twitch-channel'),
        channelId: typebox_1.Type.String(),
    }),
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('kick-channel'),
        channelId: typebox_1.Type.String(),
    }),
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('whip'),
        username: typebox_1.Type.String(),
    }),
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('local-mp4'),
        source: typebox_1.Type.Union([
            typebox_1.Type.Object({ fileName: typebox_1.Type.String() }),
            typebox_1.Type.Object({ url: typebox_1.Type.String() }),
        ]),
    }),
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('image'),
        fileName: typebox_1.Type.Optional(typebox_1.Type.String()),
        imageId: typebox_1.Type.Optional(typebox_1.Type.String()),
    }),
    typebox_1.Type.Object({
        type: typebox_1.Type.Literal('text-input'),
        text: typebox_1.Type.String(),
        textAlign: typebox_1.Type.Optional(typebox_1.Type.Union([
            typebox_1.Type.Literal('left'),
            typebox_1.Type.Literal('center'),
            typebox_1.Type.Literal('right'),
        ])),
    }),
]);
exports.routes.post('/room/:roomId/input', { schema: { body: AddInputSchema } }, async (req, res) => {
    const { roomId } = req.params;
    console.log('[request] Create input', { body: req.body, roomId });
    const room = serverState_1.state.getRoom(roomId);
    const inputId = await room.addNewInput(req.body);
    console.log('[info] Added input', { inputId });
    let bearerToken = '';
    if (inputId) {
        bearerToken = await room.connectInput(inputId);
    }
    let whipUrl = `${config_1.config.whipBaseUrl}/${inputId}`;
    res.status(200).send({ inputId, bearerToken, whipUrl });
});
exports.routes.post('/room/:roomId/input/:inputId/whip/ack', async (req, res) => {
    var _a;
    const { roomId, inputId } = req.params;
    console.log('[request] WHIP ack', { roomId, inputId });
    try {
        const input = serverState_1.state
            .getRoom(roomId)
            .getInputs()
            .find(i => i.inputId === inputId);
        if (!input || input.type !== 'whip') {
            return res.status(400).send({ error: 'Not a WHIP input' });
        }
        await serverState_1.state.getRoom(roomId).ackWhipInput(inputId);
        res.status(200).send({ status: 'ok' });
    }
    catch (err) {
        res.status(400).send({ status: 'error', message: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : 'Invalid input' });
    }
});
exports.routes.post('/room/:roomId/input/:inputId/connect', async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Connect input', { roomId, inputId });
    const room = serverState_1.state.getRoom(roomId);
    await room.connectInput(inputId);
    res.status(200).send({ status: 'ok' });
});
exports.routes.post('/room/:roomId/input/:inputId/disconnect', async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Disconnect input', { roomId, inputId });
    const room = serverState_1.state.getRoom(roomId);
    await room.disconnectInput(inputId);
    res.status(200).send({ status: 'ok' });
});
const UpdateInputSchema = typebox_1.Type.Object({
    volume: typebox_1.Type.Number({ maximum: 1, minimum: 0 }),
    showTitle: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    shaders: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.Object({
        shaderName: typebox_1.Type.String(),
        shaderId: typebox_1.Type.String(),
        enabled: typebox_1.Type.Boolean(),
        params: typebox_1.Type.Array(typebox_1.Type.Object({
            paramName: typebox_1.Type.String(),
            paramValue: typebox_1.Type.Number(),
        })),
    }))),
    orientation: typebox_1.Type.Optional(typebox_1.Type.Union([
        typebox_1.Type.Literal('horizontal'),
        typebox_1.Type.Literal('vertical'),
    ])),
    text: typebox_1.Type.Optional(typebox_1.Type.String()),
    textAlign: typebox_1.Type.Optional(typebox_1.Type.Union([
        typebox_1.Type.Literal('left'),
        typebox_1.Type.Literal('center'),
        typebox_1.Type.Literal('right'),
    ])),
    textColor: typebox_1.Type.Optional(typebox_1.Type.String()),
    textMaxLines: typebox_1.Type.Optional(typebox_1.Type.Number()),
    textScrollSpeed: typebox_1.Type.Optional(typebox_1.Type.Number()),
    textScrollNudge: typebox_1.Type.Optional(typebox_1.Type.Number()),
    attachedInputIds: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.String())),
});
exports.routes.post('/room/:roomId/input/:inputId', { schema: { body: UpdateInputSchema } }, async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Update input', { roomId, inputId, body: JSON.stringify(req.body) });
    const room = serverState_1.state.getRoom(roomId);
    await room.updateInput(inputId, req.body);
    res.status(200).send({ status: 'ok' });
});
exports.routes.delete('/room/:roomId/input/:inputId', async (req, res) => {
    const { roomId, inputId } = req.params;
    console.log('[request] Remove input', { roomId, inputId });
    const room = serverState_1.state.getRoom(roomId);
    await room.removeInput(inputId);
    res.status(200).send({ status: 'ok' });
});
function publicInputState(input) {
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
                attachedInputIds: input.attachedInputIds,
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
                attachedInputIds: input.attachedInputIds,
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
                attachedInputIds: input.attachedInputIds,
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
                attachedInputIds: input.attachedInputIds,
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
                attachedInputIds: input.attachedInputIds,
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
                textFontSize: input.textFontSize,
                attachedInputIds: input.attachedInputIds,
            };
        default:
            throw new Error('Unknown input state');
    }
}
