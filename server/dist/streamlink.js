"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hlsUrlForTwitchChannel = hlsUrlForTwitchChannel;
exports.hlsUrlForKickChannel = hlsUrlForKickChannel;
const utils_1 = require("./utils");
async function hlsUrlForTwitchChannel(channelId) {
    const url = `https://www.twitch.tv/${channelId}`;
    return await getHlsPlaylistUrl(url);
}
async function hlsUrlForKickChannel(channelId) {
    const url = `https://kick.com/${channelId}`;
    return await getHlsPlaylistUrl(url);
}
async function getHlsPlaylistUrl(url) {
    const streamlinkOutput = await (0, utils_1.spawn)('streamlink', ['--stream-url', url, '720p,720p60,best'], {
        stdio: 'pipe',
    });
    return streamlinkOutput.stdout.trim();
}
