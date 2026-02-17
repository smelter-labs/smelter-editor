"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomState = void 0;
const fs_extra_1 = require("fs-extra");
const node_path_1 = __importDefault(require("node:path"));
const smelter_1 = require("../smelter");
const streamlink_1 = require("../streamlink");
const TwitchChannelMonitor_1 = require("../twitch/TwitchChannelMonitor");
const utils_1 = require("../utils");
const mp4SuggestionMonitor_1 = __importDefault(require("../mp4/mp4SuggestionMonitor"));
const KickChannelMonitor_1 = require("../kick/KickChannelMonitor");
const WhipInputMonitor_1 = require("../whip/WhipInputMonitor");
const PLACEHOLDER_LOGO_FILE = 'logo_Smelter.png';
class RoomState {
    constructor(idPrefix, output, initInputs, skipDefaultInputs = false, displayName) {
        this.layout = 'picture-in-picture';
        this.isPublic = false;
        this.mp4sDir = node_path_1.default.join(process.cwd(), 'mp4s');
        this.mp4Files = mp4SuggestionMonitor_1.default.mp4Files;
        this.inputs = [];
        this.idPrefix = idPrefix;
        this.output = output;
        this.displayName = displayName;
        this.lastReadTimestamp = Date.now();
        this.creationTimestamp = Date.now();
        void (async () => {
            await this.getInitialInputState(idPrefix, initInputs, skipDefaultInputs);
            const realThis = this;
            for (let i = 0; i < realThis.inputs.length; i++) {
                const maybeInput = realThis.inputs[i];
                if (maybeInput) {
                    await this.connectInput(maybeInput.inputId);
                }
            }
        })();
    }
    async getInitialInputState(idPrefix, initInputs, skipDefaultInputs = false) {
        if (initInputs.length > 0) {
            for (const input of initInputs) {
                await this.addNewInput(input);
            }
        }
        else if (!skipDefaultInputs) {
            // Filter out files starting with "logo_" or "wrapped_" for default auto-add
            const eligibleMp4Files = this.mp4Files.filter(file => !isBlockedDefaultMp4(file));
            if (eligibleMp4Files.length > 0) {
                const randomIndex = Math.floor(Math.random() * eligibleMp4Files.length);
                for (let i = 0; i < 2; i++) {
                    const randomMp4 = eligibleMp4Files[(randomIndex + i) % eligibleMp4Files.length];
                    const mp4FilePath = node_path_1.default.join(this.mp4sDir, randomMp4);
                    this.inputs.push({
                        inputId: `${idPrefix}::local::sample_streamer::${i}`,
                        type: 'local-mp4',
                        status: 'disconnected',
                        showTitle: false,
                        shaders: [],
                        orientation: 'horizontal',
                        metadata: {
                            title: `[MP4] ${formatMp4Name(randomMp4)}`,
                            description: '[Static source] AI Generated',
                        },
                        mp4FilePath,
                        volume: 0,
                    });
                }
            }
        }
        // Ensure placeholder is added if no inputs exist
        await this.ensurePlaceholder();
    }
    getWhepUrl() {
        return this.output.url;
    }
    getResolution() {
        return this.output.resolution;
    }
    hasActiveRecording() {
        return !!this.recording && !this.recording.stoppedAt;
    }
    async startRecording() {
        if (this.hasActiveRecording()) {
            throw new Error('Recording is already in progress for this room');
        }
        const recordingsDir = node_path_1.default.join(process.cwd(), 'recordings');
        await (0, fs_extra_1.ensureDir)(recordingsDir);
        const timestamp = Date.now();
        const recordingId = `${this.idPrefix}::recording::${timestamp}`;
        const safeRoomId = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `recording-${safeRoomId}-${timestamp}.mp4`;
        const filePath = node_path_1.default.join(recordingsDir, fileName);
        await smelter_1.SmelterInstance.registerMp4Output(recordingId, this.output, filePath);
        this.recording = {
            outputId: recordingId,
            filePath,
            fileName,
            startedAt: timestamp,
        };
        return { fileName };
    }
    async stopRecording() {
        if (!this.recording || this.recording.stoppedAt) {
            throw new Error('No active recording to stop for this room');
        }
        try {
            await smelter_1.SmelterInstance.unregisterOutput(this.recording.outputId);
        }
        finally {
            this.recording.stoppedAt = Date.now();
        }
        // Enforce a global cap on stored recordings to avoid unbounded growth.
        // Keep only the newest N recordings on disk and remove older ones.
        try {
            await pruneOldRecordings(10);
        }
        catch (err) {
            // Best-effort cleanup – log but don't fail the API if pruning fails.
            console.error('Failed to prune old recordings', err);
        }
        return { fileName: this.recording.fileName };
    }
    getState() {
        this.lastReadTimestamp = Date.now();
        return [this.inputs, this.layout];
    }
    getInputs() {
        return this.inputs;
    }
    getPlaceholderId() {
        return `${this.idPrefix}::placeholder::smelter-logo`;
    }
    isPlaceholder(inputId) {
        return inputId === this.getPlaceholderId();
    }
    async ensurePlaceholder() {
        // Check if there are any non-placeholder inputs
        const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
        if (nonPlaceholderInputs.length > 0) {
            return; // Don't add placeholder if there are real inputs
        }
        // Check if placeholder already exists
        if (this.inputs.find(inp => this.isPlaceholder(inp.inputId))) {
            return; // Placeholder already exists
        }
        // Add placeholder
        const inputId = this.getPlaceholderId();
        const picturesDir = node_path_1.default.join(process.cwd(), 'pictures');
        const imagePath = node_path_1.default.join(picturesDir, PLACEHOLDER_LOGO_FILE);
        if (await (0, fs_extra_1.pathExists)(imagePath)) {
            const imageId = `placeholder::smelter-logo`;
            const assetType = 'png';
            // Register image resource
            try {
                await smelter_1.SmelterInstance.registerImage(imageId, {
                    serverPath: imagePath,
                    assetType: assetType,
                });
            }
            catch {
                // ignore if already registered
            }
            this.inputs.push({
                inputId,
                type: 'image',
                status: 'connected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: 'Smelter',
                    description: '',
                },
                volume: 0,
                imageId,
            });
            this.updateStoreWithState();
        }
    }
    async removePlaceholder() {
        const placeholder = this.inputs.find(inp => this.isPlaceholder(inp.inputId));
        if (placeholder) {
            this.inputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
            this.updateStoreWithState();
        }
    }
    async addNewWhipInput(username) {
        const inputId = `${this.idPrefix}::whip::${Date.now()}`;
        const monitor = await WhipInputMonitor_1.WhipInputMonitor.startMonitor(username);
        monitor.touch();
        this.inputs.push({
            inputId,
            type: 'whip',
            status: 'disconnected',
            showTitle: false,
            shaders: [],
            orientation: 'horizontal',
            monitor: monitor,
            metadata: {
                title: `[Camera] ${username}`,
                description: `Whip Input for ${username}`,
            },
            volume: 0,
            whipUrl: '',
        });
        return inputId;
    }
    async addNewInput(opts) {
        var _a, _b, _c, _d, _e, _f;
        // Remove placeholder if it exists
        await this.removePlaceholder();
        if (opts.type === 'whip') {
            const inputId = await this.addNewWhipInput(opts.username);
            return inputId;
        }
        else if (opts.type === 'twitch-channel') {
            const inputId = inputIdForTwitchInput(this.idPrefix, opts.channelId);
            if (this.inputs.find(input => input.inputId === inputId)) {
                throw new Error(`Input for Twitch channel ${opts.channelId} already exists.`);
            }
            const hlsUrl = await (0, streamlink_1.hlsUrlForTwitchChannel)(opts.channelId);
            const monitor = await TwitchChannelMonitor_1.TwitchChannelMonitor.startMonitor(opts.channelId);
            const inputState = {
                inputId,
                type: `twitch-channel`,
                status: 'disconnected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: '', // will be populated on update
                    description: '',
                },
                volume: 0,
                channelId: opts.channelId,
                hlsUrl,
                monitor,
            };
            monitor.onUpdate((streamInfo, _isLive) => {
                inputState.metadata.title = `[Twitch.tv/${streamInfo.category}] ${streamInfo.displayName}`;
                inputState.metadata.description = streamInfo.title;
                this.updateStoreWithState();
            });
            this.inputs.push(inputState);
            return inputId;
        }
        else if (opts.type === 'kick-channel') {
            const inputId = inputIdForKickInput(this.idPrefix, opts.channelId);
            if (this.inputs.find(input => input.inputId === inputId)) {
                throw new Error(`Input for Kick channel ${opts.channelId} already exists.`);
            }
            const hlsUrl = await (0, streamlink_1.hlsUrlForKickChannel)(opts.channelId);
            const monitor = await KickChannelMonitor_1.KickChannelMonitor.startMonitor(opts.channelId);
            const inputState = {
                inputId,
                type: `kick-channel`,
                status: 'disconnected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: '', // will be populated on update
                    description: '',
                },
                volume: 0,
                channelId: opts.channelId,
                hlsUrl,
                monitor,
            };
            monitor.onUpdate((streamInfo, _isLive) => {
                inputState.metadata.title = `[Kick.com] ${streamInfo.displayName}`;
                inputState.metadata.description = streamInfo.title;
                this.updateStoreWithState();
            });
            this.inputs.push(inputState);
            return inputId;
        }
        else if (opts.type === 'local-mp4' && opts.source.fileName) {
            console.log('Adding local mp4');
            let mp4Path = node_path_1.default.join(process.cwd(), 'mp4s', opts.source.fileName);
            let mp4Name = opts.source.fileName;
            const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;
            if (await (0, fs_extra_1.pathExists)(mp4Path)) {
                this.inputs.push({
                    inputId,
                    type: 'local-mp4',
                    status: 'disconnected',
                    showTitle: false,
                    shaders: [],
                    orientation: 'horizontal',
                    metadata: {
                        title: `[MP4] ${formatMp4Name(mp4Name)}`,
                        description: '[Static source] AI Generated',
                    },
                    mp4FilePath: mp4Path,
                    volume: 0,
                });
            }
            return inputId;
        }
        else if (opts.type === 'image') {
            console.log('Adding image');
            const picturesDir = node_path_1.default.join(process.cwd(), 'pictures');
            const inputId = `${this.idPrefix}::image::${Date.now()}`;
            const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
            let fileName = opts.fileName;
            let imageId = opts.imageId;
            // If imageId is provided but not fileName, find the file
            if (imageId && !fileName) {
                const baseName = imageId.replace(/^pictures::/, '');
                const files = await (0, fs_extra_1.readdir)(picturesDir).catch(() => []);
                const found = files.find(f => {
                    const fBase = f.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
                    return fBase === baseName;
                });
                if (found) {
                    fileName = found;
                }
                else {
                    throw new Error(`Image file not found for imageId: ${imageId}`);
                }
            }
            if (!fileName) {
                throw new Error('Either fileName or imageId must be provided for image input');
            }
            const imagePath = node_path_1.default.join(picturesDir, fileName);
            if (await (0, fs_extra_1.pathExists)(imagePath)) {
                const lower = fileName.toLowerCase();
                const ext = exts.find(x => lower.endsWith(x));
                if (!ext) {
                    throw new Error(`Unsupported image format: ${fileName}`);
                }
                const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
                imageId = `pictures::${baseName}`;
                const assetType = ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';
                // Register image resource
                try {
                    await smelter_1.SmelterInstance.registerImage(imageId, {
                        serverPath: imagePath,
                        assetType: assetType,
                    });
                }
                catch {
                    // ignore if already registered
                }
                this.inputs.push({
                    inputId,
                    type: 'image',
                    status: 'connected',
                    showTitle: false,
                    shaders: [],
                    orientation: 'horizontal',
                    metadata: {
                        title: formatImageName(fileName),
                        description: '',
                    },
                    volume: 0,
                    imageId,
                });
                this.updateStoreWithState();
            }
            else {
                throw new Error(`Image file not found: ${fileName}`);
            }
            return inputId;
        }
        else if (opts.type === 'text-input') {
            console.log('Adding text input');
            const inputId = `${this.idPrefix}::text::${Date.now()}`;
            this.inputs.push({
                inputId,
                type: 'text-input',
                status: 'connected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: 'Text',
                    description: '',
                },
                volume: 0,
                text: opts.text,
                textAlign: (_a = opts.textAlign) !== null && _a !== void 0 ? _a : 'left',
                textColor: (_b = opts.textColor) !== null && _b !== void 0 ? _b : '#ffffff',
                textMaxLines: (_c = opts.textMaxLines) !== null && _c !== void 0 ? _c : 10,
                textScrollSpeed: (_d = opts.textScrollSpeed) !== null && _d !== void 0 ? _d : 40,
                textScrollLoop: (_e = opts.textScrollLoop) !== null && _e !== void 0 ? _e : true,
                textScrollNudge: 0,
                textFontSize: (_f = opts.textFontSize) !== null && _f !== void 0 ? _f : 80,
            });
            this.updateStoreWithState();
            return inputId;
        }
    }
    async removeInput(inputId) {
        const input = this.getInput(inputId);
        // Check if this is the last non-placeholder input
        const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
        const willBeEmpty = nonPlaceholderInputs.length === 1 && nonPlaceholderInputs[0].inputId === inputId;
        // If removing the last input, add placeholder first
        if (willBeEmpty) {
            await this.ensurePlaceholder();
        }
        this.inputs = this.inputs.filter(input => input.inputId !== inputId);
        this.updateStoreWithState();
        if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
            input.monitor.stop();
        }
        while (input.status === 'pending') {
            await (0, utils_1.sleep)(500);
        }
        if (input.status === 'connected') {
            try {
                await smelter_1.SmelterInstance.unregisterInput(inputId);
            }
            catch (err) {
                console.log(err, 'Failed to unregister when removing input.');
            }
            input.status = 'disconnected';
        }
    }
    async connectInput(inputId) {
        var _a;
        const input = this.getInput(inputId);
        if (input.status !== 'disconnected') {
            return '';
        }
        // Images are static resources, they don't need to be connected as stream inputs
        if (input.type === 'image') {
            input.status = 'connected';
            this.updateStoreWithState();
            return '';
        }
        input.status = 'pending';
        const options = registerOptionsFromInput(input);
        let response = '';
        try {
            const res = await smelter_1.SmelterInstance.registerInput(inputId, options);
            response = res;
        }
        catch (err) {
            response = (_a = err.body) === null || _a === void 0 ? void 0 : _a.url;
            input.status = 'disconnected';
            throw err;
        }
        input.status = 'connected';
        this.updateStoreWithState();
        return response;
    }
    async ackWhipInput(inputId) {
        const input = this.getInput(inputId);
        if (input.type !== 'whip') {
            throw new Error('Input is not a Whip input');
        }
        input.monitor.touch();
    }
    async disconnectInput(inputId) {
        const input = this.getInput(inputId);
        if (input.status === 'disconnected') {
            return;
        }
        input.status = 'pending';
        this.updateStoreWithState();
        try {
            await smelter_1.SmelterInstance.unregisterInput(inputId);
        }
        finally {
            input.status = 'disconnected';
            this.updateStoreWithState();
        }
    }
    async removeStaleWhipInputs(staleTtlMs) {
        const now = Date.now();
        for (const input of this.getInputs()) {
            if (input.type === 'whip') {
                const last = input.monitor.getLastAckTimestamp() || 0;
                if (now - last > staleTtlMs) {
                    try {
                        console.log('[monitor] Removing stale WHIP input', { inputId: input.inputId });
                        await this.removeInput(input.inputId);
                    }
                    catch (err) {
                        console.log(err, 'Failed to remove stale WHIP input');
                    }
                }
            }
        }
    }
    async updateInput(inputId, options) {
        var _a, _b, _c, _d;
        const input = this.getInput(inputId);
        input.volume = (_a = options.volume) !== null && _a !== void 0 ? _a : input.volume;
        input.shaders = (_b = options.shaders) !== null && _b !== void 0 ? _b : input.shaders;
        input.showTitle = (_c = options.showTitle) !== null && _c !== void 0 ? _c : input.showTitle;
        input.orientation = (_d = options.orientation) !== null && _d !== void 0 ? _d : input.orientation;
        if (input.type === 'text-input') {
            if (options.text !== undefined) {
                input.text = options.text;
            }
            if (options.textAlign !== undefined) {
                input.textAlign = options.textAlign;
            }
            if (options.textColor !== undefined) {
                input.textColor = options.textColor;
            }
            if (options.textMaxLines !== undefined) {
                input.textMaxLines = options.textMaxLines;
            }
            if (options.textScrollSpeed !== undefined) {
                input.textScrollSpeed = options.textScrollSpeed;
            }
            if (options.textScrollLoop !== undefined) {
                input.textScrollLoop = options.textScrollLoop;
            }
            if (options.textScrollNudge !== undefined) {
                input.textScrollNudge = options.textScrollNudge;
            }
            if (options.textFontSize !== undefined) {
                input.textFontSize = options.textFontSize;
            }
        }
        if (options.attachedInputIds !== undefined) {
            input.attachedInputIds = options.attachedInputIds;
        }
        this.updateStoreWithState();
    }
    reorderInputs(inputOrder) {
        const inputIdSet = new Set(this.inputs.map(input => input.inputId));
        const inputs = [];
        for (const inputId of inputOrder) {
            const input = this.inputs.find(input => input.inputId === inputId);
            if (input) {
                inputs.push(input);
                inputIdSet.delete(inputId);
            }
        }
        for (const inputId of inputIdSet) {
            const input = this.inputs.find(input => input.inputId === inputId);
            if (input) {
                inputs.push(input);
            }
        }
        this.inputs = inputs;
        this.updateStoreWithState();
    }
    async updateLayout(layout) {
        this.layout = layout;
        // When switching to wrapped layout, remove wrapped-static image inputs and add wrapped MP4s
        if (layout === 'wrapped') {
            await this.removeWrappedStaticInputs();
            void this.ensureWrappedMp4Inputs();
        }
        // When switching to wrapped-static layout, remove wrapped MP4 inputs and add wrapped images
        if (layout === 'wrapped-static') {
            await this.removeWrappedMp4Inputs();
            void this.ensureWrappedImageInputs();
        }
        this.updateStoreWithState();
    }
    async deleteRoom() {
        var _a, _b, _c;
        const inputs = this.inputs;
        this.inputs = [];
        for (const input of inputs) {
            if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
                input.monitor.stop();
            }
            try {
                await smelter_1.SmelterInstance.unregisterInput(input.inputId);
            }
            catch (err) {
                console.error('Failed to remove input when removing the room.', (_a = err === null || err === void 0 ? void 0 : err.body) !== null && _a !== void 0 ? _a : err);
            }
        }
        try {
            await smelter_1.SmelterInstance.unregisterOutput(this.output.id);
        }
        catch (err) {
            console.error('Failed to remove output', (_b = err === null || err === void 0 ? void 0 : err.body) !== null && _b !== void 0 ? _b : err);
        }
        if (this.recording && !this.recording.stoppedAt) {
            try {
                await smelter_1.SmelterInstance.unregisterOutput(this.recording.outputId);
            }
            catch (err) {
                console.error('Failed to remove recording output', (_c = err === null || err === void 0 ? void 0 : err.body) !== null && _c !== void 0 ? _c : err);
            }
        }
    }
    updateStoreWithState() {
        const toInputConfig = (input) => ({
            inputId: input.inputId,
            title: input.metadata.title,
            description: input.metadata.description,
            showTitle: input.showTitle,
            volume: input.volume,
            shaders: input.shaders,
            orientation: input.orientation,
            imageId: input.type === 'image' ? input.imageId : undefined,
            text: input.type === 'text-input' ? input.text : undefined,
            textAlign: input.type === 'text-input' ? input.textAlign : undefined,
            textColor: input.type === 'text-input' ? input.textColor : undefined,
            textMaxLines: input.type === 'text-input' ? input.textMaxLines : undefined,
            textScrollSpeed: input.type === 'text-input' ? input.textScrollSpeed : undefined,
            textScrollLoop: input.type === 'text-input' ? input.textScrollLoop : undefined,
            textScrollNudge: input.type === 'text-input' ? input.textScrollNudge : undefined,
            textFontSize: input.type === 'text-input' ? input.textFontSize : undefined,
        });
        const connectedInputs = this.inputs.filter(input => input.status === 'connected');
        const connectedMap = new Map();
        for (const input of connectedInputs) {
            connectedMap.set(input.inputId, input);
        }
        const attachedIds = new Set();
        for (const input of connectedInputs) {
            if (input.attachedInputIds) {
                for (const id of input.attachedInputIds) {
                    attachedIds.add(id);
                }
            }
        }
        const inputs = connectedInputs
            .filter(input => !attachedIds.has(input.inputId))
            .map(input => {
            const config = toInputConfig(input);
            if (input.attachedInputIds && input.attachedInputIds.length > 0) {
                config.attachedInputs = input.attachedInputIds
                    .map(id => connectedMap.get(id))
                    .filter((i) => !!i)
                    .map(toInputConfig);
            }
            return config;
        });
        this.output.store.getState().updateState(inputs, this.layout);
    }
    getInput(inputId) {
        const input = this.inputs.find(input => input.inputId === inputId);
        if (!input) {
            throw new Error(`Input ${inputId} not found`);
        }
        return input;
    }
    // Remove all wrapped-static image inputs
    async removeWrappedStaticInputs() {
        const inputsToRemove = this.inputs.filter(input => { var _a; return input.type === 'image' && ((_a = input.imageId) === null || _a === void 0 ? void 0 : _a.startsWith('wrapped::')); });
        for (const input of inputsToRemove) {
            await this.removeInput(input.inputId);
        }
    }
    // Remove all wrapped MP4 inputs
    async removeWrappedMp4Inputs() {
        const inputsToRemove = this.inputs.filter(input => input.type === 'local-mp4' && input.inputId.includes('::local::wrapped::'));
        for (const input of inputsToRemove) {
            await this.removeInput(input.inputId);
        }
    }
    // Add every MP4 from wrapped/ as an input (if not present).
    async ensureWrappedMp4Inputs() {
        const wrappedDir = node_path_1.default.join(process.cwd(), 'wrapped');
        let entries = [];
        try {
            entries = await (0, fs_extra_1.readdir)(wrappedDir);
        }
        catch {
            return;
        }
        // Keep deterministic order
        entries.sort((a, b) => a.localeCompare(b, 'en'));
        const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));
        // Remove placeholder if we're adding inputs
        if (mp4s.length > 0) {
            await this.removePlaceholder();
        }
        for (const fileName of mp4s) {
            const absPath = node_path_1.default.join(wrappedDir, fileName);
            const baseName = fileName.replace(/\.mp4$/i, '');
            const inputId = `${this.idPrefix}::local::wrapped::${baseName}`;
            if (this.inputs.find(inp => inp.inputId === inputId)) {
                continue;
            }
            this.inputs.push({
                inputId,
                type: 'local-mp4',
                status: 'disconnected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: `[MP4] ${formatMp4Name(fileName)}`,
                    description: '[Wrapped MP4]',
                },
                mp4FilePath: absPath,
                volume: 0,
            });
            // Connect the input
            void this.connectInput(inputId);
        }
    }
    // Add every image from wrapped/ as an input (if not present). Registers images on the fly.
    async ensureWrappedImageInputs() {
        const wrappedDir = node_path_1.default.join(process.cwd(), 'wrapped');
        let entries = [];
        try {
            entries = await (0, fs_extra_1.readdir)(wrappedDir);
        }
        catch {
            return;
        }
        // Keep deterministic order
        entries.sort((a, b) => a.localeCompare(b, 'en'));
        const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
        const images = entries.filter(e => exts.some(ext => e.toLowerCase().endsWith(ext)));
        // Remove placeholder if we're adding inputs
        if (images.length > 0) {
            await this.removePlaceholder();
        }
        for (const fileName of images) {
            const lower = fileName.toLowerCase();
            const ext = exts.find(x => lower.endsWith(x));
            const absPath = node_path_1.default.join(wrappedDir, fileName);
            const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
            const imageId = `wrapped::${baseName}`;
            const inputId = `${this.idPrefix}::image::${baseName}`;
            // register image resource
            const assetType = ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';
            try {
                await smelter_1.SmelterInstance.registerImage(imageId, {
                    serverPath: absPath,
                    assetType: assetType,
                });
            }
            catch {
                // ignore if already registered
            }
            if (this.inputs.find(inp => inp.inputId === inputId)) {
                continue;
            }
            this.inputs.push({
                inputId,
                type: 'image',
                status: 'connected',
                showTitle: false,
                shaders: [],
                orientation: 'horizontal',
                metadata: {
                    title: formatImageName(fileName),
                    description: '',
                },
                volume: 0,
                imageId,
            });
        }
    }
}
exports.RoomState = RoomState;
function registerOptionsFromInput(input) {
    if (input.type === 'local-mp4') {
        return { type: 'mp4', filePath: input.mp4FilePath };
    }
    else if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
        return { type: 'hls', url: input.hlsUrl };
    }
    else if (input.type === 'whip') {
        return { type: 'whip', url: input.whipUrl };
    }
    else if (input.type === 'image') {
        // Images are static resources, they don't need to be registered as inputs
        // They are already registered via registerImage and used directly in layouts
        throw Error('Images cannot be connected as stream inputs');
    }
    else {
        throw Error('Unknown type');
    }
}
function inputIdForTwitchInput(idPrefix, twitchChannelId) {
    return `${idPrefix}::twitch::${twitchChannelId}`;
}
function inputIdForKickInput(idPrefix, kickChannelId) {
    return `${idPrefix}::kick::${kickChannelId}`;
}
function formatMp4Name(fileName) {
    const fileNameWithoutExt = fileName.replace(/\.mp4$/i, '');
    return fileNameWithoutExt
        .split(/[_\- ]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function formatImageName(fileName) {
    const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
    return fileNameWithoutExt
        .split(/[_\- ]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function isBlockedDefaultMp4(fileName) {
    const lower = fileName.toLowerCase();
    return lower.startsWith('logo_') || lower.startsWith('wrapped_');
}
/**
 * Keep at most `maxCount` newest MP4 recording files in the global
 * recordings directory by deleting the oldest ones.
 */
async function pruneOldRecordings(maxCount) {
    const recordingsDir = node_path_1.default.join(process.cwd(), 'recordings');
    if (!(await (0, fs_extra_1.pathExists)(recordingsDir))) {
        return;
    }
    let entries = [];
    try {
        entries = await (0, fs_extra_1.readdir)(recordingsDir);
    }
    catch {
        // If we can't read the directory, silently skip pruning.
        return;
    }
    const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));
    if (mp4s.length <= maxCount) {
        return;
    }
    const parsed = [];
    for (const file of mp4s) {
        // Expected pattern: recording-<safeRoomId>-<timestamp>.mp4
        const match = file.match(/^recording-.*-(\d+)\.mp4$/);
        const ts = match ? Number(match[1]) : NaN;
        if (!Number.isFinite(ts)) {
            // Fallback: treat unknown pattern as very old so it gets pruned first.
            parsed.push({ name: file, timestamp: 0 });
        }
        else {
            parsed.push({ name: file, timestamp: ts });
        }
    }
    parsed.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = parsed.slice(0, Math.max(0, parsed.length - maxCount));
    for (const file of toDelete) {
        const fullPath = node_path_1.default.join(recordingsDir, file.name);
        try {
            await (0, fs_extra_1.remove)(fullPath);
        }
        catch (err) {
            // Ignore individual deletion errors – best-effort cleanup.
            console.warn('Failed to remove old recording file', { file: fullPath, err });
        }
    }
}
