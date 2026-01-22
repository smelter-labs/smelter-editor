"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitchChannelSuggestions = exports.TwitchChannelMonitor = void 0;
const TwitchApi_1 = require("./TwitchApi");
const utils_1 = require("../utils");
const CATEGORY_ID_EA_SPORTS_FC_25 = '2011938005';
const CATEGORIES = [CATEGORY_ID_EA_SPORTS_FC_25];
const STREAMS_PER_CATEGORY = 5;
class TwitchChannelSuggestionsMonitor {
    constructor() {
        this.topStreams = [];
    }
    async monitor() {
        while (true) {
            try {
                console.log(`[twitch] Refresh category info.`);
                await this.refreshCategoryInfo(CATEGORIES);
            }
            catch (err) {
                console.log('Failed to refresh Twitch channel information', err);
            }
            await (0, utils_1.sleep)(60000);
        }
    }
    getTopStreams() {
        return this.topStreams;
    }
    async refreshCategoryInfo(categories) {
        const streamsByCategory = await Promise.all(categories.map(async (categoryId) => await getTopStreams(categoryId)));
        const streams = streamsByCategory.flat();
        this.topStreams = streams;
    }
}
class TwitchChannelMonitor {
    constructor(channelId, streamInfo) {
        this.isStreamLive = true;
        this.shouldStop = false;
        this.channelId = channelId;
        this.streamInfo = streamInfo;
        void this.monitor();
    }
    static async startMonitor(channelId) {
        const streamInfo = await (0, TwitchApi_1.getTwitchStreamInfo)(channelId);
        if (!streamInfo) {
            throw new Error(`Unable to find live streams for ${channelId}`);
        }
        return new TwitchChannelMonitor(channelId, streamInfo);
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
            console.log(`[twitch] Check stream state ${this.channelId}`);
            try {
                const streamInfo = await (0, TwitchApi_1.getTwitchStreamInfo)(this.channelId);
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
                console.log('Failed to refresh Twitch channel information', err);
            }
        }
    }
}
exports.TwitchChannelMonitor = TwitchChannelMonitor;
async function getTopStreams(categoryId) {
    console.log('[twitch] Got Twitch top streams');
    const streamIds = await (0, TwitchApi_1.getTopStreamsFromCategory)(categoryId, STREAMS_PER_CATEGORY);
    return await Promise.all(streamIds
        .map(async (streamId) => {
        return (await (0, TwitchApi_1.getTwitchStreamInfo)(streamId));
    })
        .filter(stream => !!stream));
}
exports.TwitchChannelSuggestions = new TwitchChannelSuggestionsMonitor();
