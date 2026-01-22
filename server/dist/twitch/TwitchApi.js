"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTopStreamsFromCategory = getTopStreamsFromCategory;
exports.getTwitchStreamInfo = getTwitchStreamInfo;
const url_1 = require("url");
const twitchAuth = {
    token: null,
    clientId: null,
    tokenPromise: null,
};
function getConfig() {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.warn('Missing twitch credentials');
        return null;
    }
    return {
        clientId,
        clientSecret,
    };
}
async function twitchFetch(input, init = {}, retry = true) {
    if (!twitchAuth.token) {
        await refreshTwitchToken();
    }
    const headers = new Headers(init.headers || {});
    if (twitchAuth.token && twitchAuth.clientId) {
        headers.set('Client-ID', twitchAuth.clientId);
        headers.set('Authorization', `Bearer ${twitchAuth.token}`);
    }
    let response = await fetch(input, { ...init, headers });
    if (response.status === 401 && retry) {
        await refreshTwitchToken(true);
        if (twitchAuth.token && twitchAuth.clientId) {
            headers.set('Client-ID', twitchAuth.clientId);
            headers.set('Authorization', `Bearer ${twitchAuth.token}`);
        }
        response = await fetch(input, { ...init, headers });
    }
    return response;
}
async function refreshTwitchToken(force = false) {
    if (twitchAuth.tokenPromise && !force) {
        await twitchAuth.tokenPromise;
        return;
    }
    const config = getConfig();
    if (!config) {
        twitchAuth.token = null;
        twitchAuth.clientId = null;
        return;
    }
    twitchAuth.tokenPromise = (async () => {
        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new url_1.URLSearchParams({
                client_id: `${config.clientId}`,
                client_secret: `${config.clientSecret}`,
                grant_type: 'client_credentials',
            }),
        });
        if (!response.ok) {
            twitchAuth.token = null;
            twitchAuth.clientId = null;
            throw new Error(`Failed to fetch access token: ${await response.text()}`);
        }
        const data = await response.json();
        twitchAuth.token = data.access_token;
        twitchAuth.clientId = config.clientId;
        console.log(`[twitch] Got Twitch access token`);
    })();
    await twitchAuth.tokenPromise;
    twitchAuth.tokenPromise = null;
}
async function getTopStreamsFromCategory(categoryId, count = 2) {
    const response = await twitchFetch(`https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(categoryId)}&language=en&first=${count}`);
    if (!response.ok) {
        throw new Error('Failed to fetch streams from Twitch API');
    }
    const topStreams = await response.json();
    const topUsersLogins = topStreams.data.map((s) => s.user_login);
    return topUsersLogins;
}
async function getTwitchStreamInfo(twitchChannelId) {
    var _a, _b, _c, _d;
    const response = await twitchFetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(twitchChannelId)}`);
    if (!response.ok) {
        throw new Error(`Failed to get stream status for ${twitchChannelId}: ${await response.text()}`);
    }
    const data = await response.json();
    const stream = data.data ? data.data[0] : null;
    return stream
        ? {
            streamId: twitchChannelId,
            displayName: (_a = stream.user_name) !== null && _a !== void 0 ? _a : '',
            title: (_c = (_b = stream.title) !== null && _b !== void 0 ? _b : stream === null || stream === void 0 ? void 0 : stream.user_name) !== null && _c !== void 0 ? _c : '',
            category: (_d = stream.game_name) !== null && _d !== void 0 ? _d : '',
        }
        : undefined;
}
