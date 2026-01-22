"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KickChannelSuggestions = exports.KickChannelMonitor = void 0;
const KickApi_1 = require("../kick/KickApi");
const utils_1 = require("../utils");
const CHOSEN_KICK_CATEGORY = '5'; // Gaming: LOL
const KICK_CATEGORIES = [CHOSEN_KICK_CATEGORY];
const KICK_STREAMS_PER_CATEGORY = 10;
class KickChannelSuggestionsMonitor {
    constructor() {
        this.topStreams = [];
    }
    async monitor() {
        while (true) {
            try {
                console.log('[kick] Refresh category info.');
                await this.refreshCategoryInfo(KICK_CATEGORIES);
            }
            catch (err) {
                console.log('[kick] Failed to refresh channel information', err);
            }
            await (0, utils_1.sleep)(60000);
        }
    }
    getTopStreams() {
        return this.topStreams;
    }
    async refreshCategoryInfo(categories) {
        const streamsByCategory = await Promise.all(categories.map(async (categoryId) => await getKickTopStreams(categoryId)));
        const streams = streamsByCategory.flat();
        this.topStreams = streams;
    }
}
class KickChannelMonitor {
    constructor(channelId, streamInfo) {
        this.isStreamLive = true;
        this.shouldStop = false;
        this.channelId = channelId;
        this.streamInfo = streamInfo;
        void this.monitor();
    }
    static async startMonitor(channelId) {
        const streamInfo = await (0, KickApi_1.getKickStreamInfo)(channelId);
        if (!streamInfo) {
            throw new Error(`Unable to find live streams for ${channelId}`);
        }
        return new KickChannelMonitor(channelId, streamInfo);
    }
    stop() {
        this.shouldStop = true;
    }
    isLive() {
        return this.isStreamLive;
    }
    onUpdate(onUpdateFn) {
        this.onUpdateFn = onUpdateFn;
        onUpdateFn(this.streamInfo, this.isStreamLive);
    }
    async monitor() {
        var _a;
        while (!this.shouldStop) {
            console.log(`[kick] Check stream state ${this.channelId}`);
            try {
                const streamInfo = await (0, KickApi_1.getKickStreamInfo)(this.channelId);
                if (streamInfo) {
                    this.streamInfo = streamInfo;
                    this.isStreamLive = true;
                    (_a = this.onUpdateFn) === null || _a === void 0 ? void 0 : _a.call(this, streamInfo, this.isStreamLive);
                }
                else {
                    this.isStreamLive = false;
                    return;
                }
                await (0, utils_1.sleep)(20000);
            }
            catch (err) {
                console.log('[kick] Failed to refresh Kick channel information', err);
            }
        }
    }
}
exports.KickChannelMonitor = KickChannelMonitor;
async function getKickTopStreams(categoryId) {
    const topStreams = await (0, KickApi_1.getKickTopStreamsFromCategory)(categoryId, KICK_STREAMS_PER_CATEGORY);
    console.log('[kick] Got Kick top streams');
    return topStreams.map(stream => ({
        streamId: `${stream.slug}`,
        displayName: stream.stream_title,
        title: stream.stream_title,
        category: stream.category.name,
    }));
}
exports.KickChannelSuggestions = new KickChannelSuggestionsMonitor();
