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
// you can A/B nano/small/medium without restarting. The flying-objects weights
// (drones/aircraft/birds — HF Javvanny/yolov8m_flying_objects_detection) are
// downloaded by the worker on first use; COCO barely knows airborne
// silhouettes, this model was trained on them.
const BIRD_WEIGHTS_PARAM: ModelParamSpec = {
  type: 'select',
  key: 'weights',
  label: 'Model',
  description: 'Bigger = more accurate on small birds, slower on CPU',
  options: [
    { value: 'yolov8n.pt', label: 'Nano (fastest)' },
    { value: 'yolov8s.pt', label: 'Small (balanced)' },
    { value: 'yolov8m.pt', label: 'Medium (most accurate)' },
    {
      value: 'yolov8m_fly_obj_detection.pt',
      label: 'Flying objects (specialized, medium)',
    },
  ],
  default: BIRD_YOLO_WEIGHTS,
};

// Tiling trades speed for effective resolution: each tile keeps far more
// native pixels per bird than one squeezed full-frame pass. 3×2 with imgsz 640
// sees roughly what a single 1920 pass would, at a similar cost.
const BIRD_TILES_PARAM: ModelParamSpec = {
  type: 'select',
  key: 'tiles',
  label: 'Tiling',
  description:
    'Split the frame into overlapping tiles — catches tiny birds, multiplies inference cost',
  options: [
    { value: 'off', label: 'Off (full frame)' },
    { value: '2x2', label: '2×2 (4 tiles)' },
    { value: '3x2', label: '3×2 (6 tiles)' },
  ],
  default: 'off',
};

const BIRD_AUGMENT_PARAM: ModelParamSpec = {
  type: 'select',
  key: 'augment',
  label: 'Test-time augmentation',
  description:
    'Multi-scale/flip inference — slightly better recall, ~2x slower',
  options: [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ],
  default: 'off',
};

// Motion fusion: a motion-blurred bird in flight is invisible to YOLO but is a
// strong frame-difference signal. Blobs within the size band that no YOLO box
// claims are reported as extra boxes with a synthetic conf of 0.15 (below the
// bird default 0.2, so the conf label alone identifies a motion-only box).
const BIRD_MOTION_PARAMS: ModelParamSpec[] = [
  {
    type: 'select',
    key: 'motion',
    label: 'Motion fusion',
    description: 'Also box small moving blobs YOLO missed (frame differencing)',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    default: 'off',
  },
  {
    key: 'motionMin',
    label: 'Motion min size',
    description: 'Smallest moving blob to keep, as a fraction of the frame',
    min: 0.001,
    max: 0.02,
    step: 0.001,
    default: 0.004,
  },
  {
    key: 'motionMax',
    label: 'Motion max size',
    description: 'Largest moving blob to keep — bigger movers are not birds',
    min: 0.02,
    max: 0.3,
    step: 0.01,
    default: 0.08,
  },
];

// Marker mode: for footage where the birds were already boxed by hand in a
// video editor. "Detection" is then colour keying rather than inference — the
// rectangles are in the frame, so they only have to be found. It rides on the
// bird model as a source switch instead of being its own model: same duck path,
// same overlay, same panel, and switchable live while tuning a shot.
//
// Every knob exists because h264 mangles the exact thing being keyed on: a thin,
// fully-saturated stroke is the first casualty of chroma subsampling, so what
// needs tuning is the match, not a model.
export const MARKER_SOURCE = 'markers';

const MARKER_SOURCE_PARAM: ModelParamSpec = {
  type: 'select',
  key: 'source',
  label: 'Detection source',
  description:
    'Markers = read rectangles drawn into the video instead of detecting birds',
  options: [
    { value: 'yolo', label: 'YOLO (detect birds)' },
    { value: MARKER_SOURCE, label: 'Markers drawn in the video' },
  ],
  default: 'yolo',
};

const MARKER_PARAMS: ModelParamSpec[] = [
  {
    type: 'color',
    key: 'markerColor',
    label: 'Marker color',
    description:
      'The colour of the rectangles drawn into the video — pick it straight off your footage',
    default: '#ff0000',
  },
  {
    key: 'tolerance',
    label: 'Colour tolerance',
    description: 'Higher = survives compression, risks keying real red objects',
    min: 0.05,
    max: 0.6,
    step: 0.01,
    default: 0.22,
  },
  {
    key: 'minSize',
    label: 'Min marker size',
    description: 'Smallest rectangle to accept, as a fraction of the frame',
    min: 0.002,
    max: 0.1,
    step: 0.002,
    default: 0.01,
  },
  {
    key: 'maxSize',
    label: 'Max marker size',
    description: 'Largest rectangle to accept — bigger blobs are not markers',
    min: 0.05,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    // NOTE: not 'motion' — that key belongs to the motion-fusion select in
    // BIRD_YOLO_PARAMS and the worker already reads params['motion'] for it.
    type: 'select',
    key: 'markerMotion',
    label: 'Marker motion',
    description:
      'Glide boxes between marker keyframes (needs the model delay to exceed the keyframe spacing, e.g. 3s delay for 1s keyframes) — or hold each keyframe until the next',
    options: [
      { value: 'interpolate', label: 'Glide (interpolate)' },
      { value: 'hold', label: 'Hold (step)' },
    ],
    default: 'interpolate',
  },
  {
    key: 'matchDist',
    label: 'Match distance',
    description:
      'Max distance (fraction of the frame) a bird can move between keyframes and still count as the same bird — beyond it boxes pop instead of gliding',
    min: 0.02,
    max: 0.4,
    step: 0.01,
    default: 0.12,
  },
  {
    key: 'hold',
    label: 'Marker hold',
    description:
      'Keep the last markers this long (s) — set above your keyframe spacing when markers are drawn on single frames',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.5,
  },
  {
    key: 'pad',
    label: 'Box padding',
    description:
      'Grow (+) or shrink (−) the box so it covers the marker stroke',
    min: -0.01,
    max: 0.01,
    step: 0.001,
    default: 0,
  },
  {
    key: 'jitter',
    label: 'Jitter',
    description:
      'Slight wobble so it reads as a live detector, not an animation',
    min: 0,
    max: 0.01,
    step: 0.001,
    default: 0.002,
  },
  {
    key: 'border',
    label: 'Outline width',
    description:
      'Thickness of the drawn box (px) — must cover the marker stroke',
    min: 2,
    max: 24,
    step: 1,
    default: 10,
  },
];

const BIRD_YOLO_PARAMS: ModelParamSpec[] = [
  // The source switch leads: it decides whether any of the YOLO knobs below
  // matter at all for this input.
  MARKER_SOURCE_PARAM,
  BIRD_WEIGHTS_PARAM,
  BIRD_TILES_PARAM,
  BIRD_AUGMENT_PARAM,
  ...YOLO_PARAMS.map((p) => {
    if (p.key === 'confidence') return { ...p, default: BIRD_YOLO_CONF };
    if (p.key === 'imgsz') {
      return {
        ...p,
        default: BIRD_YOLO_IMGSZ,
        description:
          'Higher = catches smaller/farther birds, slower on CPU (per tile when tiling is on)',
      };
    }
    return p;
  }),
  ...BIRD_MOTION_PARAMS,
  ...MARKER_PARAMS,
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
  /** Class names (comma-separated, substring match against the loaded model's
   * class map) — survives a swap to non-COCO weights; wins over yoloClasses. */
  yoloClassNames?: string;
  /** YOLO weights file (worker default: yolov8n.pt). */
  yoloWeights?: string;
  /** Worker env baseline for confidence / inference size (fallback when the
   * UI sends no params). Kept in sync with the params defaults above. */
  yoloConf?: number;
  yoloImgsz?: number;
  hidden?: boolean;
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
    // Ghost mode always renders the haunting ghosts (Haunter panel tunes the
    // pool/threshold live) — there is no per-input sprite style.
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
    // generous delay (birds are heavier to detect than nearby people); the max
    // leaves headroom for tiled inference with the medium model.
    defaultDelayMs: 3000,
    maxDelayMs: 8000,
    supportsBoxes: true,
    params: BIRD_YOLO_PARAMS,
    // Numeric ids kept as a fallback for workers without name matching.
    yoloClasses: '14',
    yoloClassNames: 'bird',
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
    hidden: true,
  },
  {
    id: 'people-counter-haar',
    name: 'People Counter (Haar faces)',
    description: 'Counts faces via OpenCV Haar cascade (lightest)',
    backend: 'haar',
    wsPort: 8086,
    hidden: true,
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
      ...(spec.yoloClassNames
        ? { PEOPLE_COUNTER_YOLO_CLASS_NAMES: spec.yoloClassNames }
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
    ...(spec.hidden ? { hidden: true } : {}),
  };
}

/** The YOLO backend model id — the only one that emits bounding boxes. */
export const PEOPLE_COUNTER_YOLO_ID = 'people-counter-yolo';

/** The YOLO bird-detection backend model id (COCO class 14). */
export const PEOPLE_COUNTER_YOLO_BIRDS_ID = 'people-counter-yolo-birds';

/**
 * True when this input's bird model is reading markers rather than running
 * inference. Marker boxes are exact instead of predicted, so the pipeline must
 * not lead or ease them — the drawn outline has to land on the marker it was
 * keyed from.
 */
export function isMarkerSource(
  params: Record<string, number | string> | undefined,
): boolean {
  return String(params?.source ?? 'yolo') === MARKER_SOURCE;
}

/** One manifest per detection backend — each is an independently toggleable model. */
export const PEOPLE_COUNTER_MANIFESTS: ModelManifest[] =
  BACKENDS.map(makeManifest);

/** True for any people-counter backend model id. */
export function isPeopleCounterModel(modelId: string): boolean {
  return modelId.startsWith('people-counter');
}
