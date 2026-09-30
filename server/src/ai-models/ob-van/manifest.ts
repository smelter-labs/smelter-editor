import path from 'node:path';
import type {
  ModelParamSpec,
  ObCamRole,
  ObPresetId,
} from '@smelter-editor/types';
import type { ModelManifest } from '../registry';

const OB_VAN_DIR = path.join(__dirname, '.');
// Shares the people-counter venv (ultralytics / torch / opencv are there) and
// its YOLOv8n weights; `silero-vad` is the only addition (requirements.txt).
const PEOPLE_COUNTER_DIR = path.join(__dirname, '../people-counter');

/** The OB Van signal worker: per-camera audio (VAD, loudness, onsets) + video (people, ball, motion). */
export const OB_VAN_MODEL_ID = 'ob-van';

const DEFAULT_VIDEO_HZ = 5;
const DEFAULT_IMGSZ = 480;
const DEFAULT_CONFIDENCE = 0.35;
const DEFAULT_ONSET_DB = 6;
const DEFAULT_SPEECH_ON = 0.5;
const DEFAULT_SPEECH_OFF = 0.3;

const ON_OFF = [
  { value: '1', label: 'On' },
  { value: '0', label: 'Off' },
];

const OB_VAN_PARAMS: ModelParamSpec[] = [
  {
    type: 'select',
    key: 'video',
    label: 'Video analysis',
    description: 'People, ball and motion. Off for slide / screen cameras.',
    options: ON_OFF,
    default: '1',
  },
  {
    type: 'select',
    key: 'audio',
    label: 'Audio analysis',
    description: 'Speech (Silero VAD), loudness, onsets.',
    options: ON_OFF,
    default: '1',
  },
  {
    type: 'select',
    key: 'ball',
    label: 'Ball detection',
    description: 'Also detect the COCO "sports ball" (sport wide / goal cams).',
    options: ON_OFF,
    default: '0',
  },
  {
    key: 'videoHz',
    label: 'Video rate',
    description:
      'Frames analysed per second (a ceiling — every camera slows down together when inference cannot keep up).',
    min: 1,
    max: 15,
    step: 1,
    default: DEFAULT_VIDEO_HZ,
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher finds smaller people / a farther ball, slower.',
    min: 320,
    max: 960,
    step: 160,
    default: DEFAULT_IMGSZ,
  },
  {
    key: 'confidence',
    label: 'Person confidence',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    default: DEFAULT_CONFIDENCE,
  },
  {
    key: 'onsetDb',
    label: 'Onset jump',
    description:
      'dB above the running level that counts as an onset (beat, hit, first syllable).',
    min: 2,
    max: 18,
    step: 1,
    default: DEFAULT_ONSET_DB,
  },
  {
    key: 'speechOn',
    label: 'Speech on',
    description:
      'VAD probability that opens the speech gate (two windows in a row).',
    min: 0.1,
    max: 0.95,
    step: 0.05,
    default: DEFAULT_SPEECH_ON,
  },
  {
    key: 'speechOff',
    label: 'Speech off',
    description:
      'VAD probability the gate must stay under for 300 ms to close.',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: DEFAULT_SPEECH_OFF,
  },
];

/**
 * OB Van signal worker — one Python process for every room and camera. Per
 * input: side-channel audio → 100 ms hops `{kind:'audio', rms, speechProb,
 * speech, onset, bands}` and side-channel video (~5 Hz) → `{kind:'video',
 * frameW, frameH, persons, ball, motion}`, each with `ptsNanos` (placed on the
 * air clock by `obVan/signals.ts`). Enabled programmatically by the OB Van
 * controller (hidden from the model picker).
 *
 * Delay: 3000 ms (= WHIP_SIDE_CHANNEL_DELAY_MS, so a phone camera never needs
 * a re-registration); with captions on the controller registers 8000 ms.
 */
export const OB_VAN_MANIFEST: ModelManifest = {
  id: OB_VAN_MODEL_ID,
  name: 'OB Van signals',
  description:
    'Speech, loudness, onsets, people, ball and motion per camera for the OB Van auto director.',
  needsVideo: true,
  needsAudio: true,
  defaultDelayMs: 3000,
  maxDelayMs: 8000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(OB_VAN_DIR, 'worker.py'),
  requirementsFile: path.join(OB_VAN_DIR, 'requirements.txt'),
  venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
  envOverrideKey: 'OB_VAN_PYTHON_PATH',
  wsPort: 8093,
  // Fails on a venv without silero-vad → installVenv adds our requirements
  // to the shared venv once. The worker loads Silero's TorchScript file
  // directly, so torchaudio is never imported.
  depsCheck:
    'import cv2; import numpy; import websockets; import smelter; import ultralytics; import importlib.util as u; assert u.find_spec("silero_vad")',
  extraEnv: {
    OB_VAN_YOLO_WEIGHTS: path.join(PEOPLE_COUNTER_DIR, 'yolov8n.pt'),
    OB_VAN_VIDEO_HZ: String(DEFAULT_VIDEO_HZ),
    OB_VAN_AUDIO_HZ: '10',
    OB_VAN_IMGSZ: String(DEFAULT_IMGSZ),
    OB_VAN_FRAME_QUEUE: '2',
  },
  params: OB_VAN_PARAMS,
  hidden: true,
};

/** True for the OB Van model id. */
export function isObVanModel(modelId: string): boolean {
  return modelId === OB_VAN_MODEL_ID;
}

type ObVanParams = Record<string, string | number>;

const VIDEO_OFF: ObVanParams = { video: '0' };
const AUDIO_OFF: ObVanParams = { audio: '0' };
/** A sport wide shot: the ball is small, look often and at more pixels. */
const BALL_WIDE: ObVanParams = { ball: '1', videoHz: 8, imgsz: 640 };

/**
 * Worker params for a camera, by role and preset — what the controller passes
 * when it enables the model on the camera's input. Only the keys that differ
 * from the manifest defaults are set; slide / screen cameras are not analysed
 * at all (the brain still cuts to them by role).
 */
export function obVanParamsForRole(
  role: ObCamRole,
  presetId: ObPresetId,
): ObVanParams {
  if (role === 'slides' || role === 'tape')
    return { ...VIDEO_OFF, ...AUDIO_OFF };
  switch (presetId) {
    case 'match':
      if (role === 'wide') return { ...BALL_WIDE };
      if (role === 'goal-left' || role === 'goal-right')
        return { ball: '1', videoHz: 6 };
      return {};
    case 'talk':
      // People count only nudges the score on talking heads; speech decides.
      if (role === 'speaker' || role === 'guest') return { videoHz: 2 };
      return {};
    case 'stage':
      // Wide follows the speaking actor (virtual camera) — keep it fresh.
      if (role === 'wide') return { videoHz: 6 };
      return {};
    case 'gig':
      // Onsets drive the cuts; the crowd cam only needs motion.
      if (role === 'audience') return { ...AUDIO_OFF };
      return { onsetDb: 5 };
    case 'custom':
      return {};
  }
}
