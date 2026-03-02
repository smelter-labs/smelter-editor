import { SmelterInstance } from './smelter';
import { routes } from './server/routes';
import { TwitchChannelSuggestions } from './twitch/TwitchChannelMonitor';
import { KickChannelSuggestions } from './kick/KickChannelMonitor';
import { initDashboard, hijackConsole } from './dashboard';

hijackConsole();

async function run() {
  console.log('Start monitoring Twitch categories.');
  void TwitchChannelSuggestions.monitor();
  void KickChannelSuggestions.monitor();
  console.log('Start Smelter instance');
  await SmelterInstance.init();

  const port = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
  await routes.listen({ port, host: '0.0.0.0' });

  initDashboard();
}

run().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
