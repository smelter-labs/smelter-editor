"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const smelter_1 = require("./smelter");
const routes_1 = require("./server/routes");
const TwitchChannelMonitor_1 = require("./twitch/TwitchChannelMonitor");
const KickChannelMonitor_1 = require("./kick/KickChannelMonitor");
async function run() {
    console.log('Start monitoring Twitch categories.');
    void TwitchChannelMonitor_1.TwitchChannelSuggestions.monitor();
    void KickChannelMonitor_1.KickChannelSuggestions.monitor();
    console.log('Start Smelter instance');
    await smelter_1.SmelterInstance.init();
    const port = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
    console.log(`Start listening on port ${port}`);
    await routes_1.routes.listen({ port, host: '0.0.0.0' });
}
void run();
