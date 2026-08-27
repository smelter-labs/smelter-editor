import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ensureDir, pathExists, readdir, remove, writeFile } from 'fs-extra';
import QRCode from 'qrcode';
import { Mutex } from 'async-mutex';
import { SmelterInstance, type SmelterOutput } from '../smelter';
import type { InputConfig } from '../app/store';
import type { Layer, BehaviorInputInfo } from '../types';
import { computeLayout } from '@smelter-editor/types';
import type { SnakeEventType } from '../snakeGame/types';
import type { RoomNameEntry } from '../core/roomNames';
import {
  TimelinePlayer,
  type TimelineListener,
  type TimelineRoomStateAdapter,
} from '../timeline/TimelinePlayer';
import type { TimelineConfig } from '../timeline/types';
import { logTimelineEvent } from '../dashboard';
import { isSmelterTransportError } from '../smelterTransportError';

import { InputManager } from './InputManager';
import { RecordingController } from './RecordingController';
import { MotionController } from './MotionController';
import { CaptionsController } from './CaptionsController';
import { hasTranscription, supportsTranscription } from '../captions/constants';
import { getCaptionBridge } from '../captions/captionBridgeRegistry';
import {
  RoomAIController,
  ModelRegistry,
  defaultAIModelConfig,
  computeSideChannelConfig,
  requiresSideChannelReconnect,
  manifestSupportsInput,
  PEOPLE_COUNTER_MANIFESTS,
  PEOPLE_COUNTER_YOLO_ID,
  PEOPLE_COUNTER_YOLO_BIRDS_ID,
  isMarkerSource,
  BUILDING_DETECTOR_ID,
  CAR_ADS_ID,
  CAR_HUE_ID,
  KETTLEBELL_COACH_ID,
  type ModelResultEvent,
} from '../ai-models';
import { PeopleTracker } from '../ai-models/people-counter/people-tracker';
import { jitterBoxes } from '../ai-models/people-counter/box-jitter';
import { CarTracker } from '../ai-models/car-ads/car-tracker';
import { kettlebellSkeletonMode } from '../app/store';
import type { CarAdDetection } from '../app/store';
import { DuckHunterController } from '../duckHunter/DuckHunterController';
import type { MatchCommand } from '../duckHunter/DuckHunterController';
import type { ShooterMatchEvent } from '@smelter-editor/types';
import {
  KettlebellCoachController,
  type KettlebellResultData,
} from '../kettlebell/KettlebellCoachController';
import {
  KettlebellTournamentController,
  type KbtMatchCommand,
  type KbtMatchError,
} from '../kettlebell/KettlebellTournamentController';
import type {
  KbtConfig,
  KbtExerciseKey,
  KbtMatchEvent,
  KbtStateEvent,
  KettlebellExercise,
} from '@smelter-editor/types';
import { config } from '../config';
import { roomEventBus } from '../core/roomEventBus';
import {
  DEFAULT_HAUNTER_COUNT,
  DEFAULT_HAUNTER_DIST,
  DEFAULT_HAUNTER_SCALE,
  DEFAULT_HAUNTER_SPEED,
  MAX_HAUNTERS,
} from '../haunter/haunterModel';
import { SnakeGameController } from './SnakeGameController';
import { PlaceholderManager } from './PlaceholderManager';
import { AudioController } from '../audio/AudioController';
import type { AudioStoreState } from '../audio/audioStore';
import type { StoreApi } from 'zustand';
import { DATA_DIR } from '../dataDir';
import type {
  PendingWhipInputData,
  RoomInputState,
  RegisterInputOptions,
  RoomSnapshot,
  UpdateInputOptions,
} from './types';
import type { ShaderConfig, BroadcastTile } from '../types';
import type { AIModelConfig } from '@smelter-editor/types';

const RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS = 5500;
const FROZEN_IMAGE_UNREGISTER_GRACE_MS = 500;
const AUDIO_ASSETS_DIR = path.join(DATA_DIR, 'audios');

function cloneLayers(layers: Layer[]): Layer[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(layers);
  }
  return JSON.parse(JSON.stringify(layers)) as Layer[];
}

function sanitizeLayerInputs(layers: Layer[]): Layer[] {
  return layers.map((layer) => {
    const seenInputIds = new Set<string>();
    const inputs = layer.inputs.filter((input) => {
      if (seenInputIds.has(input.inputId)) {
        return false;
      }
      seenInputIds.add(input.inputId);
      return true;
    });

    const dedupedLayer =
      inputs.length === layer.inputs.length ? layer : { ...layer, inputs };

    if (dedupedLayer.carousel) {
      const n = dedupedLayer.inputs.length;
      const c = dedupedLayer.carousel;
      const clampedActive =
        n === 0 ? 0 : Math.max(0, Math.min(c.activeIndex, n - 1));
      const requestedVisible = c.visibleCount ?? 1;
      const clampedVisible = Math.max(
        1,
        Math.min(requestedVisible, Math.max(1, n)),
      );
      const requestedGap = c.gap ?? 0;
      const clampedGap = Math.max(0, Math.min(requestedGap, 4096));
      const needsUpdate =
        clampedActive !== c.activeIndex ||
        clampedVisible !== requestedVisible ||
        clampedGap !== requestedGap;
      if (needsUpdate) {
        return {
          ...dedupedLayer,
          carousel: {
            ...c,
            activeIndex: clampedActive,
            visibleCount: clampedVisible,
            gap: clampedGap,
          },
        };
      }
    }

    return dedupedLayer;
  });
}

function normalizeFramePositionMs(
  requestedMs: number,
  isLooped: boolean,
  durationMs?: number,
): number {
  let normalized = Math.max(0, requestedMs);
  if (durationMs && durationMs > 0) {
    if (isLooped) {
      normalized = normalized % durationMs;
    } else {
      normalized = Math.min(normalized, Math.max(0, durationMs - 1));
    }
  }
  return normalized;
}

function isAudioBackedLocalMp4(mp4FilePath: string): boolean {
  const relativeToAudioDir = path.relative(AUDIO_ASSETS_DIR, mp4FilePath);
  return (
    relativeToAudioDir !== '' &&
    !relativeToAudioDir.startsWith('..') &&
    !path.isAbsolute(relativeToAudioDir)
  );
}

export const MARKER_ERASE_SHADER_ID = 'marker-erase';

/**
 * Add, update or drop the marker-erase shader on an input so it always matches
 * the model driving it.
 *
 * The shader and the detector key the same colour from opposite ends: the
 * worker reads the drawn rectangles off the side channel, the shader removes
 * them from the composited picture. Wiring the toggle here rather than in the
 * UI is what keeps them agreeing — change 'Marker color' and the shader follows
 * without the user having to remember to update it in two places.
 */
function syncMarkerEraseShader(
  input: RoomInputState,
  cfg: AIModelConfig,
  enabled: boolean,
): void {
  const wanted =
    enabled && Boolean(cfg.eraseMarkers) && isMarkerSource(cfg.params);
  const existing = input.shaders.findIndex(
    (s) => s.shaderId === MARKER_ERASE_SHADER_ID,
  );

  if (!wanted) {
    if (existing !== -1) input.shaders.splice(existing, 1);
    return;
  }

  const color = String(cfg.params?.markerColor ?? '#ff0000');
  const shader: ShaderConfig = {
    shaderName: 'Marker Erase',
    shaderId: MARKER_ERASE_SHADER_ID,
    enabled: true,
    params: [{ paramName: 'marker_color', paramValue: color }],
  };

  if (existing === -1) {
    // Last in the chain, so it erases what earlier shaders may have shifted
    // around rather than having its fill re-tinted by them.
    input.shaders.push(shader);
  } else {
    input.shaders[existing] = shader;
  }
}

function layoutInputsEqual(a: Layer['inputs'], b: Layer['inputs']): boolean {
  if (a.length !== b.length) return false;
  return a.every((ai, i) => {
    const bi = b[i]!;
    return (
      ai.inputId === bi.inputId &&
      ai.x === bi.x &&
      ai.y === bi.y &&
      ai.width === bi.width &&
      ai.height === bi.height
    );
  });
}

/** How long a caption stays on screen after its audio segment ends. */
const SUBTITLE_LINGER_MS = 500;

export class RoomState {
  private readonly mutex = new Mutex();
  private destroyed = false;

  private readonly inputManager: InputManager;
  private readonly recordingController: RecordingController;
  private readonly motionController: MotionController;
  private readonly aiController: RoomAIController;
  private readonly captionsController: CaptionsController;
  private readonly snakeGameController: SnakeGameController;
  private readonly placeholderManager: PlaceholderManager;
  private readonly audioController: AudioController;

  /** Per-input cross-frame tracker for YOLO people boxes (stable id + color). */
  private readonly peopleTrackers = new Map<string, PeopleTracker>();

  /**
   * Cross-frame tracker for bird boxes (stable id + color), keyed
   * `modelId:inputId` — several bird backends can run on the same input.
   */
  private readonly birdTrackers = new Map<string, PeopleTracker>();

  /** Per-input cross-frame tracker for car-ads vehicles (stable id + quad). */
  private readonly carAdTrackers = new Map<string, CarTracker>();

  /** Per-input cross-frame tracker for top-down car-hue boxes (stable id). */
  private readonly carHueTrackers = new Map<string, PeopleTracker>();

  /** Duck Hunter game (phone-gyroscope crosshairs targeting the ducks). */
  private readonly duckHunter: DuckHunterController;
  private readonly kettlebellController: KettlebellCoachController;
  /** Kettlebell Tournament (phone cameras + coach reps → heats + scores). */
  private readonly kbTournament: KettlebellTournamentController;

  /**
   * Per-input wall-clock of the last SCHEDULED kettlebell overlay apply. The
   * hold is `delayMs - procMs`, so a slow result (the frame that also ran the
   * bell detector) waits less than the fast result behind it and would land
   * out of order — the skeleton visibly snapping back in time. Clamping each
   * apply to be no earlier than the previous one keeps the sequence monotonic.
   */
  private readonly kettlebellApplyAt = new Map<string, number>();

  private stateChangeListeners = new Set<() => void>();

  private timelinePlayer: TimelinePlayer | null = null;
  private timelineListeners = new Set<TimelineListener>();
  private pausedAttachedInputVolumes = new Map<string, number>();

  private frozenImages: Map<string, { imageId: string; jpegPath: string }> =
    new Map();
  private frozenImageCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private pendingImageUnregisters = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; jpegPath: string }
  >();

  private storeUpdateScheduled = false;
  private lastStoreFlushTime = 0;
  private pendingStoreFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private _restoringTimeline = false;
  private static readonly MIN_STORE_FLUSH_INTERVAL_MS = 10;

  private layers: Layer[] = [
    {
      id: 'default',
      inputs: [],
    },
  ];
  private swapDurationMs: number = 500;
  private swapOutgoingEnabled: boolean = true;
  private swapFadeInDurationMs: number = 500;
  private swapFadeOutDurationMs: number = 500;
  private sortMode: 'timeline' | 'layers' = 'layers';

  private viewportTop?: number;
  private viewportLeft?: number;
  private viewportWidth?: number;
  private viewportHeight?: number;
  private viewportTransitionDurationMs?: number;
  private viewportTransitionEasing?: string;

  private broadcastTiles: BroadcastTile[] = [];
  private selectedBroadcastTileId: string | null = null;
  private isBroadcastMode: boolean = false;

  public idPrefix: string;
  private output: SmelterOutput;

  public lastReadTimestamp: number;
  public creationTimestamp: number;
  private _pendingDelete?: boolean;
  private _isPublic: boolean = true;
  private _pendingWhipInputs: PendingWhipInputData[] = [];
  public roomName: RoomNameEntry;

  private readonly initInputs: RegisterInputOptions[];
  private readonly skipDefaultInputs: boolean;

  /** Per-input timers that clear a caption after its audio segment ends. */
  private transcriptClearTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  public constructor(
    idPrefix: string,
    output: SmelterOutput,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false,
    roomName?: RoomNameEntry,
    audioStore?: StoreApi<AudioStoreState>,
  ) {
    this.idPrefix = idPrefix;
    this.output = output;
    this.initInputs = initInputs;
    this.skipDefaultInputs = skipDefaultInputs;
    this.roomName = roomName ?? {
      pl: `Pokój ${idPrefix.slice(0, 6)}`,
      en: `Room ${idPrefix.slice(0, 6)}`,
    };
    this.lastReadTimestamp = Date.now();
    this.creationTimestamp = Date.now();

    this.placeholderManager = new PlaceholderManager(idPrefix);
    this.aiController = new RoomAIController(idPrefix);
    this.motionController = new MotionController(idPrefix, () =>
      this.inputManager.getInputs(),
    );
    this.captionsController = new CaptionsController(idPrefix);
    this.audioController = new AudioController(idPrefix, output, audioStore);
    this.inputManager = new InputManager(
      idPrefix,
      this.placeholderManager,
      this.motionController,
      this.captionsController,
      this.aiController,
      () => this.updateStoreWithState(),
    );
    this.recordingController = new RecordingController(idPrefix, output);
    this.snakeGameController = new SnakeGameController();
    this.duckHunter = new DuckHunterController(idPrefix, output.store);
    // The coach's debounced events are tee'd into the tournament controller —
    // one debounce layer, two consumers (room bus + scoring). The arrow reads
    // this.kbTournament lazily, so construction order below doesn't matter.
    this.kettlebellController = new KettlebellCoachController(
      idPrefix,
      (id, event) => {
        roomEventBus.broadcast(id, event);
        this.kbTournament?.onCoachEvent(event);
      },
    );
    this.kbTournament = new KettlebellTournamentController(idPrefix, {
      broadcast: (event) => roomEventBus.broadcast(idPrefix, event),
      sendTo: (clientId, event) =>
        roomEventBus.sendTo(idPrefix, clientId, event),
      hasActiveRecording: () => this.recordingController.hasActiveRecording(),
      // InputManager path (NOT DuckHunter's raw registerInput): WHIP inputs
      // registered here get the video side channel the coach model needs, and
      // the standard `${roomId}::whip::${uuid}` id stays inside the 103-char
      // unix-socket path budget.
      registerPlayerCam: async (name, dims) => {
        const inputId = await this.addNewInput({
          type: 'whip',
          username: `[camera] ${name}`,
          // Real track dimensions from the phone: the registration path
          // honors exact dims (updateInput's bare-orientation heuristic
          // would clobber them, so orientation always travels WITH dims).
          ...(dims
            ? {
                nativeWidth: dims.width,
                nativeHeight: dims.height,
                orientation:
                  dims.height > dims.width
                    ? ('vertical' as const)
                    : ('horizontal' as const),
              }
            : {}),
        });
        if (!inputId) throw new Error('WHIP input registration failed');
        const bearerToken = await this.connectInput(inputId);
        return {
          inputId,
          whipUrl: `${config.whipBaseUrl}/${inputId}`,
          bearerToken,
        };
      },
      removeInput: (inputId) => this.removeInput(inputId),
      setKettlebellCoach: (inputId, enabled, params) =>
        this.setAIModelEnabled(
          inputId,
          KETTLEBELL_COACH_ID,
          enabled,
          undefined,
          false,
          params,
        ),
      layoutTiles: (tiles) =>
        this.updateLayers([
          {
            id: 'kbt-stage',
            inputs: tiles.map((t) => ({
              inputId: t.inputId,
              x: t.x,
              y: t.y,
              width: t.width,
              height: t.height,
              transitionDurationMs: t.transitionDurationMs,
              transitionEasing: t.transitionEasing,
            })),
          },
        ]),
      // InputManager directly (like the volume calls) — the public
      // RoomState.updateInput would round-trip the engine for a purely
      // compositor-side fade.
      runInputTransition: (inputId, transition) =>
        this.inputManager.updateInput(inputId, {
          activeTransition: transition,
        }),
      isInputConnected: (inputId) =>
        this.inputManager
          .getInputs()
          .some((i) => i.inputId === inputId && i.status === 'connected'),
      // Engine status for WHIP means "registered", not "publishing" — real
      // liveness comes from the phone's heartbeat acks (KBT camera gate).
      isInputLive: (inputId) => this.inputManager.isWhipInputLive(inputId),
      getResolution: () => this.output.store.getState().resolution,
      publishHud: (state) =>
        this.output.store.getState().setKbTournament(state),
      // Lobby-scene QR: render the join URL to a PNG under the data dir and
      // register it with the engine. The image id carries a content hash —
      // registered images are immutable per id, so a changed URL must mint a
      // fresh id for the HUD to pick up.
      registerJoinQr: async (url) => {
        const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
        const safeRoom = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        const dir = path.join(DATA_DIR, 'kbt-qr');
        await ensureDir(dir);
        const file = path.join(dir, `${safeRoom}-${hash}.png`);
        await QRCode.toFile(file, url, {
          type: 'png',
          width: 288,
          margin: 0,
          errorCorrectionLevel: 'M',
          // Drawn on the join panel's baked cream square — match its tone so
          // the quiet zone blends in.
          color: { dark: '#101114ff', light: '#e8e4daff' },
        });
        const imageId = `kbt-qr-${safeRoom}-${hash}`;
        await SmelterInstance.registerImage(imageId, {
          serverPath: file,
          assetType: 'png',
        });
        return imageId;
      },
      // Profile photos follow the QR's immutability rule: the id embeds the
      // content hash, so a re-uploaded photo mints a fresh id.
      registerPlayerPhoto: async (photoPath, photoHash) => {
        const safeRoom = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        const imageId = `kbt-photo-${safeRoom}-${photoHash}`;
        // Re-uploading earlier content mints the same id — cancel a pending
        // deferred unregister so it doesn't kill the image we're reviving.
        const pending = this.pendingImageUnregisters.get(imageId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingImageUnregisters.delete(imageId);
        }
        await SmelterInstance.registerImage(imageId, {
          serverPath: photoPath,
          assetType: 'jpeg',
        });
        return imageId;
      },
      unregisterPlayerPhoto: (imageId, photoPath) => {
        // Deferred so a HUD snapshot still holding the old id keeps rendering
        // through the grace window; the helper deletes the file afterwards.
        if (imageId) this.deferredUnregisterImage(imageId, photoPath);
        else void remove(photoPath).catch(() => {});
      },
      // Rep-apex stills for the commentator's REP CAM overlay. File names are
      // per-rep unique, so a name hash is a stable content id (same
      // immutability rule as photos). Resolves null when the file is gone
      // (stale url after a restart) — the overlay then keeps its placeholder.
      registerRepShotImage: async (url) => {
        const m = /^\/kbt-rep-frames\/([A-Za-z0-9._-]+)$/.exec(url);
        if (!m) return null;
        const file = path.join(DATA_DIR, 'kbt-rep-frames', m[1]);
        if (!(await pathExists(file))) return null;
        const hash = createHash('sha1').update(m[1]).digest('hex').slice(0, 10);
        const safeRoom = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        const imageId = `kbt-repshot-${safeRoom}-${hash}`;
        try {
          await SmelterInstance.registerImage(imageId, {
            serverPath: file,
            assetType: 'jpeg',
          });
        } catch {
          return null;
        }
        return imageId;
      },
      // NOT deferredUnregisterImage: that helper deletes the backing file,
      // and rep frames are still HTTP-served (the room's GC sweep owns them).
      unregisterRepShotImage: (imageId) => {
        void SmelterInstance.unregisterImage(imageId).catch(() => {});
      },
    });

    let motionResultCount = 0;
    void this.aiController.wireSidecarListeners('motion', (event) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as { score?: number };
      if (typeof data.score === 'number') {
        input.motionScore = data.score;
      } else {
        input.motionScore = undefined;
      }
      motionResultCount++;
      if (motionResultCount === 1 || motionResultCount % 50 === 0) {
        console.log(
          `[motion] score received #${motionResultCount} inputId=${event.inputId} score=${data.score}`,
        );
      }
      this.motionController.emitMotionScores();
    });

    const onPeopleCount = (event: ModelResultEvent) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as {
        count?: number;
        boxes?: {
          x: number;
          y: number;
          w: number;
          h: number;
          conf?: number;
          src?: 'yolo' | 'motion';
        }[];
        frameW?: number;
        frameH?: number;
        procMs?: number;
      };

      // Editor-facing count is live (not synced to the delayed output).
      input.peopleCount =
        typeof data.count === 'number' ? data.count : undefined;

      // The side channel hands frames to the worker ~delayMs before the output
      // presents them. Hold the on-output overlay until the frame is due, minus
      // the time the worker already spent processing it, so boxes track the
      // video instead of running ahead. Uses the delay actually registered with
      // Smelter — the configured value can diverge from it when the config
      // changes without a reconnect (always the case for WHIP).
      const outputDelayMs = input.registeredSideChannelDelayMs ?? 0;
      const procMs = typeof data.procMs === 'number' ? data.procMs : 0;
      const holdMs = Math.max(0, outputDelayMs - procMs);

      const applyOverlay = () => {
        const store = this.output.store.getState();
        // The bird counter keeps its count editor-only — no 👥 badge on the
        // output (it would sit on top of the duck-hunt scene).
        store.setPeopleCount(
          event.inputId,
          event.modelId === PEOPLE_COUNTER_YOLO_BIRDS_ID
            ? null
            : (input.peopleCount ?? null),
        );

        // Only the YOLO backend emits boxes; render them when its drawBoxes
        // or ghostMode option is still enabled for this input at present time.
        if (event.modelId === PEOPLE_COUNTER_YOLO_ID) {
          const cfg = input.aiModels?.[PEOPLE_COUNTER_YOLO_ID];
          const hasFrame =
            Array.isArray(data.boxes) &&
            typeof data.frameW === 'number' &&
            typeof data.frameH === 'number';
          const ghost = Boolean(cfg?.enabled && cfg?.ghostMode);
          // Ghost mode always means the haunting ghosts (same as the Haunter
          // panel) — free-floating haunters that chase people. Published even
          // with zero tracked boxes so the renderer stays mounted and idle
          // ghosts keep waiting on-screen.
          const haunter = ghost;
          const show = Boolean(
            cfg?.enabled && (cfg?.drawBoxes || ghost) && hasFrame,
          );
          if (show) {
            // Feed every response (even empty ones) through the tracker so
            // boxes/ghosts keep a stable identity and survive brief dropouts.
            let tracker = this.peopleTrackers.get(event.inputId);
            if (!tracker) {
              tracker = new PeopleTracker();
              this.peopleTrackers.set(event.inputId, tracker);
            }
            const tracked = tracker.update(data.boxes!, Date.now());
            store.setPeopleBoxes(
              event.inputId,
              tracked.length > 0 || haunter
                ? {
                    boxes: tracked,
                    frameW: data.frameW!,
                    frameH: data.frameH!,
                    ghost,
                    ...(haunter
                      ? {
                          sprite: 'haunter' as const,
                          haunterCount: this.haunterCount,
                          haunterDist: this.haunterDist,
                          haunterScale: this.haunterScale,
                          haunterSpeed: this.haunterSpeed,
                        }
                      : {}),
                  }
                : null,
            );
          } else {
            this.peopleTrackers.delete(event.inputId);
            store.setPeopleBoxes(event.inputId, null);
          }
        } else if (event.modelId === PEOPLE_COUNTER_YOLO_BIRDS_ID) {
          // Birds mirror the people/ghost pipeline: the tracker gives a stable
          // id/color and a 2-response miss grace (so a briefly-lost bird keeps
          // its sprite), and we render either green boxes (drawBoxes, for
          // sensitivity testing) or bird sprites (ghostMode). The bird only
          // shows while it's being detected — there's no free-flight phase.
          const cfg = input.aiModels?.[PEOPLE_COUNTER_YOLO_BIRDS_ID];
          // In marker mode the boxes are keyed out of the frame rather than
          // inferred, so they are already exact: leading and easing them would
          // only push the drawn outline off the marker it was read from.
          const marker = isMarkerSource(cfg?.params);
          const hasFrame =
            Array.isArray(data.boxes) &&
            typeof data.frameW === 'number' &&
            typeof data.frameH === 'number';
          const sprite = Boolean(cfg?.enabled && cfg?.ghostMode);
          const show = Boolean(
            cfg?.enabled && (cfg?.drawBoxes || sprite) && hasFrame,
          );
          // The source is part of the key so flipping YOLO <-> markers starts a
          // fresh tracker: the two disagree on whether boxes are led, and a
          // reused tracker would keep the wrong setting for the rest of the run.
          const trackerKey = `${marker ? 'marker' : 'yolo'}:${event.inputId}`;
          if (show) {
            let tracker = this.birdTrackers.get(trackerKey);
            if (!tracker) {
              // Birds get a tighter 2-response miss grace than people so a
              // caught/lost bird stops rendering quickly.
              tracker = new PeopleTracker(2, !marker);
              this.birdTrackers.set(trackerKey, tracker);
            }
            const now = Date.now();
            let tracked = tracker.update(data.boxes!, now);
            if (marker) {
              tracked = jitterBoxes(
                tracked,
                Number(cfg?.params?.jitter ?? 0),
                now,
              );
            }
            store.setPeopleBoxes(
              event.inputId,
              tracked.length > 0
                ? {
                    boxes: tracked,
                    frameW: data.frameW!,
                    frameH: data.frameH!,
                    ghost: sprite,
                    sprite: 'bird',
                    duckScale: this.duckScale,
                    duckPauseMs: this.duckPauseMs,
                    duckFlySpeed: this.duckFlySpeed,
                    ...(marker
                      ? {
                          snap: true,
                          borderWidth: Number(cfg?.params?.border ?? 10),
                        }
                      : {}),
                  }
                : null,
            );
          } else {
            this.birdTrackers.delete(trackerKey);
            store.setPeopleBoxes(event.inputId, null);
          }
          // Ducks are owned/animated by the controller now (so a shot lands on
          // the sprite); keep its loop alive while birds are on screen, even
          // before any player joins.
          this.duckHunter.ensureActive();
        }
      };

      if (holdMs > 0) {
        setTimeout(applyOverlay, holdMs);
      } else {
        applyOverlay();
      }
    };
    for (const manifest of PEOPLE_COUNTER_MANIFESTS) {
      void this.aiController.wireSidecarListeners(manifest.id, onPeopleCount);
    }

    // Ghost City: building segmentation → haunted-city shader. Buildings are
    // static so there's no tracker — the render wrapper smooths the boxes. Held
    // to the delayed output like the people boxes so the haunt tracks the video.
    const onBuildings = (event: ModelResultEvent) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as {
        boxes?: { x: number; y: number; w: number; h: number }[];
        frameW?: number;
        frameH?: number;
        procMs?: number;
      };

      const outputDelayMs = input.registeredSideChannelDelayMs ?? 0;
      const procMs = typeof data.procMs === 'number' ? data.procMs : 0;
      const holdMs = Math.max(0, outputDelayMs - procMs);

      const applyOverlay = () => {
        const store = this.output.store.getState();
        const cfg = input.aiModels?.[BUILDING_DETECTOR_ID];
        const hasFrame =
          Array.isArray(data.boxes) &&
          typeof data.frameW === 'number' &&
          typeof data.frameH === 'number';
        if (cfg?.enabled && hasFrame && data.boxes!.length > 0) {
          store.setBuildingBoxes(event.inputId, {
            boxes: data.boxes!,
            frameW: data.frameW!,
            frameH: data.frameH!,
          });
        } else {
          store.setBuildingBoxes(event.inputId, null);
        }
      };

      if (holdMs > 0) {
        setTimeout(applyOverlay, holdMs);
      } else {
        applyOverlay();
      }
    };
    void this.aiController.wireSidecarListeners(
      BUILDING_DETECTOR_ID,
      onBuildings,
    );

    // Car Ads: vehicle + wheel detection → ad glued to the car side via the
    // corner-pin homography. Same delay-sync as the people boxes; the tracker
    // gives each car a stable id and smooths/holds its quad across responses.
    const onCarAds = (event: ModelResultEvent) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as {
        cars?: CarAdDetection[];
        frameW?: number;
        frameH?: number;
        procMs?: number;
      };

      const outputDelayMs = input.registeredSideChannelDelayMs ?? 0;
      const procMs = typeof data.procMs === 'number' ? data.procMs : 0;
      const holdMs = Math.max(0, outputDelayMs - procMs);

      const applyOverlay = () => {
        const store = this.output.store.getState();
        const cfg = input.aiModels?.[CAR_ADS_ID];
        const hasFrame =
          Array.isArray(data.cars) &&
          typeof data.frameW === 'number' &&
          typeof data.frameH === 'number';
        const ads = Boolean(cfg?.enabled && cfg?.ghostMode);
        const show = Boolean(
          cfg?.enabled && (cfg?.drawBoxes || ads) && hasFrame,
        );
        if (show) {
          // Feed every response (even empty ones) through the tracker so cars
          // keep a stable identity and survive brief detection dropouts.
          let tracker = this.carAdTrackers.get(event.inputId);
          if (!tracker) {
            tracker = new CarTracker();
            this.carAdTrackers.set(event.inputId, tracker);
          }
          const tracked = tracker.update(data.cars!, Date.now());
          const adOpacity = Number(cfg?.params?.adOpacity);
          store.setCarAdBoxes(
            event.inputId,
            tracked.length > 0
              ? {
                  cars: tracked,
                  frameW: data.frameW!,
                  frameH: data.frameH!,
                  ads,
                  ...(Number.isFinite(adOpacity) ? { adOpacity } : {}),
                }
              : null,
          );
        } else {
          this.carAdTrackers.delete(event.inputId);
          store.setCarAdBoxes(event.inputId, null);
        }
      };

      if (holdMs > 0) {
        setTimeout(applyOverlay, holdMs);
      } else {
        applyOverlay();
      }
    };
    void this.aiController.wireSidecarListeners(CAR_ADS_ID, onCarAds);

    // Car Hue: top-down vehicle boxes → per-car hue recolor via the car-hue
    // shader. Same worker as car-ads in 'topdown' mode (boxes only, no wheels),
    // same delay-sync; the person tracker gives each car a stable id so its
    // color assignment (hue + per-car spread) doesn't flicker between cars.
    const onCarHue = (event: ModelResultEvent) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as {
        cars?: { box: { x: number; y: number; w: number; h: number } }[];
        frameW?: number;
        frameH?: number;
        procMs?: number;
      };

      const outputDelayMs = input.registeredSideChannelDelayMs ?? 0;
      const procMs = typeof data.procMs === 'number' ? data.procMs : 0;
      const holdMs = Math.max(0, outputDelayMs - procMs);

      const applyOverlay = () => {
        const store = this.output.store.getState();
        const cfg = input.aiModels?.[CAR_HUE_ID];
        const hasFrame =
          Array.isArray(data.cars) &&
          typeof data.frameW === 'number' &&
          typeof data.frameH === 'number';
        const effect = Boolean(cfg?.enabled && cfg?.ghostMode);
        const show = Boolean(
          cfg?.enabled && (cfg?.drawBoxes || effect) && hasFrame,
        );
        if (show) {
          let tracker = this.carHueTrackers.get(event.inputId);
          if (!tracker) {
            // Short miss budget: a lost car drops its box after 2 unmatched
            // responses — top-down cars leave the frame fast, so a held box
            // quickly points at empty road. No server-side lead — CarHueWrapper
            // dead-reckons between responses itself, and leading here would
            // predict motion twice.
            tracker = new PeopleTracker(2, false);
            this.carHueTrackers.set(event.inputId, tracker);
          }
          const tracked = tracker.update(
            data.cars!.map((c) => c.box),
            Date.now(),
          );
          const num = (v: unknown) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
          };
          store.setCarHueBoxes(
            event.inputId,
            tracked.length > 0
              ? {
                  boxes: tracked,
                  frameW: data.frameW!,
                  frameH: data.frameH!,
                  effect,
                  hue: num(cfg?.params?.hue),
                  spread: num(cfg?.params?.spread),
                  strength: num(cfg?.params?.strength),
                  satBoost: num(cfg?.params?.satBoost),
                  whiteBoost: num(cfg?.params?.whiteBoost),
                }
              : null,
          );
        } else {
          this.carHueTrackers.delete(event.inputId);
          store.setCarHueBoxes(event.inputId, null);
        }
      };

      if (holdMs > 0) {
        setTimeout(applyOverlay, holdMs);
      } else {
        applyOverlay();
      }
    };
    void this.aiController.wireSidecarListeners(CAR_HUE_ID, onCarHue);

    // Kettlebell Coach: pose skeleton + bell box + reps/verdict badge on the
    // output, plus debounced rep/exercise events on the room bus. Events go to
    // the controller IMMEDIATELY (dashboards and triggers should be live);
    // only the drawn overlay is held to the delayed output like the others.
    const onKettlebell = (event: ModelResultEvent) => {
      const input = this.inputManager
        .getInputs()
        .find((i) => i.inputId === event.inputId);
      if (!input) return;
      const data = event.data as {
        pose?: { kpts?: [number, number, number][] } | null;
        kb?: {
          x: number;
          y: number;
          w: number;
          h: number;
          conf?: number;
        } | null;
        exercise?: 'swing' | 'clean' | 'snatch' | 'idle';
        repCount?: number;
        lastRep?: { verdict?: string; issues?: string[] } | null;
        frameW?: number;
        frameH?: number;
        procMs?: number;
        fullBody?: boolean;
        session?: string;
      };

      this.kettlebellController.handleResult(
        event.inputId,
        data as KettlebellResultData,
      );
      // Live pose visibility for the tournament's intro framing check — the
      // debounced coach events carry no pose, so tap the raw result here.
      this.kbTournament.onPoseSample(
        event.inputId,
        !!data.pose?.kpts && data.pose.kpts.length > 0,
        data.fullBody !== false,
      );

      const outputDelayMs = input.registeredSideChannelDelayMs ?? 0;
      const procMs = typeof data.procMs === 'number' ? data.procMs : 0;
      const holdMs = Math.max(0, outputDelayMs - procMs);

      const applyOverlay = () => {
        const store = this.output.store.getState();
        const cfg = input.aiModels?.[KETTLEBELL_COACH_ID];
        const hasFrame =
          typeof data.frameW === 'number' && typeof data.frameH === 'number';
        if (cfg?.enabled && hasFrame) {
          store.setKettlebell(event.inputId, {
            kpts: data.pose?.kpts ?? null,
            kb: data.kb ?? null,
            exercise: data.exercise ?? 'idle',
            repCount: typeof data.repCount === 'number' ? data.repCount : 0,
            lastRepVerdict:
              data.lastRep?.verdict === 'correct' ||
              data.lastRep?.verdict === 'incorrect'
                ? data.lastRep.verdict
                : null,
            lastRepIssues: Array.isArray(data.lastRep?.issues)
              ? data.lastRep.issues
              : [],
            frameW: data.frameW!,
            frameH: data.frameH!,
            skeleton: kettlebellSkeletonMode(cfg.params?.skeleton),
            drawBoxes: Boolean(cfg.drawBoxes),
          });
        } else {
          store.setKettlebell(event.inputId, null);
        }
      };

      // Never let this result land before one already scheduled: the overlay
      // must step forward in frame order or the skeleton jumps backwards.
      const now = Date.now();
      const applyAt = Math.max(
        now + holdMs,
        this.kettlebellApplyAt.get(event.inputId) ?? 0,
      );
      this.kettlebellApplyAt.set(event.inputId, applyAt);
      if (applyAt > now) {
        setTimeout(applyOverlay, applyAt - now);
      } else {
        applyOverlay();
      }
    };
    void this.aiController.wireSidecarListeners(
      KETTLEBELL_COACH_ID,
      onKettlebell,
    );
  }

  public async init(): Promise<void> {
    await this.inputManager.initializeInputs(
      this.initInputs,
      this.skipDefaultInputs,
    );
    for (const input of this.inputManager.getInputs()) {
      await this.inputManager.connectInput(input.inputId);
    }
  }

  // ── Room-level property accessors ────────────────────────

  public get pendingDelete(): boolean | undefined {
    return this._pendingDelete;
  }
  public set pendingDelete(value: boolean | undefined) {
    this._pendingDelete = value;
    this.notifyStateChange();
  }

  public get isPublic(): boolean {
    return this._isPublic;
  }
  public set isPublic(value: boolean) {
    this._isPublic = value;
    this.notifyStateChange();
  }

  public get pendingWhipInputs(): PendingWhipInputData[] {
    return this._pendingWhipInputs;
  }
  public set pendingWhipInputs(value: PendingWhipInputData[]) {
    this._pendingWhipInputs = value;
    this.notifyStateChange();
  }

  // ── Output accessors ──────────────────────────────────────

  public getWhepUrl(): string {
    return this.output.url;
  }

  public getResolution(): { width: number; height: number } {
    return this.output.resolution;
  }

  // ── State snapshot ────────────────────────────────────────

  public getState(): RoomSnapshot {
    this.lastReadTimestamp = Date.now();
    return {
      inputs: this.inputManager.getInputs(),
      layers: this.layers,
      swapDurationMs: this.swapDurationMs,
      swapOutgoingEnabled: this.swapOutgoingEnabled,
      swapFadeInDurationMs: this.swapFadeInDurationMs,
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
      sortMode: this.sortMode,
      outputShaders: this.getOutputShaders(),
      broadcastTiles: [...this.broadcastTiles],
      selectedBroadcastTileId: this.selectedBroadcastTileId,
      isBroadcastMode: this.isBroadcastMode,
      viewportTop: this.viewportTop,
      viewportLeft: this.viewportLeft,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportTransitionDurationMs: this.viewportTransitionDurationMs,
      viewportTransitionEasing: this.viewportTransitionEasing,
    };
  }

  public getInputs(): RoomInputState[] {
    return this.inputManager.getInputs();
  }

  // ── Recording (delegated) ─────────────────────────────────

  public hasActiveRecording(): boolean {
    return this.recordingController.hasActiveRecording();
  }

  public async startRecording(): Promise<{ fileName: string }> {
    const result = await this.mutex.runExclusive(() =>
      this.recordingController.startRecording(),
    );
    // On failure the throw above skips this — state didn't change.
    this.kbTournament.notifyRecordingChanged();
    return result;
  }

  public async stopRecording(): Promise<{ fileName: string }> {
    const result = await this.mutex.runExclusive(() =>
      this.recordingController.stopRecording(),
    );
    this.kbTournament.notifyRecordingChanged();
    return result;
  }

  // ── Room settings ─────────────────────────────────────────

  public getSwapDurationMs(): number {
    return this.swapDurationMs;
  }
  public setSwapDurationMs(value: number) {
    this.swapDurationMs = value;
    this.updateStoreWithState();
  }

  public getSwapOutgoingEnabled(): boolean {
    return this.swapOutgoingEnabled;
  }
  public setSwapOutgoingEnabled(value: boolean) {
    this.swapOutgoingEnabled = value;
    this.updateStoreWithState();
  }

  public getSwapFadeInDurationMs(): number {
    return this.swapFadeInDurationMs;
  }
  public setSwapFadeInDurationMs(value: number) {
    this.swapFadeInDurationMs = value;
    this.updateStoreWithState();
  }

  public getSwapFadeOutDurationMs(): number {
    return this.swapFadeOutDurationMs;
  }
  public setSwapFadeOutDurationMs(value: number) {
    this.swapFadeOutDurationMs = value;
    this.updateStoreWithState();
  }

  public getSortMode(): 'timeline' | 'layers' {
    return this.sortMode;
  }
  public setSortMode(value: 'timeline' | 'layers') {
    this.sortMode = value;
    this.updateStoreWithState();
  }

  public setViewport(
    opts: Partial<import('../types').ViewportProperties>,
  ): void {
    if (opts.viewportTop !== undefined) this.viewportTop = opts.viewportTop;
    if (opts.viewportLeft !== undefined) this.viewportLeft = opts.viewportLeft;
    if (opts.viewportWidth !== undefined)
      this.viewportWidth = opts.viewportWidth;
    if (opts.viewportHeight !== undefined)
      this.viewportHeight = opts.viewportHeight;
    if (opts.viewportTransitionDurationMs !== undefined)
      this.viewportTransitionDurationMs = opts.viewportTransitionDurationMs;
    if (opts.viewportTransitionEasing !== undefined)
      this.viewportTransitionEasing = opts.viewportTransitionEasing;
    this.updateStoreWithState();
  }

  public resetViewport(): void {
    this.viewportTop = undefined;
    this.viewportLeft = undefined;
    this.viewportWidth = undefined;
    this.viewportHeight = undefined;
    this.viewportTransitionDurationMs = undefined;
    this.viewportTransitionEasing = undefined;
    this.updateStoreWithState();
  }

  public async updateLayers(layers: Layer[]) {
    return this.mutex.runExclusive(async () => {
      this.setLayersAndSyncInputState(layers);

      // Apply store + behavior layouts immediately (do not debounce: callers expect
      // this.layers to match computeLayout right after updateLayers returns).
      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;
      this.flushStoreUpdate(false, true);
    });
  }

  /**
   * Restore layers from a timeline snapshot without auto-appending unplaced
   * inputs or re-tiling manual layers with the equal-grid helper.
   */
  public async restoreLayers(layers: Layer[]) {
    return this.mutex.runExclusive(async () => {
      this.setLayersAndSyncInputState(layers);

      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;
      this.flushStoreUpdate(true);
    });
  }

  /**
   * Build BehaviorInputInfo[] from the current connected, non-hidden inputs
   * for use with computeLayout().
   */
  private collectBehaviorInputInfos(): BehaviorInputInfo[] {
    const allInputs = this.inputManager.getInputs();
    const attachedIds = new Set<string>();
    for (const inp of allInputs) {
      if (inp.status === 'connected' && !inp.hidden && inp.attachedInputIds) {
        for (const id of inp.attachedInputIds) {
          attachedIds.add(id);
        }
      }
    }
    return allInputs
      .filter(
        (inp) =>
          inp.status === 'connected' &&
          !inp.hidden &&
          !attachedIds.has(inp.inputId),
      )
      .map((inp) => ({
        inputId: inp.inputId,
        nativeWidth: inp.nativeWidth,
        nativeHeight: inp.nativeHeight,
      }));
  }

  // ── Input operations (mutex-wrapped delegation) ───────────

  public async addNewInput(opts: RegisterInputOptions) {
    return this.mutex.runExclusive(async () => {
      return await this.inputManager.addNewInput(opts);
    });
  }

  public async removeInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.removeInput(inputId);

      if (this.pruneInputFromLayers(inputId)) {
        this.updateStoreWithState();
      }
    });
  }

  /** Drop an input from every layer. Lock-free — call under the mutex. */
  private pruneInputFromLayers(inputId: string): boolean {
    let layersUpdated = false;
    this.layers = this.layers.map((layer) => {
      const filteredInputs = layer.inputs.filter(
        (input) => input.inputId !== inputId,
      );
      if (filteredInputs.length === layer.inputs.length) {
        return layer;
      }

      layersUpdated = true;
      return {
        ...layer,
        inputs: filteredInputs,
      };
    });
    return layersUpdated;
  }

  public async connectInput(inputId: string): Promise<string> {
    return this.mutex.runExclusive(() =>
      this.inputManager.connectInput(inputId),
    );
  }

  public async resolveMissingLocalMp4Asset(
    inputId: string,
    opts: { fileName?: string; audioFileName?: string },
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.resolveMissingLocalMp4Asset(inputId, opts);
    });
  }

  public async resolveMissingImageAsset(
    inputId: string,
    opts: { fileName: string },
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.resolveMissingImageAsset(inputId, opts);
    });
  }

  public async disconnectInput(inputId: string) {
    return this.mutex.runExclusive(() =>
      this.inputManager.disconnectInput(inputId),
    );
  }

  public async updateInput(
    inputId: string,
    options: Partial<UpdateInputOptions>,
  ) {
    return this.mutex.runExclusive(async () => {
      // Sync: mirror absolute position, transition, and crop changes to all
      // matching layer inputs so the rendering pipeline (App.tsx reads from
      // LayerInput) stays consistent with input state.
      const hasLayerPatch =
        options.absoluteLeft !== undefined ||
        options.absoluteTop !== undefined ||
        options.absoluteWidth !== undefined ||
        options.absoluteHeight !== undefined ||
        options.absoluteTransitionDurationMs !== undefined ||
        options.absoluteTransitionEasing !== undefined ||
        options.cropTop !== undefined ||
        options.cropLeft !== undefined ||
        options.cropRight !== undefined ||
        options.cropBottom !== undefined;
      if (hasLayerPatch) {
        // `null` resets the corresponding field on LayerInput to `undefined`
        // to stay consistent with InputManager.updateInput (absolute/crop
        // reset semantics). LayerInput declares `x`/`y`/`width`/`height` as
        // required `number`s, so we widen via a Record cast when clearing
        // them — Phase 2 of timeline restoreState replaces all layers, so
        // this transient undefined state is bounded to the restore window.
        for (const layer of this.layers) {
          for (const li of layer.inputs) {
            if (li.inputId !== inputId) continue;
            const liRecord = li as Record<string, unknown>;
            if (options.absoluteLeft !== undefined)
              liRecord.x =
                options.absoluteLeft === null
                  ? undefined
                  : options.absoluteLeft;
            if (options.absoluteTop !== undefined)
              liRecord.y =
                options.absoluteTop === null ? undefined : options.absoluteTop;
            if (options.absoluteWidth !== undefined)
              liRecord.width =
                options.absoluteWidth === null
                  ? undefined
                  : options.absoluteWidth;
            if (options.absoluteHeight !== undefined)
              liRecord.height =
                options.absoluteHeight === null
                  ? undefined
                  : options.absoluteHeight;
            if (options.absoluteTransitionDurationMs !== undefined)
              li.transitionDurationMs =
                options.absoluteTransitionDurationMs === null
                  ? undefined
                  : options.absoluteTransitionDurationMs;
            if (options.absoluteTransitionEasing !== undefined)
              li.transitionEasing =
                options.absoluteTransitionEasing === null
                  ? undefined
                  : options.absoluteTransitionEasing;
            if (options.cropTop !== undefined)
              li.cropTop =
                options.cropTop === null ? undefined : options.cropTop;
            if (options.cropLeft !== undefined)
              li.cropLeft =
                options.cropLeft === null ? undefined : options.cropLeft;
            if (options.cropRight !== undefined)
              li.cropRight =
                options.cropRight === null ? undefined : options.cropRight;
            if (options.cropBottom !== undefined)
              li.cropBottom =
                options.cropBottom === null ? undefined : options.cropBottom;
          }
        }
      }
      const { transcription, ...rest } = options;
      if (transcription !== undefined) {
        const input = this.inputManager.getInput(inputId);
        if (input.transcription !== transcription) {
          input.transcription = transcription;
          if (input.type === 'whip') {
            input.volume = transcription ? 1 : 0;
          }
          const wasConnected = input.status === 'connected';
          if (wasConnected && supportsTranscription(input.type)) {
            await this.captionsController.setTranscriptionPull(input, false);
            getCaptionBridge()?.notifySideChannelStopped(inputId);
            await this.inputManager.disconnectInput(inputId);
            await this.inputManager.connectInput(inputId);
          }
        }
      }
      this.inputManager.updateInput(inputId, rest);
      this.updateStoreWithState();
    });
  }

  public reorderInputs(inputOrder: string[]) {
    return this.mutex.runExclusive(() => {
      this.inputManager.reorderInputs(inputOrder);

      const orderIndex = new Map(inputOrder.map((id, idx) => [id, idx]));
      for (const layer of this.layers) {
        // For both manual and behavior layers, sort inputs by the requested
        // order. Each LayerInput carries its own position, so a plain sort
        // preserves per-input geometry (no slot-position reassignment).
        layer.inputs.sort((a, b) => {
          const ai = orderIndex.get(a.inputId) ?? Number.MAX_SAFE_INTEGER;
          const bi = orderIndex.get(b.inputId) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
      }
    });
  }

  // ── Broadcast tiles ───────────────────────────────────────

  public async addBroadcastTile(
    type: 'input' | 'layer',
    targetId: string,
  ): Promise<BroadcastTile | null> {
    return this.mutex.runExclusive(() => {
      const alreadyExists = this.broadcastTiles.some(
        (t) => t.type === type && t.targetId === targetId,
      );
      if (alreadyExists) return null;

      const inputs = this.inputManager.getInputs();
      if (type === 'input') {
        if (!inputs.some((i) => i.inputId === targetId)) return null;
      } else {
        if (!this.layers.some((l) => l.id === targetId)) return null;
      }

      const name =
        type === 'input'
          ? (inputs.find((i) => i.inputId === targetId)?.metadata.title ??
            targetId)
          : targetId;

      const tile: BroadcastTile = { id: randomUUID(), type, targetId, name };
      this.broadcastTiles.push(tile);
      let selectionChanged = false;
      if (this.selectedBroadcastTileId === null) {
        this.selectedBroadcastTileId = tile.id;
        selectionChanged = true;
      }
      if (this.isBroadcastMode || selectionChanged) this.updateStoreWithState();
      return tile;
    });
  }

  public async removeBroadcastTile(tileId: string): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      const idx = this.broadcastTiles.findIndex((t) => t.id === tileId);
      if (idx === -1) return false;
      this.broadcastTiles.splice(idx, 1);
      let selectionChanged = false;
      if (this.selectedBroadcastTileId === tileId) {
        this.selectedBroadcastTileId = null;
        selectionChanged = true;
      }
      if (this.isBroadcastMode || selectionChanged) this.updateStoreWithState();
      return true;
    });
  }

  public async selectBroadcastTile(tileId: string | null): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      if (
        tileId !== null &&
        !this.broadcastTiles.some((t) => t.id === tileId)
      ) {
        return false;
      }
      this.selectedBroadcastTileId = tileId;
      this.updateStoreWithState();
      return true;
    });
  }

  public async setBroadcastMode(enabled: boolean): Promise<void> {
    return this.mutex.runExclusive(() => {
      if (this.isBroadcastMode === enabled) return;
      this.isBroadcastMode = enabled;
      this.updateStoreWithState();
    });
  }

  public async renameBroadcastTile(
    tileId: string,
    name: string,
  ): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      const tile = this.broadcastTiles.find((t) => t.id === tileId);
      if (!tile) return false;
      if (tile.name === name) return true;
      tile.name = name;
      this.updateStoreWithState();
      return true;
    });
  }

  public async clearBroadcastTiles(): Promise<void> {
    return this.mutex.runExclusive(() => {
      const hadAny =
        this.broadcastTiles.length > 0 ||
        this.selectedBroadcastTileId !== null ||
        this.isBroadcastMode;
      this.broadcastTiles = [];
      this.selectedBroadcastTileId = null;
      this.isBroadcastMode = false;
      if (hadAny) this.updateStoreWithState();
    });
  }

  public getIsBroadcastMode(): boolean {
    return this.isBroadcastMode;
  }

  public getBroadcastTiles(): {
    tiles: BroadcastTile[];
    selectedBroadcastTileId: string | null;
    isBroadcastMode: boolean;
  } {
    return {
      tiles: [...this.broadcastTiles],
      selectedBroadcastTileId: this.selectedBroadcastTileId,
      isBroadcastMode: this.isBroadcastMode,
    };
  }

  public hideInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      this.inputManager.hideInput(inputId, activeTransition);
    });
  }

  public showInput(
    inputId: string,
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      this.inputManager.showInput(inputId, activeTransition);
    });
  }

  public batchHideInputs(
    inputIds: string[],
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      // Hide all inputs under a single lock
      for (const inputId of inputIds) {
        this.inputManager.hideInput(inputId, activeTransition);
      }
    });
  }

  public batchShowInputs(
    inputIds: string[],
    activeTransition?: {
      type: string;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) {
    return this.mutex.runExclusive(() => {
      // Show all inputs under a single lock
      for (const inputId of inputIds) {
        this.inputManager.showInput(inputId, activeTransition);
      }
    });
  }

  public async ackWhipInput(inputId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.inputManager.ackWhipInput(inputId);
    });
  }

  public async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
    const removed = await this.mutex.runExclusive(async () => {
      const ids = await this.inputManager.removeStaleWhipInputs(staleTtlMs);
      let layersUpdated = false;
      for (const id of ids) {
        layersUpdated = this.pruneInputFromLayers(id) || layersUpdated;
      }
      if (layersUpdated) {
        this.updateStoreWithState();
      }
      return ids;
    });
    // Outside the mutex: the controller's restage re-enters updateLayers,
    // and async-mutex is non-reentrant.
    if (removed.length > 0) {
      this.kbTournament.onInputsRemoved(removed);
    }
  }

  /** Route a Ghost Shooter WebSocket message from a phone client. */
  public handleShooterMessage(clientId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as {
      type?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
    };
    switch (msg.type) {
      case 'shoot_join':
        this.duckHunter.join(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Player',
        );
        break;
      case 'shoot_aim':
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
          this.duckHunter.aim(clientId, msg.x, msg.y);
        }
        break;
      case 'shoot_fire':
        this.duckHunter.fire(clientId);
        break;
      case 'shoot_leave':
        this.duckHunter.leave(clientId);
        break;
      case 'shoot_cam_start':
        void this.duckHunter.startCamera(clientId);
        break;
      case 'shoot_cam_stop':
        this.duckHunter.stopCamera(clientId);
        break;
      case 'shoot_spectate':
        // Arcade page observer: snapshot reply only, never creates a player.
        this.duckHunter.spectate(clientId);
        break;
      default:
        break;
    }
  }

  /** Drive the arcade match (start/stop/reset) from the /duck-hunter page. */
  public controlDuckHunterMatch(cmd: MatchCommand): ShooterMatchEvent {
    return this.duckHunter.controlMatch(cmd);
  }

  /** Current arcade match snapshot (page-reload recovery). */
  public getDuckHunterMatch(): ShooterMatchEvent {
    return this.duckHunter.getMatchSnapshot();
  }

  /** A phone client disconnected — drop its crosshair/score. */
  public handleShooterDisconnect(clientId: string): void {
    this.duckHunter.handleDisconnect(clientId);
  }

  // ── Kettlebell Tournament (thin delegates, like Duck Hunter above) ──

  public handleKbtMessage(clientId: string, raw: unknown): void {
    this.kbTournament.handleMessage(clientId, raw);
  }

  public handleKbtDisconnect(clientId: string): void {
    this.kbTournament.handleDisconnect(clientId);
  }

  public controlKbtMatch(cmd: KbtMatchCommand): {
    state: KbtStateEvent;
    match: KbtMatchEvent;
    error?: KbtMatchError;
  } {
    return this.kbTournament.controlMatch(cmd);
  }

  public getKbtState(): { state: KbtStateEvent; match: KbtMatchEvent } {
    return {
      state: this.kbTournament.stateSnapshot(),
      match: this.kbTournament.getMatchSnapshot(),
    };
  }

  /**
   * Store an uploaded profile photo (already re-encoded to JPEG by the phone)
   * and attach it to the player with this name. The file name embeds a content
   * hash — the URL changes with the photo, so web caches can be immutable and
   * the engine image id (minted from the same hash) never mutates.
   * Returns null when no such player has joined (route replies 404).
   */
  public async setKbtPlayerPhoto(
    name: string,
    jpeg: Buffer,
    playerKey?: string,
  ): Promise<{ photoUrl: string } | null> {
    const hash = createHash('sha1').update(jpeg).digest('hex').slice(0, 8);
    const safeRoom = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(DATA_DIR, 'kbt-photos');
    await ensureDir(dir);
    const fileName = `${safeRoom}-${hash}.jpg`;
    const photoPath = path.join(dir, fileName);
    await writeFile(photoPath, jpeg);
    const photoUrl = `/kbt-photos/${fileName}`;
    const attached = this.kbTournament.setPlayerPhoto(
      name,
      {
        photoUrl,
        photoPath,
        photoHash: hash,
      },
      playerKey,
    );
    if (!attached) {
      await remove(photoPath).catch(() => {});
      return null;
    }
    return { photoUrl };
  }

  public setKbtConfig(cfg: {
    scoring?: Partial<
      Record<KbtExerciseKey, Partial<{ enabled: boolean; points: number }>>
    >;
    strictTechnique?: boolean;
    heatDurationMs?: number;
    heatSize?: number;
    cameraView?: 'front' | 'side';
    repScreenshots?: boolean;
    milestoneFx?: boolean;
    repFloatText?: boolean;
    countIncorrectReps?: boolean;
    joinUrl?: string;
    joinLabel?: string;
  }): KbtConfig {
    return this.kbTournament.setConfig(cfg);
  }

  /**
   * Dev-only (KBT_SIM=1): register a looping local-mp4 (from data/mp4s) as a
   * player's camera. The mp4 input gets the same video side channel a WHIP cam
   * would, so the coach model scores real decoded frames — no phone needed.
   */
  public async attachKbtMp4Cam(
    clientId: string,
    fileName: string,
  ): Promise<{ inputId: string }> {
    const inputId = await this.addNewInput({
      type: 'local-mp4',
      source: { fileName },
    });
    if (!inputId) throw new Error('Failed to register local-mp4 input');
    await this.connectInput(inputId);
    // A missing file becomes a placeholder input (mp4AssetMissing) rather than
    // a registration error — detect it and surface a real failure.
    const input = this.inputManager
      .getInputs()
      .find((i) => i.inputId === inputId);
    if (
      !input ||
      input.type !== 'local-mp4' ||
      input.mp4AssetMissing ||
      input.status !== 'connected'
    ) {
      await this.removeInput(inputId).catch(() => {});
      throw new Error(`MP4 not found under data/mp4s: ${fileName}`);
    }
    const dims =
      input.mp4VideoWidth && input.mp4VideoHeight
        ? { width: input.mp4VideoWidth, height: input.mp4VideoHeight }
        : undefined;
    if (!this.kbTournament.attachExternalCam(clientId, inputId, dims)) {
      await this.removeInput(inputId).catch(() => {});
      throw new Error(`Unknown player clientId: ${clientId}`);
    }
    return { inputId };
  }

  /** Dev-only (KBT_SIM=1): fabricate a scored rep for UI work sans model. */
  public simulateKbtRep(
    clientId: string,
    exercise: KettlebellExercise,
    verdict: 'correct' | 'incorrect',
  ): boolean {
    return this.kbTournament.simulateRep(clientId, exercise, verdict);
  }

  /**
   * Room-wide duck-size multiplier from the Duck Hunter panel. Injected into
   * each bird `peopleBoxes` push so PacmanBirdsInput scales its sprites live.
   */
  private duckScale = 1;
  /** How long a duck holds before flying off (ms), and its fly speed (fraction
   * of the larger screen edge per second). Injected into each bird push. */
  private duckPauseMs = 700;
  private duckFlySpeed = 0.9;

  /** Set the room-wide Duck Hunter config (ammo + duck size/flight) from the panel. */
  public setDuckHunterConfig(cfg: {
    maxAmmo?: number;
    reloadMs?: number;
    duckScale?: number;
    duckPauseMs?: number;
    duckFlySpeed?: number;
  }): {
    maxAmmo: number;
    reloadMs: number;
    duckScale: number;
    duckPauseMs: number;
    duckFlySpeed: number;
  } {
    this.duckHunter.setRoomConfig(cfg);
    if (typeof cfg.duckScale === 'number' && Number.isFinite(cfg.duckScale)) {
      this.duckScale = Math.max(0.25, Math.min(3, cfg.duckScale));
    }
    if (
      typeof cfg.duckPauseMs === 'number' &&
      Number.isFinite(cfg.duckPauseMs)
    ) {
      this.duckPauseMs = Math.max(0, Math.min(10000, cfg.duckPauseMs));
    }
    if (
      typeof cfg.duckFlySpeed === 'number' &&
      Number.isFinite(cfg.duckFlySpeed)
    ) {
      this.duckFlySpeed = Math.max(0.05, Math.min(3, cfg.duckFlySpeed));
    }
    return {
      ...this.duckHunter.getRoomConfig(),
      duckScale: this.duckScale,
      duckPauseMs: this.duckPauseMs,
      duckFlySpeed: this.duckFlySpeed,
    };
  }

  /**
   * Room-wide haunting-ghosts config from the Haunter panel. Injected into each
   * people `peopleBoxes` push (when the Ghost style is 'haunter') so
   * HaunterGhostsInput picks changes up live. Bounds mirror the panel sliders.
   */
  private haunterCount = DEFAULT_HAUNTER_COUNT;
  private haunterDist = DEFAULT_HAUNTER_DIST;
  private haunterScale = DEFAULT_HAUNTER_SCALE;
  private haunterSpeed = DEFAULT_HAUNTER_SPEED;

  /** Set the room-wide haunting-ghosts config (pool size, attach range, sprite size, follow speed). */
  public setHaunterConfig(cfg: {
    haunterCount?: number;
    haunterDist?: number;
    haunterScale?: number;
    haunterSpeed?: number;
  }): {
    haunterCount: number;
    haunterDist: number;
    haunterScale: number;
    haunterSpeed: number;
  } {
    if (
      typeof cfg.haunterCount === 'number' &&
      Number.isFinite(cfg.haunterCount)
    ) {
      this.haunterCount = Math.round(
        Math.max(1, Math.min(MAX_HAUNTERS, cfg.haunterCount)),
      );
    }
    if (
      typeof cfg.haunterDist === 'number' &&
      Number.isFinite(cfg.haunterDist)
    ) {
      this.haunterDist = Math.max(0.1, Math.min(1, cfg.haunterDist));
    }
    if (
      typeof cfg.haunterScale === 'number' &&
      Number.isFinite(cfg.haunterScale)
    ) {
      this.haunterScale = Math.max(0.25, Math.min(3, cfg.haunterScale));
    }
    if (
      typeof cfg.haunterSpeed === 'number' &&
      Number.isFinite(cfg.haunterSpeed)
    ) {
      this.haunterSpeed = Math.max(0.25, Math.min(3, cfg.haunterSpeed));
    }
    return {
      haunterCount: this.haunterCount,
      haunterDist: this.haunterDist,
      haunterScale: this.haunterScale,
      haunterSpeed: this.haunterSpeed,
    };
  }

  public async restartMp4Input(
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.inputManager.restartMp4Input(inputId, playFromMs, loop);
    });
  }

  // ── Motion (delegated) ────────────────────────────────────

  public async setMotionEnabled(
    inputId: string,
    enabled: boolean,
  ): Promise<void> {
    return this.setAIModelEnabled(inputId, 'motion', enabled);
  }

  public async setAIModelEnabled(
    inputId: string,
    modelId: string,
    enabled: boolean,
    delayMs?: number,
    drawBoxes?: boolean,
    params?: Record<string, number | string>,
    ghostMode?: boolean,
    eraseMarkers?: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.inputManager.getInput(inputId);
      const manifest = ModelRegistry.get(modelId);
      if (!manifest) {
        throw new Error(`Unknown AI model: ${modelId}`);
      }
      if (!manifestSupportsInput(manifest, input)) {
        throw new Error(
          `Model ${modelId} does not support input type ${input.type}`,
        );
      }

      if (!input.aiModels) {
        input.aiModels = {};
      }

      const current = input.aiModels[modelId] ?? defaultAIModelConfig(manifest);
      const newDelay =
        delayMs !== undefined
          ? Math.min(Math.max(0, delayMs), manifest.maxDelayMs)
          : current.delayMs;
      const newDrawBoxes =
        drawBoxes !== undefined ? drawBoxes : current.drawBoxes;
      const newGhostMode =
        ghostMode !== undefined ? ghostMode : current.ghostMode;
      const newEraseMarkers =
        eraseMarkers !== undefined ? eraseMarkers : current.eraseMarkers;
      const newParams = params !== undefined ? params : current.params;
      const paramsChanged =
        JSON.stringify(current.params ?? {}) !==
        JSON.stringify(newParams ?? {});

      if (
        current.enabled === enabled &&
        current.delayMs === newDelay &&
        (current.drawBoxes ?? false) === (newDrawBoxes ?? false) &&
        (current.ghostMode ?? false) === (newGhostMode ?? false) &&
        (current.eraseMarkers ?? false) === (newEraseMarkers ?? false) &&
        !paramsChanged
      ) {
        return;
      }

      const oldSideChannel = computeSideChannelConfig(
        input.aiModels,
        input.transcription,
      );

      input.aiModels[modelId] = {
        enabled,
        delayMs: newDelay,
        ...(newDrawBoxes !== undefined ? { drawBoxes: newDrawBoxes } : {}),
        ...(newGhostMode !== undefined ? { ghostMode: newGhostMode } : {}),
        ...(newEraseMarkers !== undefined
          ? { eraseMarkers: newEraseMarkers }
          : {}),
        ...(newParams !== undefined ? { params: newParams } : {}),
      };

      // Keep the erase shader in step with the model it belongs to. Doing this
      // here rather than in the UI means the shader's colour follows the
      // 'Marker color' picker on its own — the two have to key the same colour
      // or the rectangles are erased but not detected, or the other way round.
      syncMarkerEraseShader(input, input.aiModels[modelId], enabled);

      if (modelId === 'motion') {
        input.motionEnabled = enabled;
        if (!enabled) {
          input.motionScore = undefined;
        }
      }

      // Clear any drawn boxes/ghosts when YOLO is disabled or both the
      // box-drawing and ghost overlays are turned off. Reset the tracker too so
      // identities/colors start fresh next time it is turned back on.
      if (
        modelId === PEOPLE_COUNTER_YOLO_ID &&
        (!enabled || (!newDrawBoxes && !newGhostMode))
      ) {
        this.peopleTrackers.delete(inputId);
        this.output.store.getState().setPeopleBoxes(inputId, null);
      }

      // Same for the bird model. Once it is off no further results arrive, so
      // the overlay can only be cleared from here — otherwise the last boxes
      // stay frozen on the output.
      if (
        modelId === PEOPLE_COUNTER_YOLO_BIRDS_ID &&
        (!enabled || (!newDrawBoxes && !newGhostMode))
      ) {
        this.birdTrackers.delete(`yolo:${inputId}`);
        this.birdTrackers.delete(`marker:${inputId}`);
        this.output.store.getState().setPeopleBoxes(inputId, null);
      }

      // Clear the haunted-city overlay when Ghost City is disabled.
      if (modelId === BUILDING_DETECTOR_ID && !enabled) {
        this.output.store.getState().setBuildingBoxes(inputId, null);
      }

      // Clear the coach overlay and its event-debounce state when disabled —
      // no further results arrive, so this is the only place that can.
      if (modelId === KETTLEBELL_COACH_ID && !enabled) {
        this.output.store.getState().setKettlebell(inputId, null);
        this.kettlebellController.reset(inputId);
        this.kettlebellApplyAt.delete(inputId);
      }

      const newSideChannel = computeSideChannelConfig(
        input.aiModels,
        input.transcription,
      );
      const needsReconnect = requiresSideChannelReconnect(
        oldSideChannel,
        newSideChannel,
      );

      if (enabled) {
        await this.aiController.enableModelOnInput(input, modelId);
        // Push tunables to the running worker without a re-subscribe.
        if (paramsChanged && input.status === 'connected') {
          await this.aiController.configureModelOnInput(input, modelId);
        }
      } else {
        await this.aiController.disableModelOnInput(input, modelId);
        if (modelId === 'motion') {
          this.motionController.emitMotionScores();
        }
      }

      const wasConnected = input.status === 'connected';
      const isStreamInput = manifest.supportedInputTypes.includes(input.type);

      if (wasConnected && isStreamInput && needsReconnect) {
        if (input.type === 'whip') {
          // WHIP inputs are always registered with full side channel
          // (video + audio) — reconnecting would kill the live push stream.
          // Just notify the sidecar that the channel is ready.
          if (enabled) {
            this.aiController.onSideChannelReady(inputId);
          }
        } else {
          await this.reconnectInputForSideChannel(inputId);
        }
      }

      this.updateStoreWithState();
    });
  }

  private async reconnectInputForSideChannel(inputId: string): Promise<void> {
    const input = this.inputManager.getInput(inputId);
    if (hasTranscription(input)) {
      await this.captionsController.setTranscriptionPull(input, false);
      getCaptionBridge()?.notifySideChannelStopped(inputId);
    }
    await this.inputManager.disconnectInput(inputId);
    await this.inputManager.connectInput(inputId);
  }

  public addAIModelResultListener(
    modelId: string,
    listener: (data: unknown) => void,
  ): () => void {
    return this.aiController.addResultListener(modelId, listener);
  }

  public async setTranscriptionEnabled(
    inputId: string,
    enabled: boolean,
  ): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const input = this.inputManager.getInput(inputId);
      if (input.transcription === enabled) return;

      input.transcription = enabled;
      if (input.type === 'whip') {
        input.volume = enabled ? 1 : 0;
      }

      const wasConnected = input.status === 'connected';
      const isStreamInput = supportsTranscription(input.type);

      if (wasConnected && isStreamInput) {
        if (input.type === 'whip') {
          // WHIP inputs are always registered with full side channel
          // (video + audio) — reconnecting would kill the live push stream.
          if (enabled) {
            await this.captionsController.setTranscriptionPull(input, true);
            getCaptionBridge()?.notifySideChannelReady(inputId);
          } else {
            await this.captionsController.setTranscriptionPull(input, false);
            getCaptionBridge()?.notifySideChannelStopped(inputId);
          }
        } else {
          await this.reconnectInputForSideChannel(inputId);
        }
      }

      this.updateStoreWithState();
    });
  }

  public async stopAllMotion(): Promise<void> {
    await this.motionController.stopAll();
  }

  public addStateChangeListener(listener: () => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => {
      this.stateChangeListeners.delete(listener);
    };
  }

  public addMotionScoreListener(
    listener: (scores: Record<string, number>) => void,
  ): () => void {
    return this.motionController.addMotionScoreListener(listener);
  }

  // ── Audio analysis (delegated) ──────────────────────────────

  public async setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.audioController.setAudioAnalysisEnabled(enabled);
    });
  }

  public isAudioAnalysisEnabled(): boolean {
    return this.audioController.isEnabled();
  }

  public getAudioStore() {
    return this.audioController.audioStore;
  }

  public addAudioLevelListener(
    listener: (levels: number[]) => void,
  ): () => void {
    return this.audioController.addAudioLevelListener(listener);
  }

  // ── Snake game (delegated) ────────────────────────────────

  public updateSnakeGameState(
    inputId: string,
    incomingState: Parameters<SnakeGameController['updateGameState']>[1],
    events?: { type: SnakeEventType }[],
  ) {
    return this.mutex.runExclusive(() => {
      const input = this.inputManager.getInput(inputId);
      if (input.type !== 'game') {
        throw new Error(`Input ${inputId} is not a game input`);
      }
      this.snakeGameController.updateGameState(
        input,
        incomingState,
        events,
        () => this.updateStoreWithState(),
      );
    });
  }

  // ── Timeline playback ─────────────────────────────────────

  public isFrozen(): boolean {
    return this.timelinePlayer?.getIsPaused() === true;
  }

  public setOutputShaders(shaders: ShaderConfig[]): void {
    this.output.store.getState().setOutputShaders(shaders);
  }

  // ── Captions ──────────────────────────────────────────────

  /** True if this room owns the given input id (used to route transcripts). */
  public hasInput(inputId: string): boolean {
    return this.getInputs().some((input) => input.inputId === inputId);
  }

  /** Display a transcript on its input and schedule it to clear after the
   * spoken segment's duration (plus a small linger to avoid flicker). */
  public applyTranscript(event: {
    inputId: string;
    text: string;
    duration: number;
  }): void {
    const input = this.getInputs().find((i) => i.inputId === event.inputId);
    if (!input) {
      console.warn(
        `[captions] applyTranscript: input not found inputId=${event.inputId}`,
      );
      return;
    }
    if (!hasTranscription(input)) {
      console.warn(
        `[captions] applyTranscript: transcription disabled inputId=${event.inputId}`,
      );
      return;
    }

    const prev = this.transcriptClearTimers.get(event.inputId);
    if (prev) clearTimeout(prev);

    this.output.store.getState().setTranscript(event.inputId, event.text);
    console.log(
      `[captions] displayed inputId=${event.inputId} for ${event.duration + SUBTITLE_LINGER_MS}ms text="${event.text}"`,
    );

    const timer = setTimeout(() => {
      this.transcriptClearTimers.delete(event.inputId);
      this.output.store.getState().setTranscript(event.inputId, '');
    }, event.duration + SUBTITLE_LINGER_MS);
    this.transcriptClearTimers.set(event.inputId, timer);
  }

  public getOutputShaders(): ShaderConfig[] {
    return this.output.store.getState().outputShaders;
  }

  private buildTimelineAdapter(): TimelineRoomStateAdapter {
    return {
      getInputs: () => this.getInputs(),
      getLayers: () => this.layers,
      showInput: (inputId, transition) => this.showInput(inputId, transition),
      hideInput: (inputId, transition) => this.hideInput(inputId, transition),
      updateInput: (inputId, options) => this.updateInput(inputId, options),
      updateLayers: (layers) => this.updateLayers(layers),
      restoreLayers: (layers) => this.restoreLayers(layers),
      restartMp4Input: (inputId, playFromMs, loop) =>
        this.restartMp4Input(inputId, playFromMs, loop),
      reorderInputs: (order) => this.reorderInputs(order),
      updateOutputShaders: (shaders) => {
        this.setOutputShaders(shaders);
        return Promise.resolve();
      },
      getOutputShaders: () => this.getOutputShaders(),
    };
  }

  public async startTimelinePlayback(
    config: TimelineConfig,
    fromMs?: number,
  ): Promise<void> {
    if (this.timelinePlayer?.getIsPaused()) {
      this.timelinePlayer.updateConfig(config);
      await this.resumeTimeline(fromMs);
      return;
    }

    if (this.timelinePlayer) {
      this.timelinePlayer.destroy();
    }

    const adapter = this.buildTimelineAdapter();
    this.timelinePlayer = new TimelinePlayer(adapter, config);
    this.timelinePlayer.onPlaybackEnded = () => {
      void this.stopTimelinePlayback().catch((err) =>
        console.error('[timeline] natural-end stop failed', err),
      );
    };

    const forwardListener: TimelineListener = (data) => {
      for (const listener of this.timelineListeners) {
        listener(data);
      }
    };
    this.timelinePlayer.addListener(forwardListener);

    await this.timelinePlayer.start(fromMs);
    this.notifyStateChange();
  }

  public async applyTimelineState(
    config: TimelineConfig,
    playheadMs: number,
  ): Promise<void> {
    if (this.timelinePlayer) {
      this.timelinePlayer.destroy();
    }

    const adapter = this.buildTimelineAdapter();
    this.timelinePlayer = new TimelinePlayer(adapter, config);
    this.timelinePlayer.onPlaybackEnded = () => {
      void this.stopTimelinePlayback().catch((err) =>
        console.error('[timeline] natural-end stop failed', err),
      );
    };

    const forwardListener: TimelineListener = (data) => {
      for (const listener of this.timelineListeners) {
        listener(data);
      }
    };
    this.timelinePlayer.addListener(forwardListener);

    const activeClips =
      await this.timelinePlayer.applyStaticSnapshot(playheadMs);

    this.cleanupFrozenImages();

    const inputs = this.inputManager.getInputs();
    for (const [inputId, clip] of activeClips) {
      const input = inputs.find((i) => i.inputId === inputId);
      if (!input || input.type !== 'local-mp4') continue;
      if (isAudioBackedLocalMp4(input.mp4FilePath)) {
        continue;
      }

      const basePlayFrom = clip.blockSettings.mp4PlayFromMs ?? 0;
      const isLooped = clip.blockSettings.mp4Loop !== false;
      const framePositionMs = normalizeFramePositionMs(
        basePlayFrom + (playheadMs - clip.startMs),
        isLooped,
        input.mp4DurationMs,
      );

      try {
        const jpegPath = await SmelterInstance.extractMp4Frame(
          input.mp4FilePath,
          framePositionMs,
        );
        const frozenId = `frozen::${this.idPrefix}::${inputId}::${Date.now()}`;
        await SmelterInstance.registerImage(frozenId, {
          serverPath: jpegPath,
          assetType: 'jpeg',
        });

        this.setFrozenImage(inputId, frozenId, jpegPath);
        logTimelineEvent(
          this.idPrefix,
          `MP4 FROZEN (scrub) ${input.metadata.title} at ${Math.round(framePositionMs)}ms`,
        );
      } catch (err) {
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Skipping scrub frozen frame for ${inputId} while Smelter is recovering`,
          );
        } else {
          console.error(
            `[timeline] Failed to extract frame for ${inputId} at scrub position`,
            err,
          );
        }
      }
    }
  }

  public async stopTimelinePlayback(): Promise<void> {
    if (!this.timelinePlayer) return;
    this.pausedAttachedInputVolumes.clear();
    this.cleanupFrozenImages();
    this._restoringTimeline = true;
    try {
      await this.timelinePlayer.stop();
    } finally {
      this._restoringTimeline = false;
    }
    this.timelinePlayer.destroy();
    this.timelinePlayer = null;
    this.notifyStateChange();
  }

  public async pauseTimeline(): Promise<{
    playheadMs: number;
    isPaused: true;
  }> {
    if (!this.timelinePlayer || !this.timelinePlayer.isPlaying()) {
      throw new Error('No timeline playback in progress');
    }

    const { playheadMs, activeClips } = this.timelinePlayer.pause();
    const currentPipelineMs = SmelterInstance.getPipelineTimeMs();
    const inputs = this.inputManager.getInputs();
    const inputById = new Map(inputs.map((input) => [input.inputId, input]));
    const activeInputIds = new Set(activeClips.keys());
    const attachedInputIds = this.collectAttachedInputIds(
      activeInputIds,
      inputById,
    );

    this.pausedAttachedInputVolumes.clear();
    for (const attachedInputId of attachedInputIds) {
      if (activeInputIds.has(attachedInputId)) continue;
      const attachedInput = inputById.get(attachedInputId);
      if (!attachedInput) continue;
      this.pausedAttachedInputVolumes.set(
        attachedInputId,
        attachedInput.volume,
      );
      this.inputManager.updateInput(attachedInputId, { volume: 0 });
    }

    for (const [inputId, clip] of activeClips) {
      const input = inputById.get(inputId);
      if (!input) continue;

      // Pause should freeze the soundscape as well as the visuals.
      this.inputManager.updateInput(inputId, { volume: 0 });

      if (input.type !== 'local-mp4') continue;
      if (isAudioBackedLocalMp4(input.mp4FilePath)) {
        continue;
      }
      const isLooped = clip.blockSettings.mp4Loop !== false;
      if (isLooped) {
        continue;
      }

      const framePositionMs = normalizeFramePositionMs(
        (input.playFromMs ?? 0) +
          (currentPipelineMs -
            (input.registeredAtPipelineMs ?? currentPipelineMs)),
        isLooped,
        input.mp4DurationMs,
      );

      try {
        const jpegPath = await SmelterInstance.extractMp4Frame(
          input.mp4FilePath,
          framePositionMs,
        );
        const frozenId = `frozen::${this.idPrefix}::${inputId}::${Date.now()}`;
        await SmelterInstance.registerImage(frozenId, {
          serverPath: jpegPath,
          assetType: 'jpeg',
        });

        this.setFrozenImage(inputId, frozenId, jpegPath);
        logTimelineEvent(
          this.idPrefix,
          `MP4 FROZEN (pause) ${input.metadata.title} at ${Math.round(framePositionMs)}ms`,
        );
      } catch (err) {
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Skipping pause frozen frame for ${inputId} while Smelter is recovering`,
          );
        } else {
          console.error(
            `[timeline] Failed to extract frame for ${inputId}`,
            err,
          );
        }
      }
    }

    this.notifyStateChange();
    return { playheadMs, isPaused: true };
  }

  public async resumeTimeline(fromMs?: number): Promise<void> {
    if (!this.timelinePlayer?.getIsPaused()) {
      throw new Error('Timeline is not paused');
    }

    const resumeMs = fromMs ?? this.timelinePlayer.getPlayheadMs();
    const activeFrozenInputIds = new Set(
      this.timelinePlayer
        .getActiveInputIdsAt(resumeMs)
        .filter((inputId) => this.frozenImages.has(inputId)),
    );

    logTimelineEvent(
      this.idPrefix,
      `RESUME at ${Math.round(resumeMs)}ms (${activeFrozenInputIds.size} frozen MP4s)`,
    );

    await this.timelinePlayer.resume(fromMs);

    for (const [inputId, volume] of this.pausedAttachedInputVolumes) {
      this.inputManager.updateInput(inputId, { volume });
    }
    this.pausedAttachedInputVolumes.clear();

    const inactiveFrozenInputIds = [...this.frozenImages.keys()].filter(
      (inputId) => !activeFrozenInputIds.has(inputId),
    );
    this.cleanupFrozenImages(inactiveFrozenInputIds);

    const inputs = this.inputManager.getInputs();
    for (const inputId of activeFrozenInputIds) {
      const input = inputs.find((i) => i.inputId === inputId);
      logTimelineEvent(
        this.idPrefix,
        `MP4 UNFREEZING ${input?.metadata.title ?? inputId.slice(0, 12)} (fade ${RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS}ms)`,
      );
      this.scheduleFrozenImageCleanup(inputId);
    }

    this.notifyStateChange();
  }

  public async seekTimeline(ms: number): Promise<void> {
    if (!this.timelinePlayer) {
      throw new Error('No timeline playback in progress');
    }
    await this.timelinePlayer.seek(ms);
  }

  public getTimelinePlaybackState(): {
    playheadMs: number;
    isPlaying: boolean;
    isPaused: boolean;
    totalDurationMs: number;
  } {
    if (!this.timelinePlayer) {
      return {
        playheadMs: 0,
        isPlaying: false,
        isPaused: false,
        totalDurationMs: 0,
      };
    }
    return {
      playheadMs: this.timelinePlayer.getPlayheadMs(),
      isPlaying: this.timelinePlayer.isPlaying(),
      isPaused: this.timelinePlayer.getIsPaused(),
      totalDurationMs: this.timelinePlayer.getTotalDurationMs(),
    };
  }

  public getTimelineActiveInputIds(): string[] {
    if (!this.timelinePlayer) return [];
    return this.timelinePlayer.getActiveInputIdsAt(
      this.timelinePlayer.getPlayheadMs(),
    );
  }

  public getFrozenFrameInputIds(): ReadonlySet<string> {
    return new Set(this.frozenImages.keys());
  }

  public addTimelineListener(listener: TimelineListener): () => void {
    this.timelineListeners.add(listener);
    return () => {
      this.timelineListeners.delete(listener);
    };
  }

  private collectAttachedInputIds(
    rootInputIds: Iterable<string>,
    inputById: Map<string, RoomInputState>,
  ): Set<string> {
    const visited = new Set<string>();
    const queue = [...new Set(rootInputIds)];

    while (queue.length > 0) {
      const inputId = queue.shift()!;
      if (visited.has(inputId)) continue;
      visited.add(inputId);
      const input = inputById.get(inputId);
      const attachedInputIds = input?.attachedInputIds ?? [];
      for (const attachedInputId of attachedInputIds) {
        if (!visited.has(attachedInputId)) {
          queue.push(attachedInputId);
        }
      }
    }

    return visited;
  }

  // ── Frozen image management ───────────────────────────────

  private clearFrozenImageCleanupTimer(inputId: string): void {
    const timer = this.frozenImageCleanupTimers.get(inputId);
    if (!timer) return;
    clearTimeout(timer);
    this.frozenImageCleanupTimers.delete(inputId);
  }

  private clearAllFrozenImageCleanupTimers(): void {
    for (const timer of this.frozenImageCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.frozenImageCleanupTimers.clear();
  }

  private scheduleFrozenImageCleanup(
    inputId: string,
    delayMs = RESUME_FROZEN_IMAGE_CLEANUP_DELAY_MS,
  ): void {
    if (!this.frozenImages.has(inputId)) {
      this.clearFrozenImageCleanupTimer(inputId);
      return;
    }

    this.clearFrozenImageCleanupTimer(inputId);
    const timer = setTimeout(() => {
      this.frozenImageCleanupTimers.delete(inputId);
      void this.mutex.runExclusive(() => this.cleanupFrozenImages([inputId]));
    }, delayMs);
    this.frozenImageCleanupTimers.set(inputId, timer);
  }

  private setFrozenImage(
    inputId: string,
    imageId: string,
    jpegPath: string,
  ): void {
    const previous = this.frozenImages.get(inputId);
    this.clearFrozenImageCleanupTimer(inputId);

    this.frozenImages.set(inputId, { imageId, jpegPath });
    this.output.store.getState().setInputFrozenImage(inputId, imageId);

    if (!previous) return;

    this.deferredUnregisterImage(previous.imageId, previous.jpegPath);
  }

  private cleanupFrozenImages(inputIds?: Iterable<string>): void {
    const targets = inputIds
      ? [...new Set(inputIds)]
          .map((inputId) => {
            const frozenImage = this.frozenImages.get(inputId);
            return frozenImage ? ([inputId, frozenImage] as const) : null;
          })
          .filter(
            (
              entry,
            ): entry is readonly [
              string,
              { imageId: string; jpegPath: string },
            ] => !!entry,
          )
      : [...this.frozenImages.entries()];

    if (!inputIds) {
      this.clearAllFrozenImageCleanupTimers();
    }

    for (const [inputId, { imageId, jpegPath }] of targets) {
      this.clearFrozenImageCleanupTimer(inputId);
      this.output.store.getState().setInputFrozenImage(inputId, null);
      this.frozenImages.delete(inputId);
      this.deferredUnregisterImage(imageId, jpegPath);
    }
  }

  private deferredUnregisterImage(imageId: string, jpegPath: string): void {
    const existing = this.pendingImageUnregisters.get(imageId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.pendingImageUnregisters.delete(imageId);
      SmelterInstance.unregisterImage(imageId).catch((err) => {
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Frozen image unregister skipped during Smelter recovery imageId=${imageId}`,
          );
          return;
        }
        console.error(`Failed to unregister frozen image ${imageId}`, err);
      });
      remove(jpegPath).catch(() => {});
    }, FROZEN_IMAGE_UNREGISTER_GRACE_MS);
    this.pendingImageUnregisters.set(imageId, { timer, jpegPath });
  }

  private async flushPendingImageUnregisters(): Promise<void> {
    for (const [imageId, { timer, jpegPath }] of this.pendingImageUnregisters) {
      clearTimeout(timer);
      try {
        await SmelterInstance.unregisterImage(imageId);
      } catch (err) {
        if (isSmelterTransportError(err)) {
          console.warn(
            `[timeline] Frozen image flush-unregister skipped during Smelter recovery imageId=${imageId}`,
          );
        } else {
          console.error(
            `Failed to flush-unregister frozen image ${imageId}`,
            err,
          );
        }
      }
      try {
        await remove(jpegPath);
      } catch {
        // best-effort cleanup
      }
    }
    this.pendingImageUnregisters.clear();
  }

  // ── Room lifecycle ────────────────────────────────────────

  public async deleteRoom() {
    return this.mutex.runExclusive(async () => {
      this.destroyed = true;
      this.pausedAttachedInputVolumes.clear();
      this.duckHunter.dispose();
      this.kbTournament.dispose();

      if (this.pendingStoreFlushTimer) {
        clearTimeout(this.pendingStoreFlushTimer);
        this.pendingStoreFlushTimer = null;
      }
      this.storeUpdateScheduled = false;

      if (this.timelinePlayer) {
        this.timelinePlayer.destroy();
        this.timelinePlayer = null;
      }

      this.cleanupFrozenImages();
      await this.flushPendingImageUnregisters();

      // Sweep this room's profile photos (covers files orphaned by players
      // who left or by registrations that never completed).
      try {
        const photoDir = path.join(DATA_DIR, 'kbt-photos');
        const safeRoom = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        for (const f of await readdir(photoDir)) {
          if (f.startsWith(`${safeRoom}-`)) {
            await remove(path.join(photoDir, f)).catch(() => {});
          }
        }
      } catch {
        // dir may not exist — nothing to sweep
      }

      // Sweep this room's rep-apex stills. The worker names them after the
      // sanitized inputId (`${roomId}::whip::…` → same char-class replacement
      // as safeRoom), so a room-prefix match catches them all.
      try {
        const frameDir = path.join(DATA_DIR, 'kbt-rep-frames');
        const safeRoom = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
        for (const f of await readdir(frameDir)) {
          if (f.startsWith(safeRoom)) {
            await remove(path.join(frameDir, f)).catch(() => {});
          }
        }
      } catch {
        // dir may not exist — nothing to sweep
      }

      await this.motionController.stopAll();
      await this.aiController.destroy();
      await this.captionsController.stopAll();
      await this.audioController.stopAll();
      await this.inputManager.destroyAll();

      try {
        await SmelterInstance.unregisterOutput(this.output.id);
      } catch (err: any) {
        console.error('Failed to remove output', err?.body ?? err);
      }

      await this.recordingController.cleanup();
    });
  }

  // ── Store sync ────────────────────────────────────────────

  private notifyStateChange() {
    for (const listener of this.stateChangeListeners) {
      try {
        listener();
      } catch {
        // best-effort notification
      }
    }
  }

  private updateStoreWithState() {
    if (this.destroyed) return;
    if (this.storeUpdateScheduled) return;
    this.storeUpdateScheduled = true;

    const elapsed = Date.now() - this.lastStoreFlushTime;
    if (elapsed >= RoomState.MIN_STORE_FLUSH_INTERVAL_MS) {
      queueMicrotask(() => this.flushStoreUpdate());
    } else {
      const delay = RoomState.MIN_STORE_FLUSH_INTERVAL_MS - elapsed;
      this.pendingStoreFlushTimer = setTimeout(() => {
        this.pendingStoreFlushTimer = null;
        this.flushStoreUpdate();
      }, delay);
    }
  }

  private flushStoreUpdate(
    skipUnplacedAppend = false,
    fromClientUpdate = false,
  ) {
    if (this._restoringTimeline) {
      skipUnplacedAppend = true;
    }
    this.storeUpdateScheduled = false;
    this.lastStoreFlushTime = Date.now();
    if (this.destroyed) return;

    const allInputs = this.inputManager.getInputs();

    const toInputConfig = (input: RoomInputState): InputConfig => ({
      inputId: input.inputId,
      title: input.metadata.title,
      description: input.metadata.description,
      showTitle: input.showTitle,
      volume: input.volume,
      shaders: input.shaders,
      // Non-mp4 inputs fall back to their reported native dims so the render
      // content box matches the source aspect — without this a portrait WHIP
      // cam lands in the hard-coded 16:9 box and the video Rescaler's 'fill'
      // cover-crops ~a third off the top and bottom. Safe: whip/hls/channel
      // inputs default to 1920x1080 natives, identical to the old behavior,
      // so only inputs that explicitly reported dims render differently.
      sourceWidth:
        input.type === 'local-mp4' ? input.mp4VideoWidth : input.nativeWidth,
      sourceHeight:
        input.type === 'local-mp4' ? input.mp4VideoHeight : input.nativeHeight,
      borderColor: input.borderColor,
      borderWidth: input.borderWidth,
      imageId:
        input.type === 'image' && !input.imageAssetMissing
          ? input.imageId
          : undefined,
      text: input.type === 'text-input' ? input.text : undefined,
      textAlign: input.type === 'text-input' ? input.textAlign : undefined,
      textColor: input.type === 'text-input' ? input.textColor : undefined,
      textMaxLines:
        input.type === 'text-input' ? input.textMaxLines : undefined,
      textScrollEnabled:
        input.type === 'text-input' ? input.textScrollEnabled : undefined,
      textScrollSpeed:
        input.type === 'text-input' ? input.textScrollSpeed : undefined,
      textScrollLoop:
        input.type === 'text-input' ? input.textScrollLoop : undefined,
      textScrollNudge:
        input.type === 'text-input' ? input.textScrollNudge : undefined,
      textFontSize:
        input.type === 'text-input' ? input.textFontSize : undefined,
      snakeGameState: input.type === 'game' ? input.snakeGameState : undefined,
      snakeEventShaders:
        input.type === 'game' ? input.snakeEventShaders : undefined,
      snake1Shaders: input.type === 'game' ? input.snake1Shaders : undefined,
      snake2Shaders: input.type === 'game' ? input.snake2Shaders : undefined,
      handsSourceInputId:
        input.type === 'hands' ? input.sourceInputId : undefined,
      handsStore: input.type === 'hands' ? input.handsStore : undefined,
      absolutePosition: input.absolutePosition,
      absoluteTop: input.absoluteTop,
      absoluteLeft: input.absoluteLeft,
      absoluteWidth: input.absoluteWidth,
      absoluteHeight: input.absoluteHeight,
      absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
      absoluteTransitionEasing: input.absoluteTransitionEasing,
      cropTop: input.cropTop,
      cropLeft: input.cropLeft,
      cropRight: input.cropRight,
      cropBottom: input.cropBottom,
      activeTransition: input.activeTransition,
      restartFading: input.restartFading,
      frozenImageId: this.frozenImages.get(input.inputId)?.imageId,
      hidden: input.hidden,
    });

    const connectedInputs = allInputs.filter(
      (input) => input.status === 'connected' && !input.hidden,
    );
    const connectedMap = new Map<string, RoomInputState>();
    for (const input of connectedInputs) {
      connectedMap.set(input.inputId, input);
    }

    const attachedIds = new Set<string>();
    for (const input of connectedInputs) {
      if (input.attachedInputIds) {
        for (const id of input.attachedInputIds) {
          attachedIds.add(id);
        }
      }
    }

    const inputs: InputConfig[] = connectedInputs
      .filter((input) => !attachedIds.has(input.inputId))
      .map((input) => {
        const config = toInputConfig(input);
        if (input.attachedInputIds && input.attachedInputIds.length > 0) {
          config.attachedInputs = input.attachedInputIds
            .map((id: string) => connectedMap.get(id))
            .filter((i: any): i is RoomInputState => !!i)
            .map(toInputConfig);
        }
        return config;
      });

    // Recompute positions for layers with a behavior config
    const behaviorInputInfos = this.collectBehaviorInputInfos();
    const inputMap = new Map(allInputs.map((i) => [i.inputId, i]));

    // Auto-append connected inputs that aren't in any layer to layers[0].
    // For a manual first layer, we prefer existing absolute coordinates from
    // input state to avoid re-tiling on timeline source swaps.
    // If geometry is unknown, use output-sized fallback geometry for only the
    // newly added input, without re-tiling already positioned manual inputs.
    // Skipped during timeline snapshot restore to preserve exact manual
    // positions.
    if (!skipUnplacedAppend) {
      const mentionedIds = new Set(
        this.layers.flatMap((l) => l.inputs.map((li) => li.inputId)),
      );
      const unplacedAttachedIds = new Set(
        allInputs
          .filter(
            (i) => i.status === 'connected' && !i.hidden && i.attachedInputIds,
          )
          .flatMap((i) => i.attachedInputIds ?? []),
      );
      const unplacedInputs = behaviorInputInfos.filter(
        (bi) =>
          !mentionedIds.has(bi.inputId) && !unplacedAttachedIds.has(bi.inputId),
      );
      if (unplacedInputs.length > 0 && this.layers.length > 0) {
        const firstLayer = this.layers[0]!;
        const isManualFirstLayer = !firstLayer.behavior;
        for (const bi of unplacedInputs) {
          const input = inputMap.get(bi.inputId);
          const hasAbsoluteGeometry =
            input?.absoluteLeft !== undefined &&
            input?.absoluteTop !== undefined &&
            input?.absoluteWidth !== undefined &&
            input?.absoluteHeight !== undefined;

          if (isManualFirstLayer && hasAbsoluteGeometry) {
            const absoluteInput = input as RoomInputState & {
              absoluteLeft: number;
              absoluteTop: number;
              absoluteWidth: number;
              absoluteHeight: number;
            };
            firstLayer.inputs.push({
              inputId: bi.inputId,
              x: absoluteInput.absoluteLeft,
              y: absoluteInput.absoluteTop,
              width: absoluteInput.absoluteWidth,
              height: absoluteInput.absoluteHeight,
              transitionDurationMs: absoluteInput.absoluteTransitionDurationMs,
              transitionEasing: absoluteInput.absoluteTransitionEasing,
              cropTop: absoluteInput.cropTop,
              cropLeft: absoluteInput.cropLeft,
              cropRight: absoluteInput.cropRight,
              cropBottom: absoluteInput.cropBottom,
            });
            continue;
          }

          const fallbackWidth =
            input?.absoluteWidth ??
            input?.nativeWidth ??
            this.output.resolution.width;
          const fallbackHeight =
            input?.absoluteHeight ??
            input?.nativeHeight ??
            this.output.resolution.height;
          firstLayer.inputs.push({
            inputId: bi.inputId,
            x: input?.absoluteLeft ?? 0,
            y: input?.absoluteTop ?? 0,
            width: fallbackWidth,
            height: fallbackHeight,
            transitionDurationMs: input?.absoluteTransitionDurationMs,
            transitionEasing: input?.absoluteTransitionEasing,
            cropTop: input?.cropTop,
            cropLeft: input?.cropLeft,
            cropRight: input?.cropRight,
            cropBottom: input?.cropBottom,
          });
        }
      }
    }

    this.layers = this.layers.map((layer) => {
      if (layer.behavior && !layer.carousel) {
        // Separate visible (non-hidden) and hidden inputs
        const visibleLayerInputs: typeof layer.inputs = [];
        const hiddenLayerInputs: typeof layer.inputs = [];

        for (const li of layer.inputs) {
          const input = inputMap.get(li.inputId);
          if (input?.hidden) {
            hiddenLayerInputs.push(li);
          } else {
            visibleLayerInputs.push(li);
          }
        }

        // Compute layout only for visible inputs, preserving layer order.
        // We build a lookup map from the global infos and then re-order by the
        // layer's own input sequence so that user reorderings are honoured.
        const behaviorInfoMap = new Map(
          behaviorInputInfos.map((bi) => [bi.inputId, bi]),
        );
        const visibleInputInfos = visibleLayerInputs
          .map((li) => behaviorInfoMap.get(li.inputId))
          .filter((bi): bi is BehaviorInputInfo => bi !== undefined);
        const result = computeLayout(
          layer.behavior,
          visibleInputInfos,
          this.output.resolution,
        );

        // Merge computed positions back in the original layer.inputs order
        // so that hidden inputs keep their position instead of being pushed
        // to the end (which would break reorderInputs ordering).
        const computedMap = new Map(
          result.inputs.map((li) => [li.inputId, li]),
        );
        const newInputs = layer.inputs
          .map((li) => computedMap.get(li.inputId) ?? li)
          .filter(
            (li) =>
              computedMap.has(li.inputId) || inputMap.get(li.inputId)?.hidden,
          );

        const positionsChanged = !layoutInputsEqual(layer.inputs, newInputs);
        const shouldBump = fromClientUpdate || positionsChanged;
        const layoutTimestamp = shouldBump ? Date.now() : layer.layoutTimestamp;

        return { ...layer, inputs: newInputs, layoutTimestamp };
      }

      return layer;
    });

    const transcriptionSideChannelInputIds = allInputs
      .filter(
        (input) => input.status === 'connected' && hasTranscription(input),
      )
      .map((input) => input.inputId);

    const { layers: outputLayers, inputs: outputInputs } =
      this.buildBroadcastOverride(this.layers, inputs);

    this.output.store.getState().updateState({
      inputs: [...outputInputs].reverse(),
      layers: outputLayers,
      transcriptionSideChannelInputIds,
      swapDurationMs: this.swapDurationMs,
      swapOutgoingEnabled: this.swapOutgoingEnabled,
      swapFadeInDurationMs: this.swapFadeInDurationMs,
      swapFadeOutDurationMs: this.swapFadeOutDurationMs,
      viewportTop: this.viewportTop,
      viewportLeft: this.viewportLeft,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      viewportTransitionDurationMs: this.viewportTransitionDurationMs,
      viewportTransitionEasing: this.viewportTransitionEasing,
    });

    this.notifyStateChange();
  }

  private buildBroadcastOverride(
    layers: Layer[],
    inputs: InputConfig[],
  ): { layers: Layer[]; inputs: InputConfig[] } {
    if (!this.selectedBroadcastTileId) {
      return { layers, inputs };
    }
    const tile = this.broadcastTiles.find(
      (t) => t.id === this.selectedBroadcastTileId,
    );
    if (!tile) return { layers, inputs };

    const { width, height } = this.output.resolution;
    if (tile.type === 'input') {
      const broadcastLayer: Layer = {
        id: `__broadcast__::${tile.id}`,
        inputs: [
          {
            inputId: tile.targetId,
            x: 0,
            y: 0,
            width,
            height,
          },
        ],
        layoutTimestamp: Date.now(),
      };
      const broadcastInputs = inputs.filter((i) => i.inputId === tile.targetId);
      return { layers: [broadcastLayer], inputs: broadcastInputs };
    }
    const layer = layers.find((l) => l.id === tile.targetId);
    if (!layer) return { layers, inputs };

    const usedInputIds = new Set(layer.inputs.map((li) => li.inputId));
    const filteredInputs = inputs.filter((i) => usedInputIds.has(i.inputId));
    return { layers: [layer], inputs: filteredInputs };
  }

  private setLayersAndSyncInputState(layers: Layer[]): void {
    if (layers.length === 0) {
      throw new Error('layers must not be empty');
    }

    const cloned = cloneLayers(layers);
    const sanitized = sanitizeLayerInputs(cloned);
    this.layers = sanitized;

    // Sync position, transition, and crop properties from layer entries back
    // to input state so the editor's controllers stay consistent.
    // The first layer that contains an input is authoritative.
    const allInputs = this.inputManager.getInputs();
    const seen = new Set<string>();
    for (const layer of sanitized) {
      for (const li of layer.inputs) {
        if (seen.has(li.inputId)) continue;
        seen.add(li.inputId);
        const input = allInputs.find((i) => i.inputId === li.inputId);
        if (!input) continue;
        input.absoluteLeft = li.x;
        input.absoluteTop = li.y;
        input.absoluteWidth = li.width;
        input.absoluteHeight = li.height;
        if (li.transitionDurationMs !== undefined)
          input.absoluteTransitionDurationMs = li.transitionDurationMs;
        if (li.transitionEasing !== undefined)
          input.absoluteTransitionEasing = li.transitionEasing;
        if (li.cropTop !== undefined) input.cropTop = li.cropTop;
        if (li.cropLeft !== undefined) input.cropLeft = li.cropLeft;
        if (li.cropRight !== undefined) input.cropRight = li.cropRight;
        if (li.cropBottom !== undefined) input.cropBottom = li.cropBottom;
      }
    }
  }
}
