import path from 'node:path';
import type { ModelManifest } from '../registry';

const MOTION_DIR = path.join(__dirname, '.');

export const MOTION_MANIFEST: ModelManifest = {
  id: 'motion',
  name: 'Motion Detection',
  description: 'Frame-differencing motion scores per input',
  needsVideo: true,
  needsAudio: false,
  defaultDelayMs: 0,
  maxDelayMs: 2000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(MOTION_DIR, 'worker.py'),
  requirementsFile: path.join(MOTION_DIR, 'requirements.txt'),
  venvDir: path.join(MOTION_DIR, '.venv'),
  envOverrideKey: 'MOTION_PYTHON_PATH',
  wsPort: 8083,
  depsCheck: 'import cv2; import numpy; import websockets; import smelter',
};
