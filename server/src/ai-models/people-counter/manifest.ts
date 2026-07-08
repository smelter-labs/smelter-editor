import path from 'node:path';
import type { ModelParamSpec, NumberParamSpec } from '@smelter-editor/types';
import type { ModelManifest } from '../registry';

const PEOPLE_COUNTER_DIR = path.join(__dirname, '.');

export type PeopleCounterBackend = 'yolo' | 'mediapipe' | 'haar';

// YOLO tunables, forwarded live to the worker (worker keys: 'confidence', 'imgsz').
const YOLO_PARAMS: NumberParamSpec[] = [
  {
    key: 'confidence',
    label: 'Confidence',
    description:
      'Lower = detects more (incl. distant/small people), more false positives',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: 0.35,
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher = catches smaller/farther people, slower on CPU',
    min: 320,
    max: 1920,
    step: 160,
    default: 640,
  },
];

// Birds are tiny, fast specks against the sky — the person defaults (nano
// model, imgsz 640, conf 0.35) miss most of them. Detect with a stronger model
// (yolov8s vs. nano), a larger inference size, and a lower confidence. These
// feed both the UI slider defaults (BIRD_YOLO_PARAMS) and the worker's env
// baseline (extraEnv) so detection is good even before any slider is touched.
const BIRD_YOLO_WEIGHTS = 'yolov8s.pt';
const BIRD_YOLO_CONF = 0.2;
const BIRD_YOLO_IMGSZ = 1280;

// Model-size selector, swappable live (the worker reloads weights on change) so
// you can A/B nano/small/medium without restarting.
const BIRD_WEIGHTS_PARAM: ModelParamSpec = {
  type: 'select',
  key: 'weights',
  label: 'Model',
  description: 'Bigger = more accurate on small birds, slower on CPU',
  options: [
    { value: 'yolov8n.pt', label: 'Nano (fastest)' },
    { value: 'yolov8s.pt', label: 'Small (balanced)' },
    { value: 'yolov8m.pt', label: 'Medium (most accurate)' },
  ],
  default: BIRD_YOLO_WEIGHTS,
};

const BIRD_YOLO_PARAMS: ModelParamSpec[] = [
  BIRD_WEIGHTS_PARAM,
  ...YOLO_PARAMS.map((p) => {
    if (p.key === 'confidence') return { ...p, default: BIRD_YOLO_CONF };
    if (p.key === 'imgsz') {
      return {
        ...p,
        default: BIRD_YOLO_IMGSZ,
        description: 'Higher = catches smaller/farther birds, slower on CPU',
      };
    }
    return p;
  }),
];

type BackendSpec = {
  id: string;
  name: string;
  description: string;
  backend: PeopleCounterBackend;
  /** Distinct WS port per backend — each runs its own Python process. */
  wsPort: number;
  defaultDelayMs?: number;
  maxDelayMs?: number;
  supportsBoxes?: boolean;
  params?: ModelParamSpec[];
  /** COCO class ids the YOLO worker should detect (default 0 = person). */
  yoloClasses?: string;
  /** YOLO weights file (worker default: yolov8n.pt). */
  yoloWeights?: string;
  /** Worker env baseline for confidence / inference size (fallback when the
   * UI sends no params). Kept in sync with the params defaults above. */
  yoloConf?: number;
  yoloImgsz?: number;
};

const BACKENDS: BackendSpec[] = [
  {
    id: 'people-counter-yolo',
    name: 'People Counter (YOLO)',
    description: 'Counts people via YOLOv8 person detection',
    backend: 'yolo',
    wsPort: 8084,
    // YOLO on CPU is slow — default to a generous delay.
    defaultDelayMs: 3000,
    maxDelayMs: 5000,
    supportsBoxes: true,
    params: YOLO_PARAMS,
  },
  {
    id: 'people-counter-yolo-birds',
    name: 'Bird Counter (YOLO)',
    description:
      'Detects birds (YOLOv8s). Draw boxes to tune sensitivity, or show duck sprites — shootable in Duck Hunter.',
    backend: 'yolo',
    wsPort: 8087,
    // Stronger model + larger inference size than the people backend, so keep a
    // generous delay (birds are heavier to detect than nearby people).
    defaultDelayMs: 3000,
    maxDelayMs: 5000,
    supportsBoxes: true,
    params: BIRD_YOLO_PARAMS,
    yoloClasses: '14',
    yoloWeights: BIRD_YOLO_WEIGHTS,
    yoloConf: BIRD_YOLO_CONF,
    yoloImgsz: BIRD_YOLO_IMGSZ,
  },
  {
    id: 'people-counter-mediapipe',
    name: 'People Counter (MediaPipe faces)',
    description: 'Counts faces via MediaPipe FaceDetection',
    backend: 'mediapipe',
    wsPort: 8085,
  },
  {
    id: 'people-counter-haar',
    name: 'People Counter (Haar faces)',
    description: 'Counts faces via OpenCV Haar cascade (lightest)',
    backend: 'haar',
    wsPort: 8086,
  },
];

function makeManifest(spec: BackendSpec): ModelManifest {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    needsVideo: true,
    needsAudio: false,
    defaultDelayMs: spec.defaultDelayMs ?? 0,
    maxDelayMs: spec.maxDelayMs ?? 2000,
    supportedInputTypes: [
      'local-mp4',
      'twitch-channel',
      'kick-channel',
      'hls',
      'whip',
    ],
    pythonScript: path.join(PEOPLE_COUNTER_DIR, 'worker.py'),
    requirementsFile: path.join(PEOPLE_COUNTER_DIR, 'requirements.txt'),
    // Shared venv — all backends use the same requirements.txt.
    venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
    envOverrideKey: 'PEOPLE_COUNTER_PYTHON_PATH',
    wsPort: spec.wsPort,
    // Heavy backends (YOLO/MediaPipe) are checked lazily in the worker so a
    // missing package only disables that backend — Haar always works.
    depsCheck: 'import cv2; import numpy; import websockets; import smelter',
    extraEnv: {
      PEOPLE_COUNTER_BACKEND: spec.backend,
      ...(spec.yoloClasses
        ? { PEOPLE_COUNTER_YOLO_CLASSES: spec.yoloClasses }
        : {}),
      ...(spec.yoloWeights
        ? { PEOPLE_COUNTER_YOLO_WEIGHTS: spec.yoloWeights }
        : {}),
      ...(spec.yoloConf !== undefined
        ? { PEOPLE_COUNTER_YOLO_CONF: String(spec.yoloConf) }
        : {}),
      ...(spec.yoloImgsz !== undefined
        ? { PEOPLE_COUNTER_YOLO_IMGSZ: String(spec.yoloImgsz) }
        : {}),
    },
    ...(spec.supportsBoxes ? { supportsBoxes: true } : {}),
    ...(spec.params ? { params: spec.params } : {}),
  };
}

/** The YOLO backend model id — the only one that emits bounding boxes. */
export const PEOPLE_COUNTER_YOLO_ID = 'people-counter-yolo';

/** The YOLO bird-detection backend model id (COCO class 14). */
export const PEOPLE_COUNTER_YOLO_BIRDS_ID = 'people-counter-yolo-birds';

/** One manifest per detection backend — each is an independently toggleable model. */
export const PEOPLE_COUNTER_MANIFESTS: ModelManifest[] =
  BACKENDS.map(makeManifest);

/** True for any people-counter backend model id. */
export function isPeopleCounterModel(modelId: string): boolean {
  return modelId.startsWith('people-counter');
}
