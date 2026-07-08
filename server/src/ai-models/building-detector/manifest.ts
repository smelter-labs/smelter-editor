import path from 'node:path';
import type { NumberParamSpec } from '@smelter-editor/types';
import type { ModelManifest } from '../registry';

const BUILDING_DETECTOR_DIR = path.join(__dirname, '.');

/** The building-detector model id. Enabling it on an input turns on Ghost City. */
export const BUILDING_DETECTOR_ID = 'building-detector';

/** HF semantic-segmentation model (ADE20K) used to find building pixels. */
const DEFAULT_SEG_MODEL = 'nvidia/segformer-b0-finetuned-ade-512-512';

// Ghost City tunables, forwarded live to the worker (worker keys: 'min_area').
const BUILDING_PARAMS: NumberParamSpec[] = [
  {
    key: 'min_area',
    label: 'Min building size',
    description:
      'Smallest building region to haunt, as % of frame area. Lower = haunt smaller/farther buildings.',
    min: 0.005,
    max: 0.2,
    step: 0.005,
    default: 0.02,
  },
];

/**
 * Segmentation-based building detector. YOLO/COCO has no "building" class, so
 * this uses an ADE20K SegFormer segmentation model (classes building/house/
 * skyscraper) and returns the bounding boxes of the building regions — same
 * `{count, boxes, frameW, frameH, procMs}` shape as the people-counter YOLO
 * backend, so the render side can map boxes through the identical cover
 * transform and feed the haunted-city shader.
 */
export const BUILDING_DETECTOR_MANIFEST: ModelManifest = {
  id: BUILDING_DETECTOR_ID,
  name: 'Ghost City (Buildings)',
  description:
    'Detects buildings (ADE20K segmentation) and haunts them with an eerie shader — mist, spectral glow and glowing windows. Combine with ghost mode for a full ghost town.',
  needsVideo: true,
  needsAudio: false,
  // Segmentation on CPU is slow — default to a generous delay like YOLO.
  defaultDelayMs: 3000,
  maxDelayMs: 5000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(BUILDING_DETECTOR_DIR, 'worker.py'),
  requirementsFile: path.join(BUILDING_DETECTOR_DIR, 'requirements.txt'),
  venvDir: path.join(BUILDING_DETECTOR_DIR, '.venv'),
  envOverrideKey: 'BUILDING_DETECTOR_PYTHON_PATH',
  wsPort: 8088,
  // torch/transformers are checked lazily in the worker so a missing heavy dep
  // only disables detection (no boxes) rather than crashing the worker.
  depsCheck: 'import cv2; import numpy; import websockets; import smelter',
  extraEnv: {
    BUILDING_DETECTOR_MODEL: DEFAULT_SEG_MODEL,
    BUILDING_DETECTOR_MIN_AREA: '0.02',
  },
  // Lets the UI show the debug drawBoxes toggle to preview building regions.
  supportsBoxes: true,
  params: BUILDING_PARAMS,
};

/** True for the building-detector model id. */
export function isBuildingDetectorModel(modelId: string): boolean {
  return modelId === BUILDING_DETECTOR_ID;
}
