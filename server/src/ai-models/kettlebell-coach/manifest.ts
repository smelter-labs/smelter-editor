import path from 'node:path';
import type { ModelParamSpec } from '@smelter-editor/types';
import { DATA_DIR } from '../../dataDir';
import type { ModelManifest } from '../registry';

const KETTLEBELL_COACH_DIR = path.join(__dirname, '.');
// Shares the people-counter venv (ultralytics/torch already installed there,
// same as car-ads) but keeps its OWN requirements file: YOLO-World's
// set_classes() needs CLIP + ftfy on top, and the depsCheck below imports them
// so installVenv actually pip-installs the extras instead of short-circuiting.
const PEOPLE_COUNTER_DIR = path.join(__dirname, '../people-counter');

/** The kettlebell-coach model id. Pose + kettlebell tracking + swing verdicts. */
export const KETTLEBELL_COACH_ID = 'kettlebell-coach';

const DEFAULT_POSE_WEIGHTS = 'yolo11n-pose.pt';
const DEFAULT_WORLD_WEIGHTS = 'yolov8s-worldv2.pt';
const DEFAULT_KB_CONF = 0.15;
const DEFAULT_KB_EVERY_N = 5;
const DEFAULT_IMGSZ = 640;
const DEFAULT_ANALYSIS_FPS = 16;
const DEFAULT_REP_SENSITIVITY = 0.25;
const DEFAULT_HINGE_KNEE_MIN = 110;
const DEFAULT_ARM_STRAIGHT_MIN = 150;
const DEFAULT_BACK_ALIGN_MIN = 140;

const KETTLEBELL_COACH_PARAMS: ModelParamSpec[] = [
  {
    type: 'select',
    key: 'poseModel',
    label: 'Pose model',
    description: 'Nano is real-time on CPU; Small tracks joints more precisely',
    options: [
      { value: 'yolo11n-pose.pt', label: 'YOLO11 Nano (fastest)' },
      { value: 'yolo11s-pose.pt', label: 'YOLO11 Small' },
    ],
    default: DEFAULT_POSE_WEIGHTS,
  },
  {
    type: 'select',
    key: 'kbSource',
    label: 'Kettlebell tracking',
    description:
      'Auto = YOLO-World zero-shot detector + wrist tracking; wrist-only skips the detector (faster, no bell box)',
    options: [
      { value: 'auto', label: 'Detector + wrists' },
      { value: 'wrist-only', label: 'Wrists only' },
    ],
    default: 'auto',
  },
  {
    key: 'kbConfidence',
    label: 'Bell confidence',
    description:
      'Zero-shot detection runs low by design — wrist proximity filters the noise. Raise if random objects get boxed.',
    min: 0.05,
    max: 0.9,
    step: 0.05,
    default: DEFAULT_KB_CONF,
  },
  {
    key: 'kbEveryN',
    label: 'Bell detect interval',
    description:
      'Run the kettlebell detector every N ANALYSED frames (tracked from the wrists in between), so its real rate is the analysis rate divided by this. Lower = tighter box, slower.',
    min: 1,
    max: 15,
    step: 1,
    default: DEFAULT_KB_EVERY_N,
  },
  {
    key: 'imgsz',
    label: 'Inference size',
    description: 'Higher = catches a smaller/farther athlete, slower on CPU',
    min: 320,
    max: 1280,
    step: 160,
    default: DEFAULT_IMGSZ,
  },
  {
    key: 'analysisFps',
    label: 'Analysis rate',
    description:
      'Frames per second the model inspects — a ceiling, not a floor: a slow machine falls below it on its own. Lower frees CPU and makes the skeleton steppier. The floor is 8 because below it fast reps start going uncounted.',
    min: 8,
    max: 16,
    step: 1,
    default: DEFAULT_ANALYSIS_FPS,
  },
  {
    key: 'repSensitivity',
    label: 'Rep sensitivity',
    description:
      'Minimum hand travel per rep as a fraction of body height. Lower counts partial reps, higher ignores fidgeting.',
    min: 0.1,
    max: 0.5,
    step: 0.05,
    default: DEFAULT_REP_SENSITIVITY,
  },
  {
    type: 'select',
    key: 'swingTopRule',
    label: 'Swing top rule',
    description:
      'Hardstyle flags the bell above shoulder height; overhead-ok allows American swings; off skips the height check',
    options: [
      { value: 'hardstyle', label: 'Hardstyle (chest height)' },
      { value: 'overhead-ok', label: 'Overhead OK (American)' },
      { value: 'off', label: 'Off' },
    ],
    default: 'hardstyle',
  },
  {
    type: 'select',
    key: 'cameraView',
    label: 'Camera view',
    description:
      'Side-on runs the full technique judge (hinge, arms, back). Facing the camera keeps only the height checks — depth angles are unreadable head-on.',
    options: [
      { value: 'side', label: 'Side-on (full judging)' },
      { value: 'front', label: 'Facing camera (height checks only)' },
    ],
    default: 'side',
  },
  {
    key: 'hingeKneeMin',
    label: 'Hinge knee angle',
    description:
      'Knee angle (°) at the bottom below which the rep is flagged as squatting instead of hinging',
    min: 90,
    max: 150,
    step: 5,
    default: DEFAULT_HINGE_KNEE_MIN,
  },
  {
    key: 'armStraightMin',
    label: 'Straight-arm angle',
    description:
      'Minimum elbow angle (°) during the upswing before the rep is flagged as bent arms',
    min: 120,
    max: 180,
    step: 5,
    default: DEFAULT_ARM_STRAIGHT_MIN,
  },
  {
    key: 'backAlignMin',
    label: 'Back alignment angle',
    description:
      'Ear-shoulder-hip angle (°) at the bottom below which the back counts as rounded. Side-view camera only.',
    min: 100,
    max: 170,
    step: 5,
    default: DEFAULT_BACK_ALIGN_MIN,
  },
  {
    type: 'select',
    key: 'captureRepFrames',
    label: 'Rep screenshots',
    description:
      'Save a still of the lifter at the apex of every counted rep (served under /kbt-rep-frames). The tournament flips this per heat from its own setting.',
    options: [
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' },
    ],
    default: '0',
  },
  {
    type: 'select',
    key: 'skeleton',
    label: 'Skeleton overlay',
    description:
      'Draw the tracked pose skeleton on the output video. Neon rig colours each body part and reads as one figure; lines is the plain wireframe.',
    // 'on' is kept as the classic-lines value so saved configs keep working.
    options: [
      { value: 'neon', label: 'Neon rig' },
      { value: 'on', label: 'Lines (classic)' },
      { value: 'off', label: 'Off' },
    ],
    default: 'neon',
  },
];

/**
 * Kettlebell technique coach. YOLO11-pose tracks the athlete's 17 keypoints;
 * YOLO-World (zero-shot, text class "kettlebell") finds the bell, tracked from
 * the wrist delta between detections. A heuristic classifier names the lift
 * (swing/clean/snatch/idle) and a phase machine segments swing reps, judging
 * each one (hinge vs squat, arm straightness, bell height, back alignment).
 * Verdicts assume a roughly side-on camera. Emits the standard
 * `{count, boxes, frameW, frameH, procMs}` shape (bell box) plus pose
 * keypoints, exercise/phase, per-rep verdicts and discrete rep/exercise events.
 */
export const KETTLEBELL_COACH_MANIFEST: ModelManifest = {
  id: KETTLEBELL_COACH_ID,
  name: 'Kettlebell Coach',
  description:
    'Tracks the athlete and the bell, counts swing reps and judges technique per rep (hinge, arms, bell height, back). Best with a side-on camera.',
  needsVideo: true,
  needsAudio: false,
  // Two YOLO passes on CPU — same generous delay as the other YOLO backends.
  defaultDelayMs: 3000,
  maxDelayMs: 5000,
  supportedInputTypes: [
    'local-mp4',
    'twitch-channel',
    'kick-channel',
    'hls',
    'whip',
  ],
  pythonScript: path.join(KETTLEBELL_COACH_DIR, 'worker.py'),
  requirementsFile: path.join(KETTLEBELL_COACH_DIR, 'requirements.txt'),
  venvDir: path.join(PEOPLE_COUNTER_DIR, '.venv'),
  envOverrideKey: 'KETTLEBELL_COACH_PYTHON_PATH',
  wsPort: 8091,
  // ultralytics/torch are checked lazily in the worker (missing heavy dep only
  // disables detection). clip/ftfy ARE checked here: they are this model's
  // additions to the shared venv, and the check failing is what makes
  // installVenv run our requirements file into it. The ultralytics version
  // guard matters too — yolo11-pose needs >= 8.3.
  depsCheck:
    'import cv2; import numpy; import websockets; import smelter; import clip; import ftfy; import ultralytics; assert tuple(map(int, ultralytics.__version__.split(".")[:2])) >= (8, 3)',
  extraEnv: {
    KETTLEBELL_POSE_WEIGHTS: DEFAULT_POSE_WEIGHTS,
    KETTLEBELL_WORLD_WEIGHTS: DEFAULT_WORLD_WEIGHTS,
    // Baselines for the tunables (kept in sync with the param defaults above);
    // live values arrive per-input via configure params.
    KETTLEBELL_KB_CONF: String(DEFAULT_KB_CONF),
    KETTLEBELL_KB_EVERY_N: String(DEFAULT_KB_EVERY_N),
    KETTLEBELL_IMGSZ: String(DEFAULT_IMGSZ),
    KETTLEBELL_ANALYSIS_FPS: String(DEFAULT_ANALYSIS_FPS),
    KETTLEBELL_REP_SENSITIVITY: String(DEFAULT_REP_SENSITIVITY),
    KETTLEBELL_HINGE_KNEE_MIN: String(DEFAULT_HINGE_KNEE_MIN),
    KETTLEBELL_ARM_STRAIGHT_MIN: String(DEFAULT_ARM_STRAIGHT_MIN),
    KETTLEBELL_BACK_ALIGN_MIN: String(DEFAULT_BACK_ALIGN_MIN),
    KETTLEBELL_CAMERA_VIEW: 'side',
    // Where the worker writes apex stills when captureRepFrames is on; Node
    // serves them back at GET /kbt-rep-frames/:fileName.
    KETTLEBELL_REP_FRAME_DIR: path.join(DATA_DIR, 'kbt-rep-frames'),
  },
  // Lets the UI show the debug drawBoxes toggle to preview the bell box.
  supportsBoxes: true,
  params: KETTLEBELL_COACH_PARAMS,
};

/** True for the kettlebell-coach model id. */
export function isKettlebellCoachModel(modelId: string): boolean {
  return modelId === KETTLEBELL_COACH_ID;
}
