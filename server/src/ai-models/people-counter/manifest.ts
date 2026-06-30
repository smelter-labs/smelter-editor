import path from 'node:path';
import type { ModelParamSpec } from '@smelter-editor/types';
import type { ModelManifest } from '../registry';

const PEOPLE_COUNTER_DIR = path.join(__dirname, '.');

export type PeopleCounterBackend = 'yolo' | 'mediapipe' | 'haar';

// YOLO tunables, forwarded live to the worker (worker keys: 'confidence', 'imgsz').
const YOLO_PARAMS: ModelParamSpec[] = [
  {
    key: 'confidence',
    label: 'Confidence',
    description: 'Lower = detects more (incl. distant/small people), more false positives',
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
    extraEnv: { PEOPLE_COUNTER_BACKEND: spec.backend },
    ...(spec.supportsBoxes ? { supportsBoxes: true } : {}),
    ...(spec.params ? { params: spec.params } : {}),
  };
}

/** The YOLO backend model id — the only one that emits bounding boxes. */
export const PEOPLE_COUNTER_YOLO_ID = 'people-counter-yolo';

/** One manifest per detection backend — each is an independently toggleable model. */
export const PEOPLE_COUNTER_MANIFESTS: ModelManifest[] = BACKENDS.map(makeManifest);

/** True for any people-counter backend model id. */
export function isPeopleCounterModel(modelId: string): boolean {
  return modelId.startsWith('people-counter');
}
