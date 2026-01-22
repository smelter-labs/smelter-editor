"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKickTopStreamsFromCategory = getKickTopStreamsFromCategory;
exports.getKickStreamInfo = getKickStreamInfo;
const url_1 = require("url");
const kickAuth = {
    token: null,
    clientId: null,
    tokenPromise: null,
};
function getConfig() {
    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.warn('Missing Kick credentials');
        return null;
    }
    return {
        clientId,
        clientSecret,
    };
}
async function kickFetch(input, init = {}, retry = true) {
    if (!kickAuth.token) {
        await refreshKickToken();
    }
    const headers = new Headers(init.headers || {});
    if (kickAuth.token) {
        headers.set('Authorization', `Bearer ${kickAuth.token}`);
    }
    let response = await fetch(input, { ...init, headers });
    if (response.status === 401 && retry) {
        await refreshKickToken(true);
        headers.set('Authorization', `Bearer ${kickAuth.token}`);
        response = await fetch(input, { ...init, headers });
    }
    return response;
}
async function refreshKickToken(force = false) {
    if (kickAuth.tokenPromise && !force) {
        await kickAuth.tokenPromise;
        return;
    }
    const config = getConfig();
    if (!config) {
        kickAuth.token = null;
        kickAuth.clientId = null;
        return;
    }
    kickAuth.tokenPromise = (async () => {
        const response = await fetch('https://id.kick.com/oauth/token', {
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
            kickAuth.token = null;
            kickAuth.clientId = null;
            throw new Error(`Failed to fetch access token: ${await response.text()}`);
        }
        const data = await response.json();
        kickAuth.token = data.access_token;
        kickAuth.clientId = config.clientId;
        console.log(`[kick] Got Kick access token`);
    })();
    await kickAuth.tokenPromise;
    kickAuth.tokenPromise = null;
}
async function getKickTopStreamsFromCategory(categoryId, count = 5) {
    const response = await kickFetch(`https://api.kick.com/public/v1/livestreams?category_id=${categoryId}&limit=${count}&language=en`);
    if (!response.ok) {
        throw new Error('Failed to fetch streams from Kick API');
    }
    const topStreams = await response.json();
    return topStreams.data;
}
async function getKickStreamInfo(kickChannelSlug) {
    const response = await kickFetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(kickChannelSlug)}`);
    if (!response.ok) {
        throw new Error(`Failed to get stream status for ${kickChannelSlug}: ${await response.text()}`);
    }
    const data = await response.json();
    const stream = data.data ? data.data[0] : null;
    return {
        streamId: kickChannelSlug,
        displayName: (stream === null || stream === void 0 ? void 0 : stream.stream_title) || '',
        title: (stream === null || stream === void 0 ? void 0 : stream.stream_title) || '',
        category: (stream === null || stream === void 0 ? void 0 : stream.category.name) || '',
    };
}
