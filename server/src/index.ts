import { state } from './server/serverState';
import { TwitchChannelSuggestions } from './twitch/TwitchChannelMonitor';
import { KickChannelSuggestions } from './kick/KickChannelMonitor';
import { SmelterInstance } from './smelter';
import { routes } from './server/routes';
import { initDashboard, hijackConsole } from './dashboard';
import './snakeGame/registerSnakeGameRenderer';

hijackConsole();

let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);

  state.stopMonitoring();
  TwitchChannelSuggestions.stop();
  KickChannelSuggestions.stop();

  process.exit(0);
}

async function run() {
  console.log('Start monitoring Twitch categories.');
  void TwitchChannelSuggestions.monitor();
  void KickChannelSuggestions.monitor();
  console.log('Start Smelter instance');
  await SmelterInstance.init();

  const port = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
  await routes.listen({ port, host: '0.0.0.0' });

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  initDashboard();
}

run().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
