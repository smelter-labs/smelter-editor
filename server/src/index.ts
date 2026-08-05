import { rmSync } from 'node:fs';
import { state } from './core/serverState';
import { TwitchChannelSuggestions } from './twitch/TwitchChannelMonitor';
import { KickChannelSuggestions } from './kick/KickChannelMonitor';
import { SmelterInstance } from './smelter';
import { CaptionBridge } from './captions/CaptionBridge';
import { setCaptionBridge } from './captions/captionBridgeRegistry';
import {
  createCaptionSocketDir,
  logSocketPathBudget,
} from './captions/captionSocket';
import { captionsDebug } from './captions/captionsDebug';
import { registerAIModels } from './ai-models';
import { routes } from './routing/routes';
import { seedPresentationConfigs } from './core/seedPresentationConfigs';
import { initDashboard, hijackConsole } from './dashboard';
import './snakeGame/registerSnakeGameRenderer';

hijackConsole();

let isShuttingDown = false;
let captionSocketDir: string | null = null;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);

  state.stopMonitoring();
  TwitchChannelSuggestions.stop();
  KickChannelSuggestions.stop();
  if (captionSocketDir) {
    rmSync(captionSocketDir, { recursive: true, force: true });
  }

  process.exit(0);
}

async function run() {
  console.log('Start monitoring Twitch categories.');
  void TwitchChannelSuggestions.monitor();
  void KickChannelSuggestions.monitor();

  // The captions side-channel writes input audio to unix sockets in this dir.
  // It must be set before Smelter starts so registerInput can use it.
  // Use a short fixed path — macOS SUN_LEN (~103) is exceeded when combined
  // with our long input ids if we use the default temp dir prefix.
  captionSocketDir = createCaptionSocketDir();
  process.env.SMELTER_SIDE_CHANNEL_SOCKET_DIR = captionSocketDir;
  logSocketPathBudget(captionSocketDir);
  if (captionsDebug) {
    console.log('[captions:debug] CAPTIONS_DEBUG=1 — verbose caption logging enabled');
  }

  console.log('Start Smelter instance');
  registerAIModels();
  await SmelterInstance.init();

  const captionBridge = new CaptionBridge({
    port: Number(process.env.CAPTIONS_WS_PORT) || 8082,
    socketDir: captionSocketDir,
    onTranscript: (event) => state.applyTranscript(event),
  });
  setCaptionBridge(captionBridge);
  await captionBridge.start();

  await seedPresentationConfigs();

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
