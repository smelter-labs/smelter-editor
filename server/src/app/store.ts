import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import type {
  Resolution,
  ActiveTransition,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  Layer,
  ShaderConfig,
  ViewportProperties,
} from '../types';
import type { KbtViewTransitionStyle } from '@smelter-editor/types';
import type { HandsStore } from '../hands/handStore';
import type { DuckEntity } from '../duckHunter/duckFlight';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

export type { SnakeGameState } from '../snakeGame/types';
import type { SnakeGameState } from '../snakeGame/types';

export type InputConfig = {
  inputId: string;
  title: string;
  description: string;
  imageId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  snakeGameState?: SnakeGameState;
  handsSourceInputId?: string;
  handsStore?: StoreApi<HandsStore>;
  replaceWith?: InputConfig;
  attachedInputs?: InputConfig[];
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
  frozenImageId?: string;
  hidden?: boolean;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<BorderProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<SnakeGameDisplayProperties>;

export type RoomStoreState = {
  inputs: InputConfig[];
  /** Connected inputs with transcription — drives hidden side-channel decode. */
  transcriptionSideChannelInputIds: string[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
} & Partial<ViewportProperties>;

export type RoomStore = {
  inputs: InputConfig[];
  layers: Layer[];
  resolution: Resolution;
  outputShaders: ShaderConfig[];
  transcriptionSideChannelInputIds: string[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  transcripts: Record<string, string>;
  peopleCounts: Record<string, number>;
  peopleBoxes: Record<string, PersonBoxes>;
  buildingBoxes: Record<string, BuildingBoxes>;
  carAdBoxes: Record<string, CarAdBoxes>;
  carHueBoxes: Record<string, CarHueBoxes>;
  kettlebell: Record<string, KettlebellOverlayState>;
  shooter: ShooterOverlay | null;
  kbTournament: KbtHudState | null;
  updateState: (state: RoomStoreState & { layers: Layer[] }) => void;
  setOutputShaders: (shaders: ShaderConfig[]) => void;
  setInputFrozenImage: (inputId: string, imageId: string | null) => void;
  setTranscript: (inputId: string, text: string) => void;
  setPeopleCount: (inputId: string, count: number | null) => void;
  setPeopleBoxes: (inputId: string, boxes: PersonBoxes | null) => void;
  setBuildingBoxes: (inputId: string, boxes: BuildingBoxes | null) => void;
  setCarAdBoxes: (inputId: string, boxes: CarAdBoxes | null) => void;
  setCarHueBoxes: (inputId: string, boxes: CarHueBoxes | null) => void;
  setKettlebell: (
    inputId: string,
    state: KettlebellOverlayState | null,
  ) => void;
  setShooter: (shooter: ShooterOverlay | null) => void;
  setKbTournament: (state: KbtHudState | null) => void;
  /** Interval (ms) for the JS-driven overlay animation tickers (skeleton rig,
   * rep floaters, milestone shake). Scene pushes are throttled to 30 ms by the
   * reconciler anyway, so values below ~30 buy nothing visually. */
  animTickMs: number;
  setAnimTickMs: (ms: number) => void;
} & Partial<ViewportProperties>;

/** A detection bounding box, normalized to 0..1 of the input frame. */
export type PersonBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Model confidence for this detection, 0..1 (absent for non-YOLO backends). */
  conf?: number;
  /** What produced this box: a YOLO detection or a motion-fusion blob (bird
   * counter only). Absent for backends predating the field. */
  src?: 'yolo' | 'motion';
};

/**
 * A box after cross-frame tracking: carries a stable identity so it keeps the
 * same Pac-Man ghost color and can be smoothly interpolated across detections.
 */
export type TrackedPersonBox = PersonBox & { id: number; color: number };

/**
 * Building detection boxes (Ghost City), normalized to 0..1 of the input frame,
 * plus the frame dimensions they were detected in. Buildings are static, so
 * unlike people these carry no tracked identity — the render component smooths
 * them over time and the haunted-city shader haunts each box region.
 */
export type BuildingBoxes = {
  boxes: PersonBox[];
  frameW: number;
  frameH: number;
};

/**
 * Kettlebell-coach overlay state for one input: the tracked pose skeleton,
 * the bell box, and the badge fields (reps / exercise / last-rep verdict).
 * Unlike the box-only slices, the entry stays present with an empty pose while
 * the model is enabled so the badge keeps rendering between detections.
 */
export type KettlebellOverlayState = {
  /** 17 COCO keypoints as [x, y, conf], normalized to the source frame. */
  kpts: [number, number, number][] | null;
  /** Tracked kettlebell box, or null while the bell is lost. */
  kb: PersonBox | null;
  exercise: 'swing' | 'clean' | 'snatch' | 'idle';
  repCount: number;
  lastRepVerdict: 'correct' | 'incorrect' | null;
  lastRepIssues: string[];
  frameW: number;
  frameH: number;
  /** Mirrors of the model config at apply time (skeleton param / drawBoxes). */
  skeleton: KettlebellSkeletonMode;
  drawBoxes: boolean;
};

/** How the pose skeleton is drawn on the output. */
export type KettlebellSkeletonMode = 'off' | 'lines' | 'neon';

/**
 * The `skeleton` model param as a draw mode. 'on' is the legacy value for the
 * plain wireframe and stays supported so saved configs keep rendering.
 */
export function kettlebellSkeletonMode(param: unknown): KettlebellSkeletonMode {
  const value = String(param ?? 'neon');
  if (value === 'off') return 'off';
  if (value === 'neon') return 'neon';
  return 'lines';
}

/** A point in normalized [0,1] frame coordinates. */
export type QuadPoint = { x: number; y: number };

/** The ad quad on a car's side, corner order [tl, tr, br, bl], normalized. */
export type CarQuad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];

/** A detected wheel: center + radius, normalized to the frame width. */
export type CarWheel = { x: number; y: number; r: number };

/** One vehicle as detected by the car-ads worker (pre-tracking). */
export type CarAdDetection = {
  box: PersonBox;
  /** Door-panel quad from the wheel pair, or absent when the side isn't visible. */
  quad?: CarQuad | null;
  wheels?: CarWheel[] | null;
};

/** A vehicle after cross-frame tracking: stable id, smoothed/held quad. */
export type TrackedCarAd = {
  id: number;
  box: PersonBox;
  quad?: CarQuad;
  wheels?: CarWheel[];
};

/** Tracked cars plus frame dimensions (cover mapping) and render options. */
export type CarAdBoxes = {
  cars: TrackedCarAd[];
  frameW: number;
  frameH: number;
  /** When true, map the ad image onto each quad; false = debug boxes only. */
  ads?: boolean;
  /** Operator-tunable ad opacity (Car Ads panel param). */
  adOpacity?: number;
};

/**
 * Tracked top-down cars for the per-car hue recolor (Car Hue model), plus the
 * frame dimensions (cover mapping) and the operator's recolor params. Boxes
 * reuse the person tracker, so each car carries a stable id.
 */
export type CarHueBoxes = {
  boxes: TrackedPersonBox[];
  frameW: number;
  frameH: number;
  /** When true, run the car-hue shader; false = debug boxes only. */
  effect?: boolean;
  /** Hue rotation in degrees applied to every car. */
  hue?: number;
  /** Extra per-car hue offset span (± degrees) for color variety. */
  spread?: number;
  /** 0..1 blend of the recolored result. */
  strength?: number;
  /** Extra saturation inside each car mask (0..0.6). */
  satBoost?: number;
  /**
   * 0..1 paint strength on white/silver cars — hue rotation can't change an
   * achromatic car, so bright colorless pixels get painted with the hue.
   */
  whiteBoost?: number;
};

/** Boxes plus the frame dimensions they were detected in (for cover mapping). */
export type PersonBoxes = {
  boxes: TrackedPersonBox[];
  frameW: number;
  frameH: number;
  /** When true, render detections as sprites (see `sprite`) not green boxes. */
  ghost?: boolean;
  /** Which sprite to draw in ghost mode: bird (Duck Hunt ducks) or haunting
   * ghosts — people detections always use 'haunter'. */
  sprite?: 'bird' | 'haunter';
  /**
   * Operator-tunable duck-size multiplier (Duck Hunter panel), applied on top
   * of the sprite's base footprint. 1 = default; 0.5 = ducks half as big.
   */
  duckScale?: number;
  /**
   * Operator-tunable free-flight timing (Duck Hunter panel). `duckPauseMs` is
   * how long a duck holds its spawn spot before flying off; `duckFlySpeed` is
   * how fast it flies off, as a fraction of the larger screen edge per second.
   */
  duckPauseMs?: number;
  duckFlySpeed?: number;
  /**
   * Operator-tunable haunting-ghosts config (Haunter panel), present only when
   * `sprite` is 'haunter'. Count = pool size; dist = attach threshold as a
   * fraction of min(output edge); scale/speed = sprite size and follow-speed
   * multipliers. Defaults live in haunterModel.ts.
   */
  haunterCount?: number;
  haunterDist?: number;
  haunterScale?: number;
  haunterSpeed?: number;
  /**
   * Draw each box straight at its detected position instead of easing toward
   * it. Set by the marker backend, whose boxes are keyed out of the frame
   * rather than inferred — easing would visibly trail the marker they came
   * from. Inferred detections keep the default smoothing.
   */
  snap?: boolean;
  /**
   * Border thickness in px for the drawn boxes. The marker backend raises it so
   * the drawn outline covers the marker burned into the footage.
   */
  borderWidth?: number;
};

/** A player's crosshair in normalized content space [0,1] of the target input. */
export type ShooterCrosshair = {
  clientId: string;
  x: number;
  y: number;
  color: string;
  name: string;
  /** Hunter character picked on the phone (see SHOOTER_CHARACTERS). */
  characterId?: string;
  /** Smelter input id of the player's live camera (WHIP), if the camera is on. */
  camInputId?: string;
  /** The camera publish is heartbeat-live (false = registered but dark). */
  camLive?: boolean;
  ammo: number;
  maxAmmo: number;
  /** Full regen time for one round (ms) — with reloadEndsAt gives progress. */
  reloadMs: number;
  /** Wall-clock ms when the next round regenerates, or null when the mag is full. */
  reloadEndsAt: number | null;
};

/** One scoreboard row on the broadcast (sorted by score in the overlay). */
export type ShooterScoreRow = {
  clientId: string;
  name: string;
  color: string;
  /** Hunter character picked on the phone (see SHOOTER_CHARACTERS). */
  characterId?: string;
  score: number;
  /** Smelter input id of the player's live camera (WHIP), if the camera is on. */
  camInputId?: string;
  /** The camera publish is heartbeat-live (false = registered but dark). */
  camLive?: boolean;
  ammo: number;
  maxAmmo: number;
  reloadMs: number;
  reloadEndsAt: number | null;
};

/** A short-lived shot effect at a point (content coords + timestamp + kind). */
export type ShooterBurst = {
  id: number;
  x: number;
  y: number;
  at: number;
  kind: 'hit' | 'miss';
};

/** The Duck Hunt dog popping up (holding two ducks) after a 2-in-a-row streak.
 * `x` is the pop-up column in normalized [0,1] content space; `color` is the
 * scoring player's hex color (the dog is hue-tinted to it); `at` is the ms the
 * reveal began, for the rise → hold → drop animation. */
export type DogReveal = {
  id: number;
  color: string;
  x: number;
  at: number;
};

/** Arcade match state burned into the broadcast HUD (countdown / clock /
 * game-over banner). Absent/null in free-play (the classic dashboard flow). */
export type ShooterMatchOverlay = {
  phase: 'countdown' | 'playing' | 'ended';
  mode: 'time' | 'points';
  /** Points mode target; null in time mode. */
  targetScore: number | null;
  /** Wall-clock ms when 'playing' begins (countdown end). */
  startsAt: number;
  /** Time mode deadline (wall-clock ms); null in points mode. */
  endsAt: number | null;
  /** 'ended' only; null while live (or on a draw). */
  winner: {
    name: string;
    color: string;
    score: number;
    characterId?: string;
  } | null;
};

/** One player tile's chrome on the Kettlebell Tournament broadcast. */
export type KbtHudTile = {
  clientId: string;
  name: string;
  color: string;
  /** Registered engine image id of the player's profile photo, if any. */
  photoImageId?: string | null;
  points: number;
  /** Total counted reps this heat (all exercises; excludes no-count
   * no-reps when countIncorrectReps is off). */
  reps: number;
  /** Monotonic count of judged rep attempts this heat, no-count no-reps
   * included — the floater's spawn/reset clock (reps alone stalls when
   * countIncorrectReps is off). */
  repSeq: number;
  /** Per-exercise rep counts (the solo scene's AI REP TRACKER panel). */
  repsByExercise: { swing: number; clean: number; snatch: number };
  /** Reps per minute over a rolling window (snapshot-computed). */
  rpm: number;
  /** 1-based rank within the running heat by points (grid plate rank block). */
  rank: number;
  /** Consecutive correct reps right now. */
  streak: number;
  /** Exercise the coach currently sees ('idle' between efforts). */
  exercise: string;
  /**
   * A rep landed just before this snapshot — snapshot-relative on purpose:
   * the HUD applies ~3s late (held to the delayed video), so age computed
   * against live Date.now() at render time would never show a flash.
   */
  flash: boolean;
  lastRepVerdict: 'correct' | 'incorrect' | null;
  lastRepPoints: number;
  /**
   * Every-5th-rep celebration (aura + tile shake). `p` is the effect's
   * progress (0..1) at snapshot time — snapshot-relative like `flash`; the
   * renderer smooths locally between the ~10 Hz snapshots.
   */
  fx?: {
    exercise: 'swing' | 'clean' | 'snatch';
    color: string;
    p: number;
  } | null;
  /** The player's WHIP input stopped acking mid-heat. */
  signalLost?: boolean;
};

/** Heat clock chrome. remainingMs is snapshot-computed: the HUD state is
 * applied with the same ~3s hold as the delayed video, so rendering the
 * snapshot value (not endsAt vs live now) keeps the clock on the frame it
 * belongs to. */
export type KbtHudMatch = {
  phase: 'intro' | 'countdown' | 'playing' | 'ended';
  heatIndex: number;
  final: boolean;
  startsAt: number | null;
  endsAt: number | null;
  remainingMs: number | null;
  winner: { name: string; color: string; points: number } | null;
};

/**
 * Which broadcast scene the tournament chrome renders (kb_design port):
 * 'lobby' = roster QR panel, 'solo' = single-athlete heat with the hero
 * plate + rep tracker, 'grid' = 2-4 athletes with per-column plates,
 * 'board' = standings between heats, 'podium' = final results,
 * 'caster' = fullscreen commentator cam, 'split' = commentator + featured
 * lifter side by side (the last two only via the commentator's view override).
 */
export type KbtHudScene =
  | 'lobby'
  | 'solo'
  | 'grid'
  | 'board'
  | 'podium'
  | 'caster'
  | 'split';

export type KbtBoardRow = {
  rank: number;
  name: string;
  color: string;
  photoImageId?: string | null;
  points: number;
  reps: number;
  rpm: number;
};

/**
 * One view-switch animation: the chrome crossfade in KbtMatchHud and the
 * tile fade the controller drives through `input.activeTransition` share
 * this duration so both layers land together.
 */
export const KBT_VIEW_TRANSITION_MS = 350;

/**
 * Off-stage parking rect: a 1×1 pixel in the bottom-left corner. Inputs laid
 * here stay in the layer (audio in the mix, decoder warm) without any
 * visible video. Used for the audio-only commentator and for player cams
 * that are off-stage — every known input must always be mentioned in the
 * layout, or RoomState's unplaced-input auto-append resurrects it fullscreen.
 */
export function kbtParkRect(resolution: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: 0, y: resolution.height - 1, width: 1, height: 1 };
}

/**
 * Where the commentator's camera tile sits on the output — the controller
 * lays the WHIP input there and the HUD draws the lower-third around the
 * same rect. Off-scene (audio-only) rects are 1×1 in a corner.
 */
export function kbtCasterCamRect(
  resolution: { width: number; height: number },
  visible: boolean,
): { x: number; y: number; width: number; height: number } {
  if (!visible) return kbtParkRect(resolution);
  const k = resolution.height / 1080;
  const h = Math.round(124 * k);
  return {
    x: Math.round(70 * k),
    y: resolution.height - Math.round(70 * k) - h,
    // Landscape 16:9 tile (laptop webcam) at the lower-third height.
    width: Math.round(220 * k),
    height: h,
  };
}

/** Whether the commentator camera is visible (lower-third PiP shown). The
 * panel toggle (`pip`) gates every scene; caster/split are excluded because
 * the commentator is already full-frame there. PiP off = audio-only with the
 * mini ON AIR chip. */
export function kbtCasterVisible(scene: KbtHudScene, pip: boolean): boolean {
  return pip && scene !== 'caster' && scene !== 'split';
}

/**
 * Bar-chart denominator rounded up to the next `step`. A raw max shrinks
 * every bar the moment the leader scores (the denominator grows per rep);
 * stepping it makes rescales rare and read as a deliberate axis change.
 */
export function barScale(max: number, step = 10): number {
  return Math.max(step, Math.ceil(max / step) * step);
}

/** Kettlebell Tournament overlay state burned into the broadcast. */
export type KbtHudState = {
  scene: KbtHudScene;
  /** Active heat tiles keyed by the player's camera inputId. */
  tiles: Record<string, KbtHudTile>;
  match: KbtHudMatch | null;
  /** Clock chip left section, e.g. "1' AMRAP" / "10' SNATCH" + heat no. */
  heatLabel: string | null;
  /** Lobby scene payload (roster phase). */
  lobby: {
    /** Registered image id of the room's join QR, once generated. */
    qrImageId: string | null;
    /** Short human-readable join address under SCAN OR VISIT. */
    joinLabel: string | null;
    joined: {
      name: string;
      color: string;
      camConnected: boolean;
      photoImageId?: string | null;
    }[];
    joinedCount: number;
  } | null;
  /** Standings scene payload (between heats / after stop). */
  board: { rows: KbtBoardRow[]; final: boolean } | null;
  /** Podium scene payload (rows ordered rank 1..3). */
  podium: {
    rows: {
      rank: number;
      name: string;
      color: string;
      points: number;
      photoImageId?: string | null;
    }[];
  } | null;
  /** Commentator lower-third (null until one joins). */
  commentator: {
    name: string;
    camConnected: boolean;
    inputId: string | null;
    /** Panel toggle: PiP cam tile shown on non-featured scenes. */
    casterPip: boolean;
  } | null;
  /** Current leader (heat leader during play, standings leader otherwise). */
  leader: { name: string; points: number } | null;
  /** Short-lived celebration banner (lead change / streak / commentator hype). */
  banner: {
    kind: 'lead_change' | 'streak' | 'hype';
    text: string;
    color: string;
    at: number;
  } | null;
  /** Commentator-driven overlay (single exclusive slot; identity lives in the
   * controller, data is recomputed into this snapshot every publish). */
  overlay: KbtCommentatorHudOverlay | null;
  /** Floating rep text feature flag (config.repFloatText); the renderer
   * treats a missing value as on. */
  repFloatText?: boolean;
  /** config.countIncorrectReps; missing means on. Picks the incorrect-rep
   * floater style: asterisk (counted) vs struck-out (not counted). */
  countIncorrectReps?: boolean;
  /** View-switch animation style (panel toggle; missing means 'fade'). */
  viewTransitionStyle?: KbtViewTransitionStyle;
};

/** One player's stat block for spotlight / head-to-head overlays. */
export type KbtStatSide = {
  name: string;
  color: string;
  photoImageId: string | null;
  points: number;
  rpm: number;
  reps: number;
  streak: number;
  bestStreak: number;
  /** Correct-attempt ratio 0..1; null when the player has no attempts yet. */
  accuracy: number | null;
};

export type KbtCommentatorHudOverlay =
  | {
      kind: 'rep_shot';
      player: { name: string; color: string };
      shot: {
        /** Registered engine image; null while registering or file missing. */
        imageId: string | null;
        repIndex: number;
        exercise: 'swing' | 'clean' | 'snatch';
        verdict: 'correct' | 'incorrect';
        points: number;
        /** Display-ready issue labels, pre-mapped server-side. */
        issues: string[];
      };
      /** 0-based position in the player's shot list. */
      index: number;
      total: number;
      showVerdict: boolean;
    }
  | { kind: 'spotlight'; side: KbtStatSide; live: boolean }
  | { kind: 'h2h'; a: KbtStatSide; b: KbtStatSide; live: boolean };

/** Ghost Shooter overlay state rendered on the target (ghost-enabled) input. */
export type ShooterOverlay = {
  targetInputId: string;
  crosshairs: ShooterCrosshair[];
  scores: ShooterScoreRow[];
  bursts: ShooterBurst[];
  /** Duck Hunt dog reveals in flight (2-in-a-row celebration). */
  dogReveals: DogReveal[];
  /** Ghost ids currently shot down (hidden/animated) on the target input. */
  deadGhostIds: number[];
  /** Shot-down ghosts with the wall-clock ms they died, for the death
   * animation (hang → dim → fall). Same ids as deadGhostIds. */
  deadGhosts: { id: number; diedAt: number }[];
  /** Bird-sprite mode only: the authoritative live ducks (spawn state + flight
   * params baked in). The renderer draws these and the hit-test shoots at them,
   * so a shot always lands on the sprite. Empty for the Pac-Man ghost sprite. */
  ducks: DuckEntity[];
  /** Arcade match chrome (countdown / clock / game-over), null in free-play. */
  match?: ShooterMatchOverlay | null;
};

export function createRoomStore(
  resolution: Resolution = { width: 2560, height: 1440 },
): StoreApi<RoomStore> {
  return createStore<RoomStore>((set, get) => ({
    inputs: [],
    layers: [],
    resolution,
    outputShaders: [],
    transcriptionSideChannelInputIds: [],
    swapDurationMs: 500,
    swapOutgoingEnabled: true,
    swapFadeInDurationMs: 500,
    swapFadeOutDurationMs: 500,
    transcripts: {},
    peopleCounts: {},
    peopleBoxes: {},
    buildingBoxes: {},
    carAdBoxes: {},
    carHueBoxes: {},
    kettlebell: {},
    shooter: null,
    kbTournament: null,
    updateState: (incoming) => {
      const {
        inputs,
        layers,
        transcriptionSideChannelInputIds,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        swapFadeOutDurationMs,
        viewportTop,
        viewportLeft,
        viewportWidth,
        viewportHeight,
        viewportTransitionDurationMs,
        viewportTransitionEasing,
      } = incoming;
      set(() => ({
        inputs,
        layers,
        transcriptionSideChannelInputIds,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        swapFadeOutDurationMs,
        viewportTop,
        viewportLeft,
        viewportWidth,
        viewportHeight,
        viewportTransitionDurationMs,
        viewportTransitionEasing,
      }));
    },
    setOutputShaders: (shaders: ShaderConfig[]) => {
      set(() => ({ outputShaders: shaders }));
    },
    setInputFrozenImage: (inputId: string, imageId: string | null) => {
      set((state) => ({
        inputs: state.inputs.map((input) =>
          input.inputId === inputId
            ? { ...input, frozenImageId: imageId ?? undefined }
            : input,
        ),
      }));
    },
    setTranscript: (inputId: string, text: string) => {
      set((state) => {
        const next = { ...state.transcripts };
        if (text) next[inputId] = text;
        else delete next[inputId];
        return { transcripts: next };
      });
    },
    setPeopleCount: (inputId: string, count: number | null) => {
      set((state) => {
        const next = { ...state.peopleCounts };
        if (count !== null) next[inputId] = count;
        else delete next[inputId];
        return { peopleCounts: next };
      });
    },
    setPeopleBoxes: (inputId: string, boxes: PersonBoxes | null) => {
      set((state) => {
        const next = { ...state.peopleBoxes };
        // Haunter mode keeps zero-box frames: the renderer must stay mounted
        // so idle ghosts keep levitating while nobody is detected.
        if (boxes && (boxes.boxes.length > 0 || boxes.sprite === 'haunter')) {
          next[inputId] = boxes;
        } else delete next[inputId];
        return { peopleBoxes: next };
      });
    },
    setBuildingBoxes: (inputId: string, boxes: BuildingBoxes | null) => {
      set((state) => {
        const next = { ...state.buildingBoxes };
        if (boxes && boxes.boxes.length > 0) next[inputId] = boxes;
        else delete next[inputId];
        return { buildingBoxes: next };
      });
    },
    setCarAdBoxes: (inputId: string, boxes: CarAdBoxes | null) => {
      set((state) => {
        const next = { ...state.carAdBoxes };
        if (boxes && boxes.cars.length > 0) next[inputId] = boxes;
        else delete next[inputId];
        return { carAdBoxes: next };
      });
    },
    setCarHueBoxes: (inputId: string, boxes: CarHueBoxes | null) => {
      set((state) => {
        const next = { ...state.carHueBoxes };
        if (boxes && boxes.boxes.length > 0) next[inputId] = boxes;
        else delete next[inputId];
        return { carHueBoxes: next };
      });
    },
    setKettlebell: (inputId: string, state: KettlebellOverlayState | null) => {
      set((prev) => {
        const next = { ...prev.kettlebell };
        if (state) next[inputId] = state;
        else delete next[inputId];
        return { kettlebell: next };
      });
    },
    setShooter: (shooter: ShooterOverlay | null) => {
      // The 30 Hz game loop mints a fresh overlay object every tick even when
      // nothing visible changed (idle attract mode, no ducks, no players); an
      // unconditional set() would re-render the whole scene tree each time.
      // All overlay timestamps are absolute, so idle snapshots compare equal.
      const prev = get().shooter;
      if (
        prev === shooter ||
        (prev != null &&
          shooter != null &&
          JSON.stringify(prev) === JSON.stringify(shooter))
      ) {
        return;
      }
      set(() => ({ shooter }));
    },
    setKbTournament: (kbTournament: KbtHudState | null) => {
      // publishHud mints a fresh snapshot object on every 10 Hz tick even
      // when nothing visible changed; an unconditional set() would re-render
      // the whole scene tree (twice while recording) each time.
      const prev = get().kbTournament;
      if (
        prev === kbTournament ||
        (prev != null &&
          kbTournament != null &&
          JSON.stringify(prev) === JSON.stringify(kbTournament))
      ) {
        return;
      }
      set(() => ({ kbTournament }));
    },
    animTickMs: 16,
    setAnimTickMs: (ms: number) => {
      set(() => ({ animTickMs: Math.max(16, Math.round(ms)) }));
    },
  }));
}

export function useResolution() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.resolution);
}

function useIsVertical() {
  const resolution = useResolution();
  return resolution.height > resolution.width;
}

function useSwapDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapDurationMs);
}

function useSwapFadeInDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeInDurationMs);
}

function useSwapFadeOutDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeOutDurationMs);
}

export function useInputs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.inputs);
}

export function useTranscriptionSideChannelInputIds() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.transcriptionSideChannelInputIds);
}

export function useLayers() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.layers);
}

export function useOutputShaders() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.outputShaders);
}

export function useViewport() {
  const store = useContext(StoreContext);
  return useStore(
    store,
    useShallow((state) => ({
      viewportTop: state.viewportTop,
      viewportLeft: state.viewportLeft,
      viewportWidth: state.viewportWidth,
      viewportHeight: state.viewportHeight,
      viewportTransitionDurationMs: state.viewportTransitionDurationMs,
      viewportTransitionEasing: state.viewportTransitionEasing,
    })),
  );
}

/** Kettlebell Tournament burned-in HUD state (null while no heat is staged). */
export function useKbTournament() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.kbTournament);
}

/** Interval for the JS-driven overlay animation tickers. */
export function useAnimTickMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.animTickMs);
}

export const StoreContext =
  createContext<StoreApi<RoomStore>>(createRoomStore());
