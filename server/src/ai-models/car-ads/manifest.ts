import path from 'node:path';
import type { ModelParamSpec } from '@smelter-editor/types';
import type { ModelManifest } from '../registry';

const CAR_ADS_DIR = path.join(__dirname, '.');
// The worker's Python deps are identical to the people-counter YOLO backend
// (cv2/numpy/websockets/smelter/ultralytics), so it shares that venv and the
// already-downloaded YOLO weights instead of installing a second torch.
const PEOPLE_COUNTER_DIR = path.join(__dirname, '../people-counter');

/** The car-ads model id. Enabling it detects vehicles + wheels for side ads. */
export const CAR_ADS_ID = 'car-ads';

const CAR_ADS_PARAMS: ModelParamSpec[] = [
  {
    key: 'confidence',
    label: 'Confidence',
    description:
      'Lower = detects more (incl. distant/partial cars), more false positives',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: 0.4,
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher = catches smaller/farther cars, slower on CPU',
    min: 320,
    max: 1920,
    step: 160,
    default: 640,
  },
  {
    key: 'adHeight',
    label: 'Ad height',
    description:
      'Top edge of the ad in wheel radii above the wheel centers (~2 ≈ beltline)',
    min: 1.2,
    max: 3.0,
    step: 0.05,
    default: 2.05,
  },
  {
    key: 'adOpacity',
    label: 'Ad opacity',
    description: 'Slightly transparent reads as painted-on rather than pasted',
    min: 0.3,
    max: 1.0,
    step: 0.05,
    default: 0.92,
  },
];

/**
 * Vehicle detector + wheel-based side-plane estimator. YOLO finds cars/buses/
 * trucks; Hough circles find the two visible wheels inside each box; the wheel
 * centers + radii define the door-panel quad the renderer maps the ad image
 * onto (corner-pin homography), so the ad tracks the car in real perspective.
 */
export const CAR_ADS_MANIFEST: ModelManifest = {
  id: CAR_ADS_ID,
  name: 'Car Ads (YOLO + wheels)',
  description:
    'Sticks an ad on the side of each detected car, in perspective from its wheels. Draw boxes to tune detection, or enable the ad overlay.',
  needsVideo: true,
  needsAudio: false,
  // YOLO + Hough on CPU — same generous delay as the other YOLO backends.
  defaultDelayMs: 3000,
  maxDelayMs: 5000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(CAR_ADS_DIR, 'worker.py'),
  requirementsFile: path.join(PEOPLE_COUNTER_DIR, 'requirements.txt'),
  venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
  envOverrideKey: 'CAR_ADS_PYTHON_PATH',
  wsPort: 8089,
  // ultralytics/torch are checked lazily in the worker so a missing heavy dep
  // only disables detection rather than crashing the worker.
  depsCheck: 'import cv2; import numpy; import websockets; import smelter',
  extraEnv: {
    // Reuse the weights already downloaded next to the people-counter worker.
    CAR_ADS_YOLO_WEIGHTS: path.join(PEOPLE_COUNTER_DIR, 'yolov8n.pt'),
  },
  supportsBoxes: true,
  params: CAR_ADS_PARAMS,
  hidden: true,
};

/** The top-down car-hue model id (bird's-eye footage, per-car hue recolor). */
export const CAR_HUE_ID = 'car-hue-topdown';

// COCO YOLO barely detects vehicles in true nadir (bird's-eye) footage — on a
// test drone frame it found 0 cars where these VisDrone-trained weights found
// 35 (and ran faster). The worker auto-downloads them from HF when missing and
// picks vehicle classes by name, so COCO and VisDrone weights are both usable
// from the same select. Larger inference size + lower confidence because
// aerial cars are small (same reasoning as the bird backend).
const HUE_YOLO_WEIGHTS = 'yolov8s-visdrone.pt';
const HUE_YOLO_CONF = 0.25;
const HUE_YOLO_IMGSZ = 1280;

const CAR_HUE_PARAMS: ModelParamSpec[] = [
  {
    type: 'select',
    key: 'weights',
    label: 'Model',
    description:
      'Aerial (VisDrone) for top-down/drone footage; COCO sizes for low, oblique angles',
    options: [
      { value: 'yolov8s-visdrone.pt', label: 'Aerial (VisDrone)' },
      { value: 'yolov8n.pt', label: 'COCO Nano (fastest)' },
      { value: 'yolov8s.pt', label: 'COCO Small' },
      { value: 'yolov8m.pt', label: 'COCO Medium' },
    ],
    default: HUE_YOLO_WEIGHTS,
  },
  {
    key: 'confidence',
    label: 'Confidence',
    description:
      'Lower = detects more (incl. small/far cars), more false positives',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: HUE_YOLO_CONF,
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher = catches smaller cars from higher up, slower on CPU',
    min: 320,
    max: 1920,
    step: 160,
    default: HUE_YOLO_IMGSZ,
  },
  {
    key: 'hue',
    label: 'Hue shift',
    description: 'Degrees to rotate each car’s hue by (0 = original colors)',
    min: 0,
    max: 360,
    step: 5,
    default: 120,
  },
  {
    key: 'spread',
    label: 'Hue variety',
    description:
      'Extra per-car hue offset (± degrees) so cars get different colors',
    min: 0,
    max: 180,
    step: 5,
    default: 0,
  },
  {
    key: 'strength',
    label: 'Strength',
    description: 'Blend of the recolored result over the original video',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    default: 1.0,
  },
  {
    key: 'satBoost',
    label: 'Saturation boost',
    description:
      'Extra saturation inside each car mask so silver-ish cars still change',
    min: 0,
    max: 0.6,
    step: 0.05,
    default: 0.15,
  },
  {
    key: 'whiteBoost',
    label: 'White-car paint',
    description:
      'Paints white/silver cars with the target hue — rotation alone can’t recolor a colorless car',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.85,
  },
];

/**
 * Top-down (bird's-eye) vehicle detector for per-car hue recolor. Same worker
 * as car-ads in 'topdown' mode: plain YOLO vehicle boxes, no wheel search (no
 * visible car side from above). The render side rotates the hue inside a
 * feathered ellipse per box via the `car-hue` shader.
 */
export const CAR_HUE_MANIFEST: ModelManifest = {
  id: CAR_HUE_ID,
  name: 'Car Hue (top-down)',
  description:
    'Detects cars in bird’s-eye footage and recolors each one live (hue shift inside its box). Draw boxes to tune detection, or enable the hue overlay.',
  needsVideo: true,
  needsAudio: false,
  // Stronger model + larger inference size than the street-level backend.
  defaultDelayMs: 3000,
  maxDelayMs: 5000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(CAR_ADS_DIR, 'worker.py'),
  requirementsFile: path.join(PEOPLE_COUNTER_DIR, 'requirements.txt'),
  venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
  envOverrideKey: 'CAR_ADS_PYTHON_PATH',
  wsPort: 8090,
  depsCheck: 'import cv2; import numpy; import websockets; import smelter',
  extraEnv: {
    CAR_ADS_MODE: 'topdown',
    // Lives in the car-ads dir (worker auto-downloads it there when missing);
    // the COCO options from the select still resolve to the people-counter dir.
    CAR_ADS_YOLO_WEIGHTS: path.join(CAR_ADS_DIR, HUE_YOLO_WEIGHTS),
    CAR_ADS_YOLO_CONF: String(HUE_YOLO_CONF),
    CAR_ADS_YOLO_IMGSZ: String(HUE_YOLO_IMGSZ),
  },
  supportsBoxes: true,
  params: CAR_HUE_PARAMS,
};

/** One manifest per car-detection backend (street-level ads / top-down hue). */
export const CAR_ADS_MANIFESTS: ModelManifest[] = [
  CAR_ADS_MANIFEST,
  CAR_HUE_MANIFEST,
];

/** True for any car-ads backend model id. */
export function isCarAdsModel(modelId: string): boolean {
  return modelId === CAR_ADS_ID || modelId === CAR_HUE_ID;
}
