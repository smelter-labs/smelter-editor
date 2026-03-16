import { SmelterInstance } from './smelter';
import { routes } from './server/routes';
import { state } from './server/serverState';
import { TwitchChannelSuggestions } from './twitch/TwitchChannelMonitor';
import { KickChannelSuggestions } from './kick/KickChannelMonitor';
import { initDashboard, hijackConsole } from './dashboard';
import './snakeGame/registerSnakeGameRenderer';

hijackConsole();

const FORCE_EXIT_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}, starting graceful shutdown...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    TwitchChannelSuggestions.stop();
    KickChannelSuggestions.stop();

    await routes.close();

    const rooms = state.getRooms();
    console.log(`Cleaning up ${rooms.length} room(s)...`);
    await Promise.allSettled(
      rooms.map(room =>
        room.deleteRoom().catch(err => {
          console.error(`Failed to clean up room: ${err}`);
        })
      )
    );

    await SmelterInstance.terminate();

    console.log('Graceful shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
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

run().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
