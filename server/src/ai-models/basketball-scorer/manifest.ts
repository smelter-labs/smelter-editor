import path from 'node:path';
import type { ModelParamSpec } from '@smelter-editor/types';
import { DATA_DIR } from '../../dataDir';
import type { ModelManifest } from '../registry';

const BASKETBALL_SCORER_DIR = path.join(__dirname, '.');
// Shares the people-counter venv (ultralytics/torch/opencv already there);
// its own requirements file only matters on a box where that venv is fresh.
const PEOPLE_COUNTER_DIR = path.join(__dirname, '../people-counter');

/** The basketball-scorer model id: ball + rim state machine + jersey colour. */
export const BASKETBALL_SCORER_ID = 'basketball-scorer';

const DEFAULT_IMGSZ = 640;
const DEFAULT_BALL_CONF = 0.2;
const DEFAULT_ANALYSIS_FPS = 20;
const DEFAULT_NET_ZONE_MS = 700;
const DEFAULT_COOLDOWN_MS = 1500;

const BASKETBALL_SCORER_PARAMS: ModelParamSpec[] = [
  {
    type: 'select',
    key: 'ballDetector',
    label: 'Ball detector',
    description:
      'Auto = YOLO with an orange-blob (HSV) fallback when YOLO loses the ball; HSV-only skips the neural net (synthetic clips, machines without torch).',
    options: [
      { value: 'auto', label: 'YOLO + HSV fallback' },
      { value: 'yolo', label: 'YOLO only' },
      { value: 'hsv', label: 'HSV blob only' },
    ],
    default: 'auto',
  },
  {
    type: 'select',
    key: 'yoloWeights',
    label: 'YOLO weights',
    description:
      'Auto picks Small on CUDA and Nano on CPU. bb-ball.pt is the ball-only ' +
      'fine-tune for fixed hall cameras (falls back to Auto when the file is missing).',
    options: [
      { value: 'auto', label: 'Auto (by device)' },
      { value: 'yolo11n.pt', label: 'YOLO11 Nano (CPU)' },
      { value: 'yolo11s.pt', label: 'YOLO11 Small' },
      { value: 'yolo11m.pt', label: 'YOLO11 Medium (GPU)' },
      { value: 'bb-ball.pt', label: 'Hall fine-tune (ball only)' },
    ],
    default: 'auto',
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher catches a smaller/farther ball, slower on CPU.',
    min: 320,
    max: 1280,
    step: 160,
    default: DEFAULT_IMGSZ,
  },
  {
    key: 'ballConf',
    label: 'Ball confidence',
    description:
      'Raise if random round things get boxed; lower if the ball is missed in flight.',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: DEFAULT_BALL_CONF,
  },
  {
    key: 'analysisFps',
    label: 'Analysis rate',
    description:
      'Frames per second the model inspects — a ceiling. A shot crosses the rim in ~0.15 s, so below ~10 fps makes start going unseen.',
    min: 8,
    max: 30,
    step: 1,
    default: DEFAULT_ANALYSIS_FPS,
  },
  {
    type: 'select',
    key: 'rimCrop',
    label: 'Rim crop pass',
    description:
      'When the full-frame pass finds no ball, run a second pass on a crop around the rim (catches a small ball on a 640 px side channel).',
    options: [
      { value: '1', label: 'On' },
      { value: '0', label: 'Off' },
    ],
    default: '1',
  },
  {
    key: 'rimCx',
    label: 'Rim centre X',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0.5,
  },
  {
    key: 'rimCy',
    label: 'Rim centre Y',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0.35,
  },
  {
    key: 'rimRx',
    label: 'Rim radius X',
    min: 0.005,
    max: 0.5,
    step: 0.001,
    default: 0.06,
  },
  {
    key: 'rimRy',
    label: 'Rim radius Y',
    min: 0.003,
    max: 0.5,
    step: 0.001,
    default: 0.02,
  },
  {
    type: 'select',
    key: 'rimSet',
    label: 'Rim calibrated',
    description:
      'Set by the hoop phone; without a rim the detector only tracks the ball.',
    options: [
      { value: '0', label: 'No' },
      { value: '1', label: 'Yes' },
    ],
    default: '0',
  },
  {
    type: 'color',
    key: 'teamColorA',
    label: 'Team A colour',
    default: '#ff6a1f',
  },
  {
    type: 'color',
    key: 'teamColorB',
    label: 'Team B colour',
    default: '#1f7bff',
  },
  {
    key: 'netZoneMs',
    label: 'Net window',
    description:
      'Max ms between the ball entering the rim ellipse and showing up in the net zone.',
    min: 300,
    max: 1500,
    step: 50,
    default: DEFAULT_NET_ZONE_MS,
  },
  {
    key: 'cooldownMs',
    label: 'Make cooldown',
    description:
      'Ignore rim activity this long after a make (the ball dropping out of the net).',
    min: 500,
    max: 4000,
    step: 100,
    default: DEFAULT_COOLDOWN_MS,
  },
  {
    type: 'select',
    key: 'captureShotFrames',
    label: 'Shot stills',
    description:
      'Save a still of the make and of the release (served under /bb-shot-frames).',
    options: [
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' },
    ],
    default: '0',
  },
];

/**
 * Basketball scorer. YOLO (COCO person + sports ball) with a rim-centred crop
 * pass and an HSV orange-blob fallback tracks the ball; a state machine over
 * the calibrated rim ellipse (above → inside → net) detects made baskets and
 * attempts; on a make it walks a 4 s ring buffer back to the release frame
 * and classifies the shooter's jersey colour against the two team colours.
 * Emits the standard `{count, boxes, frameW, frameH, procMs}` shape plus
 * `ball`, `zone`, `state` and discrete `shot_made` / `shot_attempt` events.
 */
export const BASKETBALL_SCORER_MANIFEST: ModelManifest = {
  id: BASKETBALL_SCORER_ID,
  name: 'Basketball Scorer',
  description:
    'Counts made baskets from a fixed hoop camera and attributes them to a team by jersey colour. Needs the rim calibrated from the hoop phone.',
  needsVideo: true,
  needsAudio: false,
  defaultDelayMs: 3000,
  maxDelayMs: 5000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(BASKETBALL_SCORER_DIR, 'worker.py'),
  requirementsFile: path.join(BASKETBALL_SCORER_DIR, 'requirements.txt'),
  venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
  envOverrideKey: 'BASKETBALL_SCORER_PYTHON_PATH',
  wsPort: 8092,
  // Everything we need is already in the shared venv on a provisioned box;
  // the check failing (fresh box) makes installVenv run our requirements.
  depsCheck:
    'import cv2; import numpy; import websockets; import smelter; import ultralytics; assert tuple(map(int, ultralytics.__version__.split(".")[:2])) >= (8, 3)',
  extraEnv: {
    BASKETBALL_IMGSZ: String(DEFAULT_IMGSZ),
    BASKETBALL_BALL_CONF: String(DEFAULT_BALL_CONF),
    BASKETBALL_ANALYSIS_FPS: String(DEFAULT_ANALYSIS_FPS),
    BASKETBALL_NET_ZONE_MS: String(DEFAULT_NET_ZONE_MS),
    BASKETBALL_COOLDOWN_MS: String(DEFAULT_COOLDOWN_MS),
    // Where the worker writes make/release stills when captureShotFrames is
    // on; Node serves them back at GET /bb-shot-frames/:fileName.
    BASKETBALL_FRAME_DIR: path.join(DATA_DIR, 'bb-shot-frames'),
  },
  supportsBoxes: true,
  params: BASKETBALL_SCORER_PARAMS,
};

/** True for the basketball-scorer model id. */
export function isBasketballScorerModel(modelId: string): boolean {
  return modelId === BASKETBALL_SCORER_ID;
}
