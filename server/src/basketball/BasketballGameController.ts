import { randomUUID } from 'node:crypto';
import type {
  BbAttempt,
  BbCam,
  BbClipClock,
  BbReplayBasket,
  BbReplayState,
  BbCamRole,
  BbConfig,
  BbErrorCode,
  BbMatchAction,
  BbMatchEvent,
  BbPeriod,
  BbPhase,
  BbRim,
  BbShotEvent,
  BbStateEvent,
  BbTeamId,
  BbTeamStats,
  BbViewOverride,
  RoomEvent,
} from '@smelter-editor/types';
import {
  BB_CAM_ROLES,
  BB_DEFAULT_CONFIG,
  BB_MATCH_ACTIONS,
  BB_TEAM_IDS,
} from '@smelter-editor/types';
import type { BbHudScene, BbHudStage, BbHudState } from '../app/store';
import {
  KBT_VIEW_TRANSITION_MS,
  bbPipRect,
  kbtCasterCamRect,
  kbtParkRect,
} from '../app/store';
import { clamp } from '../core/mathUtils';
import type { ReplayShot } from './groundTruth';

/** Command from the arcade page's match endpoint (and the panel over WS). */
export type BbMatchCommand = {
  action: BbMatchAction;
  /** Target camera for kick_cam. */
  role?: BbCamRole;
};

/** Why a match command was refused (returned to the host, not thrown). */
export type BbMatchError = {
  code: BbErrorCode;
  message: string;
  context?: Record<string, string | number>;
};

/** One tile of the manual `bb-stage` layout (same contract as KbtStageTile). */
export type BbStageTile = {
  inputId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
};

/** Discrete events inside a basketball-scorer result payload. */
export type BbWorkerEvent =
  | {
      type: 'shot_made';
      index: number;
      t?: number;
      team?: 'A' | 'B' | null;
      teamConfidence?: number;
      colorSample?: string | null;
      releaseT?: number;
      frameFile?: string;
      releaseFrameFile?: string;
    }
  | {
      type: 'shot_attempt';
      index: number;
      t?: number;
      team?: 'A' | 'B' | null;
      result: 'made' | 'miss';
    }
  | { type: 'ball_found' }
  | { type: 'ball_lost' };

/** The slice of the worker's per-frame result the controller reads. */
export type BbWorkerResult = {
  session?: string;
  ball?: { x: number; y: number; w: number; h: number; src?: string } | null;
  zone?: 'above' | 'rim' | 'below' | 'none';
  state?: string;
  events?: BbWorkerEvent[];
  procMs?: number;
};

/**
 * Everything the controller needs from the room, injected so tests can fake
 * the world (same pattern as KbtControllerDeps). All camera/AI/layout calls
 * are best-effort async — the controller never blocks its tick on them.
 */
export type BbControllerDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  /**
   * Register a WHIP camera input through InputManager. Every basketball cam
   * (hoop, court, commentator) keeps the side channel (`ai: true`) so all
   * three share the same 3 s buffering delay and stay in sync on air.
   */
  registerGameCam: (
    name: string,
    dims?: { width: number; height: number },
    opts?: { ai?: boolean },
  ) => Promise<{ inputId: string; whipUrl: string; bearerToken: string }>;
  removeInput: (inputId: string) => Promise<void>;
  /** Enable/disable the basketball-scorer model on one input. */
  setBasketballScorer: (
    inputId: string,
    enabled: boolean,
    params?: Record<string, number | string>,
  ) => Promise<void>;
  setAnimTickMs: (ms: number) => void;
  /** Replace the output layout with these tiles (manual positions). */
  layoutTiles: (tiles: BbStageTile[]) => Promise<void>;
  runInputTransition: (
    inputId: string,
    transition: {
      type: 'fade' | 'dissolve';
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) => void;
  isInputConnected: (inputId: string) => boolean;
  /** WHIP input is actually publishing (heartbeat-acked within the TTL). */
  isInputLive?: (inputId: string) => boolean;
  getResolution: () => { width: number; height: number };
  hasActiveRecording?: () => boolean;
  /** Write the burned-in HUD state (already hold-scheduled by the controller). */
  publishHud: (state: BbHudState | null) => void;
  /** Render `url` as a QR PNG and register it; resolves with the image id. */
  registerJoinQr: (url: string) => Promise<string>;
  /** Register a saved shot still (`/bb-shot-frames/…`) as an engine image;
   * resolves null when the file is gone. */
  registerShotFrameImage: (url: string) => Promise<string | null>;
  unregisterShotFrameImage: (imageId: string) => void;
  /**
   * Playhead anchor of a local-mp4 input: at wall time `anchorWallMs` the clip
   * was (re)registered playing from `playFromMs`. Null when the input is not
   * a connected file clip.
   */
  getFileClock?: (inputId: string) => BbFileClock | null;
  now?: () => number;
};

export type BbFileClock = {
  anchorWallMs: number;
  playFromMs: number;
  durationMs: number | null;
  delayMs: number;
};

type CamState = {
  role: BbCamRole;
  /** Control socket currently holding the slot (null for sim/mp4 cams). */
  clientId: string | null;
  /** Resume token, minted once and returned in bb_cam_joined. */
  camKey: string;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
  inputId: string | null;
  camConnected: boolean;
  camDownAt: number | null;
  camWidth: number | null;
  camHeight: number | null;
  /** hoop only: the worker sees a ball right now. */
  ballTracked: boolean;
  /** 'file' when the input is a looping mp4 from data/mp4s (no phone). */
  source: 'whip' | 'file';
  /** source === 'file' only: path relative to data/mp4s. */
  fileName: string | null;
};

type CommentatorState = {
  clientId: string;
  commentatorKey: string;
  name: string;
  connected: boolean;
  inputId: string | null;
  camConnected: boolean;
  camWidth: number | null;
  camHeight: number | null;
};

type TeamTally = {
  score: number;
  otScore: number;
  makes: number;
  attempts: number;
  twos: number;
};

type ReplayRun = {
  fileName: string;
  basket: BbReplayBasket;
  loop: boolean;
  shots: ReplayShot[];
  /** Next shot to fire. */
  cursor: number;
  /** How many times the clip has looped since the clock anchor. */
  loopIndex: number;
  fired: number;
  skipped: number;
  /** Identity of the file clock the schedule was computed against. */
  clockSig: string | null;
  nextFireAt: number | null;
};

type ShotInput = {
  source: 'ai' | 'manual' | 'replay';
  aiTeam: BbTeamId | null;
  aiConfidence: number;
  /** Manual entries pin the team; AI entries resolve it by confidence. */
  team?: BbTeamId | null;
  points?: 1 | 2;
  gtPoints?: 1 | 2 | 3;
  colorSample?: string | null;
  sourceT?: number;
  /** Clip media time (ms); stamped from the hoop file clock when absent. */
  mediaMs?: number;
  frameUrl?: string;
  releaseFrameUrl?: string;
};

const TICK_MS = 100;
const MATCH_BROADCAST_MS = 1000;
/**
 * The AI sees frames ~live while the composited WHIP video runs 3000 ms
 * behind (WHIP_SIDE_CHANNEL_DELAY_MS). Holding every HUD data snapshot by the
 * same amount keeps burned-in scores/clock on the frames they belong to; the
 * layout (which cam is main) is NOT held — that is the predictive cut.
 */
const HUD_HOLD_MS = 3000;
const PARK_LEAD_MS = 50;
/**
 * A make detected right after the buzzer belongs to regulation: the ball was
 * in the air when time expired. Also the window regulation stays "live"
 * before the tie/OT decision.
 */
const SHOT_GRACE_MS = 600;
const BANNER_MS = 4000;
const SCORE_BANNER_MS = 3500;
const RECENT_SHOTS = 12;
const BALL_EVENT_MIN_MS = 250;
const BALL_STATE_BROADCAST_MIN_MS = 1000;
const DURATION_MIN_MS = 30_000;
const DURATION_MAX_MS = 1_800_000;
/**
 * Replay from ground truth: the worker confirms a make a beat after the ball
 * reaches the rim (net dwell), so annotated rim times fire with this lag.
 */
const REPLAY_DETECT_LAG_MS = 300;
/** A replay throw whose fire time is further in the past than this is skipped
 * (the playhead jumped past it — re-sync, loop, late load). */
const REPLAY_LATE_MAX_MS = 2000;
const REPLAY_BROADCAST_MS = 1000;
const ANALYSIS_FPS_MIN = 8;
const ANALYSIS_FPS_MAX = 30;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isTeamId(v: unknown): v is BbTeamId {
  return v === 'A' || v === 'B';
}

function isCamRole(v: unknown): v is BbCamRole {
  return v === 'hoop' || v === 'court';
}

/** Coarse clock for HUD snapshots so back-to-back publishes dedupe. */
function quantizeClock(ms: number): number {
  return Math.ceil(ms / 500) * 500;
}

function emptyTally(): TeamTally {
  return { score: 0, otScore: 0, makes: 0, attempts: 0, twos: 0 };
}

/**
 * Basketball Game for one room: two phone cameras (hoop + court) and a
 * commentator joined by QR, a FIBA-3x3 style match clock, a ledger of made
 * baskets fed by the basketball-scorer worker (auto-assigned by jersey
 * colour or queued for the moderator), and the output layout + burned-in HUD.
 */
export class BasketballGameController {
  private config: BbConfig = structuredClone(BB_DEFAULT_CONFIG);
  private readonly cams = new Map<BbCamRole, CamState>();
  private commentator: CommentatorState | null = null;

  // ── match clock ──
  private phase: BbPhase = 'lobby';
  private period: BbPeriod = 'reg';
  private pausedFrom: 'live' | 'overtime' = 'live';
  private matchStartedAt: number | null = null;
  /** Start of the running clock segment (null while paused / not running). */
  private segmentStartedAt: number | null = null;
  private regElapsedBeforeSegmentMs = 0;
  private otElapsedBeforeSegmentMs = 0;
  /** Regulation ran out at this instant; the OT/end decision waits SHOT_GRACE_MS. */
  private regExpiredAt: number | null = null;
  private endedAt: number | null = null;
  private endedByShot = false;
  private phaseBeforeEnd: 'live' | 'overtime' = 'live';
  private winner: BbTeamId | null = null;

  // ── ledger ──
  private shots: BbShotEvent[] = [];
  private attempts: BbAttempt[] = [];
  private shotSeq = 0;
  private attemptSeq = 0;
  private tally: Record<BbTeamId, TeamTally> = {
    A: emptyTally(),
    B: emptyTally(),
  };
  private unattributedMisses = 0;
  private leadChanges = 0;
  private leader: BbTeamId | null = null;
  /** Newest ingested make (drives the score scene + banner). */
  private lastShot: { shot: BbShotEvent; at: number } | null = null;
  private banner: BbHudState['banner'] = null;

  // ── broadcast view ──
  private viewOverride: BbViewOverride = { mode: 'auto' };
  private casterPip = true;
  private stagedScene: BbHudScene = 'lobby';
  private lastStage: BbHudStage | null = null;
  private joinLabel: string | null = null;
  private readonly joinUrls: Record<
    'hoop' | 'court' | 'commentator',
    string | null
  > = { hoop: null, court: null, commentator: null };
  private readonly qrImageIds: Record<
    'hoop' | 'court' | 'commentator',
    string | null
  > = { hoop: null, court: null, commentator: null };
  /** url → engine imageId for shot stills (freed at dispose). */
  private readonly frameImageIds = new Map<string, string>();

  // ── layout machinery (ported from the kettlebell tournament) ──
  private lastStagedInputIds = new Set<string>();
  private lastAppliedRects = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  private lastDesiredTiles: BbStageTile[] = [];
  private leavingTiles = new Map<
    string,
    {
      rect: { x: number; y: number; width: number; height: number };
      until: number;
    }
  >();
  private parkTimer: ReturnType<typeof setTimeout> | null = null;

  // ── HUD hold ──
  private hudApplyAt = 0;
  private readonly hudTimers = new Set<ReturnType<typeof setTimeout>>();
  private hudMinIntervalMs = 100;
  private lastPeriodicHudAt = 0;
  /** The last state actually handed to deps.publishHud (stage re-merges). */
  private lastAppliedHud: BbHudState | null = null;

  // ── worker feed ──
  private workerSession: string | null = null;
  private lastMadeIndex = -1;
  private lastAttemptIndex = -1;
  private ballZone: 'above' | 'rim' | 'below' | 'none' = 'none';
  private lastBallEventAt = 0;
  private lastBallSig = '';
  private lastBallStateBroadcastAt = 0;

  // ── ground-truth replay ──
  private replay: ReplayRun | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplayBroadcastAt = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCamPoll = 0;
  private disposed = false;
  /**
   * Somebody actually uses this game in the room (config pushed, a camera
   * or moderator joined, a match run). Room-wide pokes (recording toggles)
   * must not publish our chrome into a room running another game.
   */
  private engaged = false;

  constructor(
    private readonly roomId: string,
    private readonly deps: BbControllerDeps,
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  // ── WS message handling ───────────────────────────────────────────────────

  handleMessage(clientId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as {
      type?: unknown;
      role?: unknown;
      name?: unknown;
      camKey?: unknown;
      commentatorKey?: unknown;
      nativeWidth?: unknown;
      nativeHeight?: unknown;
      rim?: unknown;
      team?: unknown;
      color?: unknown;
      override?: unknown;
      action?: unknown;
      enabled?: unknown;
      shotId?: unknown;
      points?: unknown;
      voided?: unknown;
    };
    switch (msg.type) {
      case 'bb_spectate':
        this.spectate(clientId);
        break;
      case 'bb_cam_join':
        this.joinCam(
          clientId,
          msg.role,
          typeof msg.name === 'string' ? msg.name : '',
          typeof msg.camKey === 'string' && msg.camKey.length <= 64
            ? msg.camKey
            : undefined,
        );
        break;
      case 'bb_cam_request':
        void this.startCamera(clientId, this.parseDims(msg));
        break;
      case 'bb_cam_stop':
        this.stopCamera(clientId);
        break;
      case 'bb_cam_leave':
        this.leaveCam(clientId);
        break;
      case 'bb_rim_calibrate':
        this.calibrateRim(clientId, msg.rim);
        break;
      case 'bb_team_color':
        this.setTeamColor(clientId, msg.team, msg.color);
        break;
      case 'bb_commentator_join':
        this.joinCommentator(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Moderator',
          typeof msg.commentatorKey === 'string' &&
            msg.commentatorKey.length <= 64
            ? msg.commentatorKey
            : undefined,
        );
        break;
      case 'bb_commentator_cam_request':
        void this.startCommentatorCamera(clientId, this.parseDims(msg));
        break;
      case 'bb_commentator_leave':
        this.leaveCommentator(clientId);
        break;
      case 'bb_commentator_view':
        this.setViewOverride(clientId, msg.override);
        break;
      case 'bb_commentator_caster_pip':
        this.setCasterPip(clientId, msg.enabled);
        break;
      case 'bb_commentator_match': {
        const action = msg.action;
        if (
          typeof action === 'string' &&
          (BB_MATCH_ACTIONS as readonly string[]).includes(action)
        ) {
          this.commentatorControlMatch(clientId, {
            action: action as BbMatchAction,
            role: isCamRole(msg.role) ? msg.role : undefined,
          });
        }
        break;
      }
      case 'bb_shot_resolve':
        if (!this.requireCommentator(clientId, 'resolve shots')) break;
        if (typeof msg.shotId !== 'string') {
          this.sendError(clientId, 'invalid_shot', 'Missing shot id.');
          break;
        }
        if (
          !this.resolveShot({
            shotId: msg.shotId,
            team: msg.team === undefined ? undefined : this.parseTeam(msg.team),
            points:
              msg.points === 1 || msg.points === 2 ? msg.points : undefined,
            voided: typeof msg.voided === 'boolean' ? msg.voided : undefined,
          })
        ) {
          this.sendError(clientId, 'unknown_shot', 'No such shot.', {
            shotId: msg.shotId,
          });
        }
        break;
      case 'bb_shot_add':
        if (!this.requireCommentator(clientId, 'add points')) break;
        if (!isTeamId(msg.team)) {
          this.sendError(clientId, 'invalid_shot', 'Unknown team.');
          break;
        }
        if (!this.addManualShot(msg.team, msg.points === 2 ? 2 : 1)) {
          this.sendError(
            clientId,
            'bad_action',
            'Start the match before adding points.',
          );
        }
        break;
      case 'bb_shot_undo':
        if (!this.requireCommentator(clientId, 'undo shots')) break;
        if (
          !this.undoShot(
            typeof msg.shotId === 'string' ? msg.shotId : undefined,
          )
        ) {
          this.sendError(clientId, 'unknown_shot', 'Nothing to undo.');
        }
        break;
      default:
        break;
    }
  }

  private parseDims(msg: {
    nativeWidth?: unknown;
    nativeHeight?: unknown;
  }): { width: number; height: number } | undefined {
    const w = Number(msg.nativeWidth);
    const h = Number(msg.nativeHeight);
    return Number.isFinite(w) &&
      Number.isFinite(h) &&
      w >= 16 &&
      w <= 8192 &&
      h >= 16 &&
      h <= 8192
      ? { width: Math.round(w), height: Math.round(h) }
      : undefined;
  }

  private parseTeam(v: unknown): BbTeamId | null {
    return isTeamId(v) ? v : null;
  }

  /** A rejected request, addressed to the client that made it. */
  private sendError(
    clientId: string,
    code: BbErrorCode,
    message: string,
    context?: Record<string, string | number>,
  ): void {
    this.deps.sendTo(clientId, {
      type: 'bb_error',
      roomId: this.roomId,
      code,
      message,
      ...(context ? { context } : {}),
    });
  }

  /** Snapshot-only handshake for the arcade page (never a participant). */
  spectate(clientId: string): void {
    this.deps.sendTo(clientId, this.stateSnapshot());
    this.deps.sendTo(clientId, this.getMatchSnapshot());
  }

  // ── Cameras (hoop / court phones) ─────────────────────────────────────────

  private camByClient(clientId: string): CamState | undefined {
    for (const cam of this.cams.values()) {
      if (cam.clientId === clientId) return cam;
    }
    return undefined;
  }

  /**
   * Claim a camera role. A join carrying the slot's camKey re-adopts it even
   * while the old socket still looks open (fast refresh); a disconnected slot
   * is adoptable by anyone (operator swaps phones); a connected slot without
   * the key is refused.
   */
  joinCam(
    clientId: string,
    rawRole: unknown,
    rawName: string,
    camKey?: string,
  ): void {
    if (!isCamRole(rawRole)) {
      this.sendError(clientId, 'bad_action', 'Unknown camera role.');
      return;
    }
    const role = rawRole;
    this.engaged = true;
    const name =
      rawName.slice(0, 20).trim() ||
      (role === 'hoop' ? 'Hoop cam' : 'Court cam');
    // One phone holds one role: moving roles releases the previous slot.
    const previous = this.camByClient(clientId);
    if (previous && previous.role !== role) this.releaseCamSlot(previous);
    const slot = this.cams.get(role);
    let cam: CamState;
    if (slot) {
      const keyMatch = camKey != null && camKey === slot.camKey;
      const sameClient = slot.clientId === clientId;
      if (!sameClient && !keyMatch && slot.connected) {
        this.sendError(
          clientId,
          'role_taken',
          `The ${role} camera is already held by ${slot.name}.`,
          { role },
        );
        return;
      }
      slot.clientId = clientId;
      slot.connected = true;
      slot.disconnectedAt = null;
      if (rawName.trim()) slot.name = name;
      cam = slot;
    } else {
      cam = {
        role,
        clientId,
        camKey: camKey ?? randomUUID(),
        name,
        connected: true,
        disconnectedAt: null,
        inputId: null,
        camConnected: false,
        camDownAt: null,
        camWidth: null,
        camHeight: null,
        ballTracked: false,
        source: 'whip',
        fileName: null,
      };
      this.cams.set(role, cam);
    }
    this.deps.sendTo(clientId, {
      type: 'bb_cam_joined',
      roomId: this.roomId,
      clientId,
      camKey: cam.camKey,
      role,
      name: cam.name,
      camInputActive: cam.inputId != null,
      rim: role === 'hoop' ? this.config.rim : null,
      phase: this.phase,
    });
    this.ensureRunning();
    this.broadcastState();
  }

  /**
   * Register a fresh WHIP input for this phone's role (retiring any previous
   * one) and send the publish offer. The hoop camera gets the scorer model
   * armed as soon as its input exists — detection feedback starts in the
   * lobby, where the operator calibrates.
   */
  async startCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const cam = this.camByClient(clientId);
    if (!cam) {
      this.sendError(
        clientId,
        'not_joined',
        'Claim a camera role before requesting a slot.',
      );
      return;
    }
    this.retireCamInput(cam);
    // A phone taking over a file-backed slot turns it back into a WHIP cam.
    cam.source = 'whip';
    cam.fileName = null;
    if (dims) {
      cam.camWidth = dims.width;
      cam.camHeight = dims.height;
    }
    let offer: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      offer = await this.deps.registerGameCam(cam.name, dims, { ai: true });
    } catch (err) {
      console.error(`[bb] camera input register failed for ${clientId}`, err);
      this.sendError(
        clientId,
        'no_live_camera',
        'Camera slot could not be created — try again.',
      );
      return;
    }
    // The phone may have left or re-requested while we awaited.
    if (
      this.disposed ||
      this.cams.get(cam.role) !== cam ||
      cam.clientId !== clientId ||
      cam.inputId != null
    ) {
      void this.deps.removeInput(offer.inputId).catch(() => {});
      return;
    }
    cam.inputId = offer.inputId;
    cam.camConnected = false; // flips true once the publish acks (tick poll)
    this.deps.sendTo(clientId, {
      type: 'bb_cam_offer',
      roomId: this.roomId,
      clientId,
      role: cam.role,
      inputId: offer.inputId,
      whipUrl: offer.whipUrl,
      bearerToken: offer.bearerToken,
    });
    if (cam.role === 'hoop') this.armHoopAi();
    void this.restage();
    this.ensureRunning();
    this.broadcastState();
  }

  stopCamera(clientId: string): void {
    const cam = this.camByClient(clientId);
    if (!cam) return;
    this.retireCamInput(cam);
    void this.restage();
    this.broadcastState();
  }

  leaveCam(clientId: string): void {
    const cam = this.camByClient(clientId);
    if (!cam) return;
    this.releaseCamSlot(cam);
    void this.restage();
    this.broadcastState();
    this.maybeStop();
  }

  private releaseCamSlot(cam: CamState): void {
    this.retireCamInput(cam);
    if (this.cams.get(cam.role) === cam) this.cams.delete(cam.role);
  }

  private retireCamInput(cam: CamState): void {
    if (cam.inputId == null) return;
    const inputId = cam.inputId;
    cam.inputId = null;
    cam.camConnected = false;
    cam.camDownAt = null;
    cam.ballTracked = false;
    if (cam.role === 'hoop') {
      this.workerSession = null;
      this.ballZone = 'none';
      void this.deps.setBasketballScorer(inputId, false).catch(() => {});
    }
    void this.deps.removeInput(inputId).catch(() => {});
  }

  /**
   * Adopt an already-connected input (a looping local-mp4 from data/mp4s) as
   * a camera role, in place of a phone-published WHIP stream. Everything
   * downstream is inputId-keyed and works unchanged. A phone currently
   * holding the slot keeps it, but its stream is retired.
   */
  attachExternalCam(
    role: BbCamRole,
    inputId: string,
    dims?: { width: number; height: number },
    fileName?: string,
  ): boolean {
    this.engaged = true;
    let cam = this.cams.get(role);
    if (!cam) {
      cam = {
        role,
        clientId: null,
        camKey: randomUUID(),
        name: '',
        connected: false,
        disconnectedAt: null,
        inputId: null,
        camConnected: false,
        camDownAt: null,
        camWidth: null,
        camHeight: null,
        ballTracked: false,
        source: 'file',
        fileName: null,
      };
      this.cams.set(role, cam);
    } else {
      this.retireCamInput(cam);
    }
    cam.source = 'file';
    cam.fileName = fileName ?? null;
    cam.name = role === 'hoop' ? 'Hoop cam (file)' : 'Court cam (file)';
    if (dims) {
      cam.camWidth = dims.width;
      cam.camHeight = dims.height;
    }
    cam.inputId = inputId;
    cam.camConnected = false; // flips true on the next tick poll
    if (role === 'hoop') this.armHoopAi();
    void this.restage();
    this.ensureRunning();
    this.broadcastState();
    return true;
  }

  /** Inputs of the file-backed cams (for the clip sync/restart action). */
  fileCamInputIds(): { role: BbCamRole; inputId: string }[] {
    const out: { role: BbCamRole; inputId: string }[] = [];
    for (const cam of this.cams.values()) {
      if (cam.source === 'file' && cam.inputId != null) {
        out.push({ role: cam.role, inputId: cam.inputId });
      }
    }
    return out;
  }

  /**
   * Clock of the file clip driving the game: the hoop cam when it is a file,
   * else the court cam (APIDIS-style multi-cam clips share media time).
   */
  fileClock(): { role: BbCamRole; inputId: string; clock: BbFileClock } | null {
    const get = this.deps.getFileClock;
    if (!get) return null;
    for (const role of ['hoop', 'court'] as const) {
      const cam = this.cams.get(role);
      if (!cam || cam.source !== 'file' || cam.inputId == null) continue;
      const clock = get(cam.inputId);
      if (clock) return { role, inputId: cam.inputId, clock };
    }
    return null;
  }

  /** Media time (ms) of `clock` at wall time `now` (wraps when looping). */
  private static mediaAt(clock: BbFileClock, now: number): number {
    const t = clock.playFromMs + (now - clock.anchorWallMs);
    return clock.durationMs && clock.durationMs > 0 && t >= 0
      ? t % clock.durationMs
      : t;
  }

  private clipSnapshot(cam: CamState, now: number): BbClipClock | undefined {
    if (cam.source !== 'file' || cam.inputId == null) return undefined;
    const clock = this.deps.getFileClock?.(cam.inputId);
    if (!clock) return undefined;
    return {
      playFromMs: clock.playFromMs,
      mediaMs: Math.round(BasketballGameController.mediaAt(clock, now)),
      durationMs: clock.durationMs,
      delayMs: clock.delayMs,
    };
  }

  // ── Ground-truth replay ───────────────────────────────────────────────────

  /**
   * Fire the throws of a ground-truth file at their clip media time, anchored
   * to the file cams' playhead — exactly when the model would report them —
   * so the predictive cut and the held HUD work unchanged. While loaded, the
   * model's own shot events are ignored (the scorer stays armed so the hoop
   * clip keeps its side-channel delay). Throws before START are skipped.
   */
  loadReplay(opts: {
    fileName: string;
    shots: ReplayShot[];
    basket: BbReplayBasket;
    loop: boolean;
  }): BbReplayState {
    if (!this.fileClock()) {
      throw new Error(
        'Attach a file camera first (USE FILE) — the replay follows its playhead.',
      );
    }
    this.clearReplayTimer();
    this.replay = {
      fileName: opts.fileName,
      basket: opts.basket,
      loop: opts.loop,
      shots: [...opts.shots].sort((a, b) => a.tMs - b.tMs),
      cursor: 0,
      loopIndex: 0,
      fired: 0,
      skipped: 0,
      clockSig: null,
      nextFireAt: null,
    };
    this.engaged = true;
    this.scheduleReplay();
    this.ensureRunning();
    this.broadcastState();
    return this.replaySnapshot() as BbReplayState;
  }

  unloadReplay(): void {
    if (!this.replay) return;
    this.clearReplayTimer();
    this.replay = null;
    this.broadcastState();
  }

  replaySnapshot(): BbReplayState | null {
    const r = this.replay;
    if (!r) return null;
    const now = this.now();
    const next = r.cursor < r.shots.length ? r.shots[r.cursor] : null;
    return {
      fileName: r.fileName,
      active: true,
      basket: r.basket,
      loop: r.loop,
      total: r.shots.length,
      fired: r.fired,
      skipped: r.skipped,
      nextEventTMs: next?.tMs ?? null,
      nextFireInMs:
        r.nextFireAt != null ? Math.max(0, r.nextFireAt - now) : null,
      clockRole: this.fileClock()?.role ?? null,
    };
  }

  private clearReplayTimer(): void {
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }

  private static clockSig(fc: { inputId: string; clock: BbFileClock }): string {
    return `${fc.inputId}:${fc.clock.anchorWallMs}:${fc.clock.playFromMs}`;
  }

  /**
   * Wall time the model would report this throw: the frame at `tMs` reaches
   * the AI at anchor + (tMs − playFrom) and viewers `delayMs` later; the HUD
   * hold assumes HUD_HOLD_MS of that, so a clip without a side channel fires
   * early by the difference.
   */
  private replayFireAt(
    shot: ReplayShot,
    loopIndex: number,
    clock: BbFileClock,
  ): number {
    const loopMs =
      clock.durationMs && clock.durationMs > 0
        ? loopIndex * clock.durationMs
        : 0;
    return (
      clock.anchorWallMs +
      (shot.tMs + loopMs - clock.playFromMs) +
      clock.delayMs -
      HUD_HOLD_MS +
      REPLAY_DETECT_LAG_MS
    );
  }

  /** (Re)compute the next fire from the current file clock. */
  private scheduleReplay(): void {
    this.clearReplayTimer();
    const r = this.replay;
    if (!r || this.disposed) return;
    const fc = this.fileClock();
    if (!fc) {
      r.clockSig = null;
      r.nextFireAt = null;
      return;
    }
    const now = this.now();
    const dur =
      fc.clock.durationMs && fc.clock.durationMs > 0
        ? fc.clock.durationMs
        : null;
    const sig = BasketballGameController.clockSig(fc);
    if (r.clockSig !== sig) {
      // New anchor (attach / scorer re-arm / sync / kick): seek the cursor to
      // the playhead instead of counting everything before it as skipped.
      r.clockSig = sig;
      const elapsed = now - fc.clock.anchorWallMs + fc.clock.playFromMs;
      r.loopIndex = dur ? Math.max(0, Math.floor(elapsed / dur)) : 0;
      r.cursor = 0;
    }
    for (;;) {
      if (r.cursor >= r.shots.length) {
        if (r.loop && dur && r.shots.length > 0) {
          r.loopIndex++;
          r.cursor = 0;
          continue;
        }
        r.nextFireAt = null;
        return;
      }
      const fireAt = this.replayFireAt(
        r.shots[r.cursor],
        r.loopIndex,
        fc.clock,
      );
      if (fireAt < now - REPLAY_LATE_MAX_MS) {
        r.cursor++;
        continue;
      }
      r.nextFireAt = fireAt;
      this.replayTimer = setTimeout(
        () => this.fireReplay(),
        Math.max(0, fireAt - now),
      );
      return;
    }
  }

  private fireReplay(): void {
    this.replayTimer = null;
    const r = this.replay;
    if (!r || this.disposed) return;
    const fc = this.fileClock();
    const shot = r.shots[r.cursor];
    if (!fc || !shot || BasketballGameController.clockSig(fc) !== r.clockSig) {
      this.scheduleReplay();
      return;
    }
    const now = this.now();
    const fireAt = this.replayFireAt(shot, r.loopIndex, fc.clock);
    if (Math.abs(fireAt - now) > REPLAY_LATE_MAX_MS) {
      this.scheduleReplay();
      return;
    }
    r.cursor++;
    if (!this.matchAcceptsShots()) {
      r.skipped++;
      this.scheduleReplay();
      this.broadcastState();
      return;
    }
    r.fired++;
    this.scheduleReplay();
    if (shot.made) {
      this.ingestShot({
        source: 'replay',
        aiTeam: shot.team,
        aiConfidence: 1,
        points: shot.points,
        gtPoints: shot.gtPoints,
        mediaMs: shot.tMs,
      });
    } else {
      this.ingestMiss(shot.team, now);
    }
  }

  /** Tick: follow clock changes (attach / sync / kick) and keep the panel countdown fresh. */
  private checkReplayClock(now: number): void {
    const r = this.replay;
    if (!r) return;
    const fc = this.fileClock();
    const sig = fc ? BasketballGameController.clockSig(fc) : null;
    if (sig !== r.clockSig) this.scheduleReplay();
    if (now - this.lastReplayBroadcastAt >= REPLAY_BROADCAST_MS) {
      this.lastReplayBroadcastAt = now;
      this.broadcastState();
    }
  }

  /** Enable (or re-configure) the scorer on the hoop input with the full param set. */
  private armHoopAi(): void {
    const hoop = this.cams.get('hoop');
    if (!hoop?.inputId) return;
    const inputId = hoop.inputId;
    void this.deps
      .setBasketballScorer(inputId, true, this.workerParams())
      .catch((err) =>
        console.error(`[bb] scorer enable failed for ${inputId}`, err),
      );
  }

  /**
   * Worker params, flattened to scalars (the sidecar param channel is
   * Record<string, number | string>). The worker replaces params wholesale
   * on configure, so every push sends the full set.
   */
  private workerParams(): Record<string, number | string> {
    const d = this.config.detector;
    const rim = this.config.rim;
    return {
      analysisFps: d.analysisFps,
      imgsz: d.imgsz,
      ballConf: d.ballConf,
      ballDetector: d.ballDetector,
      yoloWeights: d.yoloWeights,
      rimSet: rim ? 1 : 0,
      rimCx: rim?.cx ?? 0.5,
      rimCy: rim?.cy ?? 0.35,
      rimRx: rim?.rx ?? 0.06,
      rimRy: rim?.ry ?? 0.02,
      teamColorA: this.config.teams.A.color,
      teamColorB: this.config.teams.B.color,
      captureShotFrames: this.config.shotFrames ? 1 : 0,
    };
  }

  /** Hoop phone: store the drawn rim ellipse and push it to the worker. */
  calibrateRim(clientId: string, raw: unknown): void {
    const cam = this.camByClient(clientId);
    if (!cam || cam.role !== 'hoop') {
      this.sendError(
        clientId,
        'not_joined',
        'Only the hoop camera can calibrate the rim.',
      );
      return;
    }
    const rim = this.parseRim(raw);
    if (!rim) {
      this.sendError(clientId, 'invalid_rim', 'Rim ellipse out of range.');
      return;
    }
    this.config.rim = rim;
    this.armHoopAi();
    this.broadcastState();
  }

  private parseRim(raw: unknown): BbRim | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { cx?: unknown; cy?: unknown; rx?: unknown; ry?: unknown };
    const cx = Number(r.cx);
    const cy = Number(r.cy);
    const rx = Number(r.rx);
    const ry = Number(r.ry);
    if (![cx, cy, rx, ry].every((v) => Number.isFinite(v))) return null;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return null;
    if (rx < 0.005 || rx > 0.5 || ry < 0.003 || ry > 0.5) return null;
    return {
      cx: Math.round(cx * 10_000) / 10_000,
      cy: Math.round(cy * 10_000) / 10_000,
      rx: Math.round(rx * 10_000) / 10_000,
      ry: Math.round(ry * 10_000) / 10_000,
    };
  }

  /** Hoop phone or moderator: a jersey colour sampled from the picture. */
  setTeamColor(clientId: string, rawTeam: unknown, rawColor: unknown): void {
    const cam = this.camByClient(clientId);
    const isModerator = this.commentator?.clientId === clientId;
    if (!(cam?.role === 'hoop') && !isModerator) {
      this.sendError(
        clientId,
        'not_commentator',
        'Only the hoop camera or the moderator can set team colours.',
      );
      return;
    }
    if (
      !isTeamId(rawTeam) ||
      typeof rawColor !== 'string' ||
      !HEX_COLOR.test(rawColor)
    ) {
      this.sendError(clientId, 'invalid_color', 'Team colour must be #rrggbb.');
      return;
    }
    this.config.teams[rawTeam].color = rawColor.toLowerCase();
    this.armHoopAi();
    this.publishHud();
    this.broadcastState();
  }

  // ── Commentator / moderator ───────────────────────────────────────────────

  joinCommentator(clientId: string, rawName: string, key?: string): void {
    this.engaged = true;
    const name = rawName.slice(0, 20).trim() || 'Moderator';
    const c = this.commentator;
    if (
      c &&
      (c.clientId === clientId ||
        (key != null && c.commentatorKey === key) ||
        (!c.connected && c.name === name))
    ) {
      c.clientId = clientId;
      c.name = name;
      c.connected = true;
    } else {
      if (c) this.retireCommentatorCam(c);
      this.commentator = {
        clientId,
        commentatorKey: key ?? randomUUID(),
        name,
        connected: true,
        inputId: null,
        camConnected: false,
        camWidth: null,
        camHeight: null,
      };
    }
    const cur = this.commentator!;
    this.deps.sendTo(clientId, {
      type: 'bb_commentator_joined',
      roomId: this.roomId,
      clientId,
      commentatorKey: cur.commentatorKey,
      name: cur.name,
      camInputActive: cur.inputId != null,
      phase: this.phase,
    });
    this.ensureRunning();
    this.broadcastState();
  }

  async startCommentatorCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) {
      this.sendError(
        clientId,
        'not_commentator',
        'Join as the moderator first.',
      );
      return;
    }
    this.retireCommentatorCam(c);
    if (dims) {
      c.camWidth = dims.width;
      c.camHeight = dims.height;
    }
    let offer: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      // Side channel kept: the commentator must ride the same 3 s delay as
      // the cameras, or "SCORE!" reaches the air before the ball drops.
      offer = await this.deps.registerGameCam(`🎙 ${c.name}`, dims, {
        ai: true,
      });
    } catch (err) {
      console.error(
        `[bb] commentator cam register failed for ${clientId}`,
        err,
      );
      return;
    }
    if (this.disposed || this.commentator !== c || c.inputId != null) {
      void this.deps.removeInput(offer.inputId).catch(() => {});
      return;
    }
    c.inputId = offer.inputId;
    c.camConnected = false;
    this.deps.sendTo(clientId, {
      type: 'bb_cam_offer',
      roomId: this.roomId,
      clientId,
      role: 'commentator',
      inputId: offer.inputId,
      whipUrl: offer.whipUrl,
      bearerToken: offer.bearerToken,
    });
    void this.restage();
    this.ensureRunning();
    this.broadcastState();
  }

  leaveCommentator(clientId: string): void {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) return;
    this.retireCommentatorCam(c);
    this.commentator = null;
    if (
      this.viewOverride.mode === 'scene' &&
      (this.viewOverride.scene === 'caster' ||
        this.viewOverride.scene === 'split')
    ) {
      this.clearViewOverride();
    }
    void this.restage();
    this.broadcastState();
    this.maybeStop();
  }

  private retireCommentatorCam(c: CommentatorState): void {
    if (c.inputId == null) return;
    const inputId = c.inputId;
    c.inputId = null;
    c.camConnected = false;
    void this.deps.removeInput(inputId).catch(() => {});
  }

  /** True when `clientId` is the joined moderator; emits the error if not. */
  private requireCommentator(clientId: string, what: string): boolean {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) {
      this.sendError(
        clientId,
        'not_commentator',
        `Only the joined moderator can ${what}.`,
      );
      return false;
    }
    return true;
  }

  setViewOverride(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'switch the broadcast view')) return;
    const override = this.parseViewOverride(raw);
    if (!override) {
      this.sendError(clientId, 'invalid_view', 'Unknown view override.');
      return;
    }
    if (override.mode === 'scene') {
      const needs =
        override.scene === 'caster' || override.scene === 'split'
          ? this.commentator?.inputId != null
          : override.scene === 'hoop'
            ? this.cams.get('hoop')?.inputId != null
            : override.scene === 'court'
              ? this.cams.get('court')?.inputId != null
              : true;
      if (!needs) {
        this.sendError(
          clientId,
          'invalid_view',
          'That view needs its camera publishing.',
        );
        return;
      }
    }
    this.viewOverride = override;
    this.syncScene();
    this.deps.broadcast(this.stateSnapshot());
  }

  private parseViewOverride(raw: unknown): BbViewOverride | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as { mode?: unknown; scene?: unknown };
    if (o.mode === 'auto') return { mode: 'auto' };
    if (o.mode === 'scene') {
      switch (o.scene) {
        case 'live':
        case 'hoop':
        case 'court':
        case 'caster':
        case 'split':
          return { mode: 'scene', scene: o.scene };
        default:
          return null;
      }
    }
    return null;
  }

  private clearViewOverride(): void {
    if (this.viewOverride.mode === 'auto') return;
    this.viewOverride = { mode: 'auto' };
    this.syncScene();
    this.deps.broadcast(this.stateSnapshot());
  }

  setCasterPip(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'toggle the cam PiP')) return;
    if (typeof raw !== 'boolean') {
      this.sendError(clientId, 'invalid_view', 'Invalid cam PiP toggle.');
      return;
    }
    if (this.casterPip === raw) return;
    this.casterPip = raw;
    void this.restage();
    this.deps.broadcast(this.stateSnapshot());
  }

  commentatorControlMatch(clientId: string, cmd: BbMatchCommand): void {
    if (!this.requireCommentator(clientId, 'control the match')) return;
    const { error } = this.controlMatch(cmd);
    if (error)
      this.sendError(clientId, error.code, error.message, error.context);
  }

  // ── Disconnects / reaped inputs ───────────────────────────────────────────

  /**
   * WS dropped. Cameras keep their slot AND input (the WHIP publish outlives
   * a dropped control socket; the stale sweep reaps a dead publish later);
   * a re-join with the camKey — or by anyone once disconnected — adopts it.
   */
  handleDisconnect(clientId: string): void {
    if (this.commentator?.clientId === clientId) {
      this.commentator.connected = false;
      this.broadcastState();
      return;
    }
    const cam = this.camByClient(clientId);
    if (!cam) return;
    cam.connected = false;
    cam.disconnectedAt = this.now();
    this.broadcastState();
  }

  /** The room reaped inputs behind our back (stale-WHIP sweep). */
  onInputsRemoved(inputIds: string[]): void {
    if (this.disposed) return;
    const gone = new Set(inputIds);
    let changed = false;
    const c = this.commentator;
    if (c?.inputId != null && gone.has(c.inputId)) {
      c.inputId = null;
      c.camConnected = false;
      changed = true;
    }
    for (const cam of this.cams.values()) {
      if (cam.inputId != null && gone.has(cam.inputId)) {
        cam.inputId = null;
        cam.camConnected = false;
        cam.camDownAt = null;
        cam.ballTracked = false;
        if (cam.role === 'hoop') this.ballZone = 'none';
        changed = true;
      }
    }
    if (!changed) return;
    void this.restage();
    this.broadcastState();
  }

  /** RoomState pokes this after record start/stop (every room, every game). */
  notifyRecordingChanged(): void {
    if (!this.engaged) {
      this.deps.broadcast(this.stateSnapshot());
      return;
    }
    this.broadcastState();
  }

  // ── Config ────────────────────────────────────────────────────────────────

  setConfig(
    partial: {
      teams?: Partial<
        Record<BbTeamId, Partial<{ name: string; color: string }>>
      >;
      teamSize?: number;
      targetPoints?: number;
      durationMs?: number;
      otWinPoints?: number;
      arcPoints?: number;
      autoAssignMinConf?: number;
      shotFrames?: boolean;
      scoreLingerMs?: number;
      rim?: BbRim | null;
      detector?: Partial<BbConfig['detector']>;
      perf?: Partial<BbConfig['perf']>;
      joinUrls?: Partial<Record<'hoop' | 'court' | 'commentator', string>>;
      joinLabel?: string;
    } = {},
  ): BbConfig {
    this.engaged = true;
    const c = this.config;
    let aiParamsChanged = false;
    if (partial.teams) {
      for (const team of BB_TEAM_IDS) {
        const t = partial.teams[team];
        if (!t) continue;
        if (typeof t.name === 'string') {
          c.teams[team].name = t.name.slice(0, 16).trim() || c.teams[team].name;
        }
        if (typeof t.color === 'string' && HEX_COLOR.test(t.color)) {
          const next = t.color.toLowerCase();
          if (next !== c.teams[team].color) aiParamsChanged = true;
          c.teams[team].color = next;
        }
      }
    }
    if (
      partial.teamSize === 1 ||
      partial.teamSize === 2 ||
      partial.teamSize === 3
    ) {
      c.teamSize = partial.teamSize;
    }
    if (
      typeof partial.targetPoints === 'number' &&
      Number.isFinite(partial.targetPoints)
    ) {
      c.targetPoints = clamp(Math.round(partial.targetPoints), 1, 99);
    }
    if (
      typeof partial.durationMs === 'number' &&
      Number.isFinite(partial.durationMs)
    ) {
      c.durationMs = clamp(
        Math.round(partial.durationMs),
        DURATION_MIN_MS,
        DURATION_MAX_MS,
      );
    }
    if (
      typeof partial.otWinPoints === 'number' &&
      Number.isFinite(partial.otWinPoints)
    ) {
      c.otWinPoints = clamp(Math.round(partial.otWinPoints), 1, 20);
    }
    if (partial.arcPoints === 1 || partial.arcPoints === 2) {
      c.arcPoints = partial.arcPoints;
    }
    if (
      typeof partial.autoAssignMinConf === 'number' &&
      Number.isFinite(partial.autoAssignMinConf)
    ) {
      c.autoAssignMinConf = clamp(partial.autoAssignMinConf, 0, 1);
    }
    if (typeof partial.shotFrames === 'boolean') {
      if (partial.shotFrames !== c.shotFrames) aiParamsChanged = true;
      c.shotFrames = partial.shotFrames;
    }
    if (
      typeof partial.scoreLingerMs === 'number' &&
      Number.isFinite(partial.scoreLingerMs)
    ) {
      c.scoreLingerMs = clamp(Math.round(partial.scoreLingerMs), 0, 10_000);
    }
    if (partial.rim !== undefined) {
      const rim = partial.rim === null ? null : this.parseRim(partial.rim);
      if (partial.rim === null || rim) {
        c.rim = rim;
        aiParamsChanged = true;
      }
    }
    if (partial.detector) {
      const d = partial.detector;
      if (
        d.ballDetector === 'auto' ||
        d.ballDetector === 'yolo' ||
        d.ballDetector === 'hsv'
      ) {
        c.detector.ballDetector = d.ballDetector;
      }
      if (
        d.yoloWeights === 'auto' ||
        d.yoloWeights === 'yolo11n.pt' ||
        d.yoloWeights === 'yolo11s.pt' ||
        d.yoloWeights === 'yolo11m.pt'
      ) {
        c.detector.yoloWeights = d.yoloWeights;
      }
      if (typeof d.imgsz === 'number' && Number.isFinite(d.imgsz)) {
        c.detector.imgsz = clamp(Math.round(d.imgsz / 32) * 32, 320, 1280);
      }
      if (typeof d.ballConf === 'number' && Number.isFinite(d.ballConf)) {
        c.detector.ballConf = clamp(d.ballConf, 0.05, 0.9);
      }
      if (typeof d.analysisFps === 'number' && Number.isFinite(d.analysisFps)) {
        c.detector.analysisFps = clamp(
          Math.round(d.analysisFps),
          ANALYSIS_FPS_MIN,
          ANALYSIS_FPS_MAX,
        );
      }
      aiParamsChanged = true;
    }
    if (partial.perf) {
      const p = partial.perf;
      if (p.animTickHz === 60 || p.animTickHz === 30 || p.animTickHz === 15) {
        c.perf.animTickHz = p.animTickHz;
      }
      if (
        p.hudPublishHz === 10 ||
        p.hudPublishHz === 5 ||
        p.hudPublishHz === 2
      ) {
        c.perf.hudPublishHz = p.hudPublishHz;
      }
      if (
        p.recordingPreset === 'ultrafast' ||
        p.recordingPreset === 'superfast' ||
        p.recordingPreset === 'veryfast' ||
        p.recordingPreset === 'fast' ||
        p.recordingPreset === 'medium'
      ) {
        c.perf.recordingPreset = p.recordingPreset;
      }
      if (
        p.recordingScale === 1 ||
        p.recordingScale === 0.75 ||
        p.recordingScale === 0.5
      ) {
        c.perf.recordingScale = p.recordingScale;
      }
      this.hudMinIntervalMs = Math.round(1000 / c.perf.hudPublishHz);
      this.deps.setAnimTickMs(Math.round(1000 / c.perf.animTickHz));
    }
    if (typeof partial.joinLabel === 'string') {
      this.joinLabel = partial.joinLabel.slice(0, 64) || null;
    }
    if (partial.joinUrls) {
      for (const key of ['hoop', 'court', 'commentator'] as const) {
        const url = partial.joinUrls[key];
        if (typeof url !== 'string' || !url || url === this.joinUrls[key])
          continue;
        this.joinUrls[key] = url;
        this.qrImageIds[key] = null;
        void this.deps
          .registerJoinQr(url)
          .then((imageId) => {
            if (this.disposed || this.joinUrls[key] !== url) return;
            this.qrImageIds[key] = imageId;
            this.publishHud();
          })
          .catch((err) =>
            console.error(`[bb] join QR registration failed (${key})`, err),
          );
      }
    }
    if (aiParamsChanged) this.armHoopAi();
    this.broadcastState();
    return structuredClone(this.config);
  }

  // ── Match flow ────────────────────────────────────────────────────────────

  controlMatch(cmd: BbMatchCommand): {
    state: BbStateEvent;
    match: BbMatchEvent;
    error?: BbMatchError;
  } {
    this.engaged = true;
    const error = this.applyMatchAction(cmd);
    if (!error) {
      // Any flow action returns the broadcast to AUTO.
      if (this.viewOverride.mode !== 'auto')
        this.viewOverride = { mode: 'auto' };
      this.syncScene();
      this.deps.broadcast(this.getMatchSnapshot());
      this.broadcastState();
    }
    return {
      state: this.stateSnapshot(),
      match: this.getMatchSnapshot(),
      ...(error ? { error } : {}),
    };
  }

  private applyMatchAction(cmd: BbMatchCommand): BbMatchError | null {
    const now = this.now();
    switch (cmd.action) {
      case 'lobby':
        if (this.phase !== 'lobby' && this.phase !== 'ended') {
          return {
            code: 'bad_action',
            message: 'End or reset the match before returning to the lobby.',
          };
        }
        this.resetMatch();
        return null;
      case 'start':
        if (this.phase !== 'lobby') {
          return { code: 'bad_action', message: 'The match already started.' };
        }
        this.resetMatch();
        this.phase = 'live';
        this.period = 'reg';
        this.matchStartedAt = now;
        this.segmentStartedAt = now;
        this.ensureRunning();
        return null;
      case 'pause':
        if (this.phase !== 'live' && this.phase !== 'overtime') {
          return { code: 'bad_action', message: 'Nothing to pause.' };
        }
        this.freezeClock(now);
        this.pausedFrom = this.phase;
        this.phase = 'paused';
        return null;
      case 'resume':
        if (this.phase !== 'paused') {
          return { code: 'bad_action', message: 'The match is not paused.' };
        }
        this.phase = this.pausedFrom;
        this.segmentStartedAt = now;
        return null;
      case 'end':
        if (
          this.phase !== 'live' &&
          this.phase !== 'paused' &&
          this.phase !== 'overtime'
        ) {
          return { code: 'bad_action', message: 'No running match to end.' };
        }
        this.endMatch(this.leaderByScore(), false, now);
        return null;
      case 'start_overtime':
        if (this.phase === 'live' || this.phase === 'paused') {
          this.enterOvertime(now);
          return null;
        }
        if (this.phase === 'ended' && this.leaderByScore() == null) {
          this.reopen(now, 'overtime');
          return null;
        }
        return {
          code: 'bad_action',
          message: 'Overtime needs a running match or a tied final.',
        };
      case 'reset':
        this.resetMatch();
        return null;
      case 'kick_cam': {
        const cam = cmd.role ? this.cams.get(cmd.role) : undefined;
        if (!cam) return { code: 'bad_action', message: 'No such camera.' };
        this.releaseCamSlot(cam);
        void this.restage();
        return null;
      }
      case 'kick_commentator':
        if (!this.commentator) {
          return { code: 'bad_action', message: 'No moderator joined.' };
        }
        this.retireCommentatorCam(this.commentator);
        this.commentator = null;
        void this.restage();
        return null;
      default:
        return { code: 'bad_action', message: 'Unknown action.' };
    }
  }

  /** Back to a clean lobby: clock + ledger cleared, cameras kept. */
  private resetMatch(): void {
    this.phase = 'lobby';
    this.period = 'reg';
    this.pausedFrom = 'live';
    this.matchStartedAt = null;
    this.segmentStartedAt = null;
    this.regElapsedBeforeSegmentMs = 0;
    this.otElapsedBeforeSegmentMs = 0;
    this.regExpiredAt = null;
    this.endedAt = null;
    this.endedByShot = false;
    this.winner = null;
    this.shots = [];
    this.attempts = [];
    this.shotSeq = 0;
    this.attemptSeq = 0;
    this.lastShot = null;
    this.banner = null;
    this.recompute();
  }

  private freezeClock(now: number): void {
    if (this.segmentStartedAt == null) return;
    const ran = Math.max(0, now - this.segmentStartedAt);
    if (this.period === 'reg') this.regElapsedBeforeSegmentMs += ran;
    else this.otElapsedBeforeSegmentMs += ran;
    this.segmentStartedAt = null;
  }

  private regElapsed(now: number): number {
    const running =
      this.period === 'reg' &&
      this.phase === 'live' &&
      this.segmentStartedAt != null
        ? now - this.segmentStartedAt
        : 0;
    return Math.min(
      this.config.durationMs,
      this.regElapsedBeforeSegmentMs + Math.max(0, running),
    );
  }

  private otElapsed(now: number): number {
    const running =
      this.period === 'ot' &&
      this.phase === 'overtime' &&
      this.segmentStartedAt != null
        ? now - this.segmentStartedAt
        : 0;
    return this.otElapsedBeforeSegmentMs + Math.max(0, running);
  }

  private remainingMs(now: number): number {
    if (this.period !== 'reg' || this.matchStartedAt == null) return 0;
    return Math.max(0, this.config.durationMs - this.regElapsed(now));
  }

  private periodElapsed(now: number): number {
    return this.period === 'reg' ? this.regElapsed(now) : this.otElapsed(now);
  }

  private enterOvertime(now: number): void {
    this.freezeClock(now);
    this.regElapsedBeforeSegmentMs = this.config.durationMs;
    this.regExpiredAt = null;
    this.period = 'ot';
    this.phase = 'overtime';
    this.segmentStartedAt = now;
    this.setBanner('overtime', 'OVERTIME', '#ffd21f', now);
    this.deps.broadcast(this.getMatchSnapshot());
    this.publishHud();
  }

  private endMatch(
    winner: BbTeamId | null,
    byShot: boolean,
    now: number,
  ): void {
    this.freezeClock(now);
    this.phaseBeforeEnd =
      this.phase === 'paused'
        ? this.pausedFrom
        : this.phase === 'overtime'
          ? 'overtime'
          : 'live';
    this.regExpiredAt = null;
    this.phase = 'ended';
    this.endedAt = now;
    this.endedByShot = byShot;
    this.winner = winner;
    const color = winner ? this.config.teams[winner].color : '#f4efe6';
    this.setBanner(
      'final',
      winner ? `${this.config.teams[winner].name} WINS` : 'FINAL — DRAW',
      color,
      now,
    );
    this.deps.broadcast(this.getMatchSnapshot());
    this.publishHud();
  }

  /** A moderator edit un-ended the match: continue where the clock froze. */
  private reopen(now: number, as?: 'live' | 'overtime'): void {
    const target = as ?? this.phaseBeforeEnd;
    this.endedAt = null;
    this.endedByShot = false;
    this.winner = null;
    this.banner = null;
    if (target === 'overtime') {
      if (this.period !== 'ot') {
        this.regElapsedBeforeSegmentMs = this.config.durationMs;
        this.period = 'ot';
      }
      this.phase = 'overtime';
    } else {
      this.phase = 'live';
    }
    this.segmentStartedAt = now;
    this.ensureRunning();
    this.deps.broadcast(this.getMatchSnapshot());
  }

  private leaderByScore(): BbTeamId | null {
    const a = this.tally.A.score;
    const b = this.tally.B.score;
    return a === b ? null : a > b ? 'A' : 'B';
  }

  /** Ledger edits may satisfy — or un-satisfy — the end condition. */
  private checkEnd(now: number): void {
    const target = this.config.targetPoints;
    const otWin = this.config.otWinPoints;
    const byTarget = (): BbTeamId | null => {
      const a = this.tally.A.score >= target;
      const b = this.tally.B.score >= target;
      if (a && b) return this.leaderByScore();
      return a ? 'A' : b ? 'B' : null;
    };
    const byOt = (): BbTeamId | null => {
      const a = this.tally.A.otScore >= otWin;
      const b = this.tally.B.otScore >= otWin;
      if (a && b) {
        return this.tally.A.otScore === this.tally.B.otScore
          ? null
          : this.tally.A.otScore > this.tally.B.otScore
            ? 'A'
            : 'B';
      }
      return a ? 'A' : b ? 'B' : null;
    };
    if (
      this.phase === 'live' ||
      (this.phase === 'paused' && this.pausedFrom === 'live')
    ) {
      const w = byTarget();
      if (w) this.endMatch(w, true, now);
      return;
    }
    if (
      this.phase === 'overtime' ||
      (this.phase === 'paused' && this.pausedFrom === 'overtime')
    ) {
      const w = byOt() ?? byTarget();
      if (w) this.endMatch(w, true, now);
      return;
    }
    if (this.phase === 'ended' && this.endedByShot) {
      const still = this.period === 'ot' ? (byOt() ?? byTarget()) : byTarget();
      if (!still) this.reopen(now);
      else if (still !== this.winner) {
        this.winner = still;
        this.deps.broadcast(this.getMatchSnapshot());
      }
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  private matchAcceptsShots(): boolean {
    return (
      this.phase === 'live' ||
      this.phase === 'paused' ||
      this.phase === 'overtime'
    );
  }

  private scores(): Record<BbTeamId, number> {
    return { A: this.tally.A.score, B: this.tally.B.score };
  }

  /** Derive every score/stat from the ledger (edits are just re-derivations). */
  private recompute(): void {
    this.tally = { A: emptyTally(), B: emptyTally() };
    let leader: BbTeamId | null = null;
    let leadChanges = 0;
    for (const shot of this.shots) {
      if (shot.status !== 'confirmed' || !shot.team) continue;
      const t = this.tally[shot.team];
      t.score += shot.points;
      if (shot.period === 'ot') t.otScore += shot.points;
      t.makes += 1;
      t.attempts += 1;
      if (shot.points === 2) t.twos += 1;
      const top =
        this.tally.A.score === this.tally.B.score
          ? null
          : this.tally.A.score > this.tally.B.score
            ? 'A'
            : 'B';
      if (top && top !== leader) {
        if (leader != null) leadChanges += 1;
        leader = top;
      }
    }
    this.leader = leader;
    this.leadChanges = leadChanges;
    this.unattributedMisses = 0;
    for (const a of this.attempts) {
      if (a.made) continue;
      if (a.team) this.tally[a.team].attempts += 1;
      else this.unattributedMisses += 1;
    }
  }

  /** Recompute, then announce a lead change when the leader flipped. */
  private afterLedgerChange(now: number): void {
    const before = this.leader;
    this.recompute();
    if (this.leader && this.leader !== before && before != null) {
      this.deps.broadcast({
        type: 'bb_lead_change',
        roomId: this.roomId,
        team: this.leader,
        scores: this.scores(),
      });
      this.setBanner(
        'lead_change',
        `${this.config.teams[this.leader].name} TAKES THE LEAD`,
        this.config.teams[this.leader].color,
        now,
      );
    }
  }

  private setBanner(
    kind: NonNullable<BbHudState['banner']>['kind'],
    text: string,
    color: string,
    at: number,
  ): void {
    this.banner = { kind, text, color, at };
  }

  private ingestShot(input: ShotInput): BbShotEvent | null {
    const now = this.now();
    if (!this.matchAcceptsShots()) {
      if (input.source === 'manual') return null;
      // Lobby warm-up (or a make after the final): feedback for the hoop
      // phone's setup screen, never in the ledger.
      const shot = this.buildShot(input, now, null, 'voided');
      this.deps.broadcast({
        type: 'bb_shot',
        roomId: this.roomId,
        kind: 'warmup',
        shot,
        scores: this.scores(),
      });
      return shot;
    }
    const team =
      input.source === 'manual'
        ? (input.team ?? null)
        : input.aiConfidence >= this.config.autoAssignMinConf
          ? input.aiTeam
          : null;
    const shot = this.buildShot(
      input,
      now,
      team,
      team ? 'confirmed' : 'pending',
    );
    this.shots.push(shot);
    this.afterLedgerChange(now);
    this.lastShot = { shot, at: now };
    if (shot.frameUrl) void this.armFrameImage(shot.frameUrl);
    if (shot.releaseFrameUrl) void this.armFrameImage(shot.releaseFrameUrl);
    this.deps.broadcast({
      type: 'bb_shot',
      roomId: this.roomId,
      kind: input.source === 'manual' ? 'manual' : 'made',
      shot: { ...shot },
      scores: this.scores(),
    });
    // Predictive cut: the layout flips to the hoop cam NOW (the ball is still
    // in the air on the delayed video); the score/banner ride the 3 s hold.
    this.syncScene();
    this.publishHud();
    this.checkEnd(now);
    this.broadcastState();
    this.ensureRunning();
    return shot;
  }

  private buildShot(
    input: ShotInput,
    now: number,
    team: BbTeamId | null,
    status: BbShotEvent['status'],
  ): BbShotEvent {
    let mediaMs = input.mediaMs;
    if (mediaMs == null) {
      const fc = this.fileClock();
      if (fc)
        mediaMs = Math.round(BasketballGameController.mediaAt(fc.clock, now));
    }
    return {
      id: randomUUID(),
      index:
        status === 'voided' && !this.matchAcceptsShots() ? 0 : ++this.shotSeq,
      atMs: now,
      ...(input.sourceT != null ? { sourceT: input.sourceT } : {}),
      ...(mediaMs != null ? { mediaMs } : {}),
      team,
      points: input.points ?? 1,
      ...(input.gtPoints != null ? { gtPoints: input.gtPoints } : {}),
      aiTeam: input.aiTeam,
      aiConfidence: clamp(input.aiConfidence, 0, 1),
      colorSample: input.colorSample ?? null,
      source: input.source,
      status,
      period: this.period,
      clockMs: this.periodElapsed(now),
      ...(input.frameUrl ? { frameUrl: input.frameUrl } : {}),
      ...(input.releaseFrameUrl
        ? { releaseFrameUrl: input.releaseFrameUrl }
        : {}),
    };
  }

  /** Moderator edit: assign a team / change value / void / un-void. */
  resolveShot(cmd: {
    shotId: string;
    team?: BbTeamId | null;
    points?: 1 | 2;
    voided?: boolean;
  }): BbShotEvent | null {
    const shot = this.shots.find((s) => s.id === cmd.shotId);
    if (!shot) return null;
    const now = this.now();
    let kind: 'assigned' | 'voided' = 'assigned';
    if (cmd.voided === true) {
      shot.status = 'voided';
      kind = 'voided';
    } else {
      if (cmd.team !== undefined) shot.team = cmd.team;
      if (cmd.points) shot.points = cmd.points;
      shot.status = shot.team ? 'confirmed' : 'pending';
    }
    this.afterLedgerChange(now);
    this.deps.broadcast({
      type: 'bb_shot',
      roomId: this.roomId,
      kind,
      shot: { ...shot },
      scores: this.scores(),
    });
    this.publishHud();
    this.checkEnd(now);
    this.broadcastState();
    return shot;
  }

  /** Moderator: points the AI could not see (or a correction). */
  addManualShot(team: BbTeamId, points: 1 | 2): BbShotEvent | null {
    if (this.phase === 'lobby') return null;
    if (this.phase === 'ended') {
      // Corrections after the final still go through the ledger; the end
      // condition is re-evaluated (a tied final may re-open).
      const now = this.now();
      const shot = this.buildShot(
        { source: 'manual', aiTeam: null, aiConfidence: 1, team, points },
        now,
        team,
        'confirmed',
      );
      this.shots.push(shot);
      this.afterLedgerChange(now);
      this.deps.broadcast({
        type: 'bb_shot',
        roomId: this.roomId,
        kind: 'manual',
        shot: { ...shot },
        scores: this.scores(),
      });
      this.publishHud();
      this.checkEnd(now);
      this.broadcastState();
      return shot;
    }
    return this.ingestShot({
      source: 'manual',
      aiTeam: null,
      aiConfidence: 1,
      team,
      points,
    });
  }

  /** Void the given shot, else the newest non-voided one. */
  undoShot(shotId?: string): BbShotEvent | null {
    const target = shotId
      ? this.shots.find((s) => s.id === shotId)
      : [...this.shots].reverse().find((s) => s.status !== 'voided');
    if (!target || target.status === 'voided') return null;
    const now = this.now();
    target.status = 'voided';
    this.afterLedgerChange(now);
    this.deps.broadcast({
      type: 'bb_shot',
      roomId: this.roomId,
      kind: 'undone',
      shot: { ...target },
      scores: this.scores(),
    });
    this.publishHud();
    this.checkEnd(now);
    this.broadcastState();
    return target;
  }

  /** Dev hook (BB_SIM=1): fabricate an AI make with a given attribution. */
  simulateShot(
    team: BbTeamId | null,
    confidence: number,
    points: 1 | 2 = 1,
  ): BbShotEvent | null {
    return this.ingestShot({
      source: 'ai',
      aiTeam: team,
      aiConfidence: confidence,
      points,
    });
  }

  private async armFrameImage(url: string): Promise<void> {
    if (this.frameImageIds.has(url)) return;
    const id = await this.deps.registerShotFrameImage(url).catch(() => null);
    if (this.disposed || !id) return;
    this.frameImageIds.set(url, id);
    // Re-publish so the still lands with (or right after) the banner.
    this.publishHud();
  }

  // ── Worker feed ───────────────────────────────────────────────────────────

  /** Raw basketball-scorer result for one input (only the hoop cam matters). */
  onWorkerResult(inputId: string, data: BbWorkerResult): void {
    if (this.disposed) return;
    const hoop = this.cams.get('hoop');
    if (!hoop || hoop.inputId !== inputId) return;
    const now = this.now();
    if (
      typeof data.session === 'string' &&
      data.session !== this.workerSession
    ) {
      // Worker restart / camera reconnect: event indices start over.
      this.workerSession = data.session;
      this.lastMadeIndex = -1;
      this.lastAttemptIndex = -1;
    }
    const tracked = data.ball != null;
    const zone = data.zone ?? 'none';
    if (tracked !== hoop.ballTracked) {
      hoop.ballTracked = tracked;
      if (now - this.lastBallStateBroadcastAt >= BALL_STATE_BROADCAST_MIN_MS) {
        this.lastBallStateBroadcastAt = now;
        this.deps.broadcast(this.stateSnapshot());
      }
    }
    this.ballZone = zone;
    if (hoop.clientId) {
      const sig = `${tracked}:${zone}:${data.ball?.src ?? ''}`;
      if (
        sig !== this.lastBallSig &&
        now - this.lastBallEventAt >= BALL_EVENT_MIN_MS
      ) {
        this.lastBallSig = sig;
        this.lastBallEventAt = now;
        this.deps.sendTo(hoop.clientId, {
          type: 'bb_ball',
          roomId: this.roomId,
          tracked,
          zone,
          source: data.ball?.src ?? null,
        });
      }
    }
    for (const ev of data.events ?? []) {
      if (!ev || typeof ev !== 'object') continue;
      if (ev.type === 'shot_made') {
        if (typeof ev.index !== 'number' || ev.index <= this.lastMadeIndex)
          continue;
        this.lastMadeIndex = ev.index;
        // Ground-truth replay owns the ledger; the model only tracks the ball.
        if (this.replay) continue;
        this.ingestShot({
          source: 'ai',
          aiTeam: isTeamId(ev.team) ? ev.team : null,
          aiConfidence:
            typeof ev.teamConfidence === 'number' ? ev.teamConfidence : 0,
          colorSample:
            typeof ev.colorSample === 'string' ? ev.colorSample : null,
          ...(typeof ev.t === 'number' ? { sourceT: ev.t } : {}),
          ...(typeof ev.frameFile === 'string'
            ? { frameUrl: `/bb-shot-frames/${ev.frameFile}` }
            : {}),
          ...(typeof ev.releaseFrameFile === 'string'
            ? { releaseFrameUrl: `/bb-shot-frames/${ev.releaseFrameFile}` }
            : {}),
        });
      } else if (ev.type === 'shot_attempt') {
        if (typeof ev.index !== 'number' || ev.index <= this.lastAttemptIndex)
          continue;
        this.lastAttemptIndex = ev.index;
        // Made attempts are represented by the ledger; only misses count here.
        if (ev.result === 'made' || this.replay) continue;
        this.ingestMiss(isTeamId(ev.team) ? ev.team : null, now);
      }
    }
  }

  /** A missed attempt (AI or replay): FG% material, never in the ledger. */
  private ingestMiss(team: BbTeamId | null, now: number): void {
    if (!this.matchAcceptsShots()) return;
    this.attempts.push({
      index: ++this.attemptSeq,
      atMs: now,
      team,
      made: false,
    });
    this.recompute();
    this.broadcastState();
  }

  // ── Stage / layout ────────────────────────────────────────────────────────

  private camAspect(cam: {
    camWidth: number | null;
    camHeight: number | null;
  }): number {
    return cam.camWidth && cam.camHeight
      ? cam.camWidth / cam.camHeight
      : 16 / 9;
  }

  /** Contain-fit a centered row of tiles at their own aspect (KBT's tileRow). */
  private tileRow(cams: { inputId: string; aspect: number }[]): BbStageTile[] {
    if (cams.length === 0) return [];
    const { width: W, height: H } = this.deps.getResolution();
    const naturalWidths = cams.map((c) => Math.max(0.1, c.aspect) * H);
    const total = naturalWidths.reduce((a, b) => a + b, 0);
    const scale = total > W ? W / total : 1;
    const rowH = Math.round(H * scale);
    const y = Math.round((H - rowH) / 2);
    let x = (W - total * scale) / 2;
    return cams.map((c, i) => {
      const w = naturalWidths[i] * scale;
      const left = Math.round(x);
      const right = Math.round(x + w);
      x += w;
      return {
        inputId: c.inputId,
        x: left,
        y,
        width: right - left,
        height: rowH,
      };
    });
  }

  /** Effective forced scene, or null for AUTO (re-validated every compute). */
  private overrideScene(): BbHudScene | null {
    const o = this.viewOverride;
    if (o.mode !== 'scene') return null;
    const casterReady = this.commentator?.inputId != null;
    switch (o.scene) {
      case 'live':
        return 'live';
      case 'hoop':
        return this.cams.get('hoop')?.inputId != null ? 'hoop' : null;
      case 'court':
        return this.cams.get('court')?.inputId != null ? 'court' : null;
      case 'caster':
        return casterReady ? 'caster' : null;
      case 'split':
        return casterReady ? 'split' : null;
    }
  }

  /** Which broadcast scene the current match state maps to. */
  private computeScene(now = this.now()): BbHudScene {
    const forced = this.overrideScene();
    if (forced) return forced;
    if (this.phase === 'lobby') return 'lobby';
    const scoreWindow = HUD_HOLD_MS + this.config.scoreLingerMs;
    if (this.phase === 'ended' && this.endedAt != null) {
      const delay = this.endedByShot ? scoreWindow : HUD_HOLD_MS;
      if (now - this.endedAt >= delay) return 'ended';
    }
    if (this.lastShot && now - this.lastShot.at < scoreWindow) return 'score';
    return 'live';
  }

  /** Re-derive the scene and restage when it moved (the predictive cut). */
  private syncScene(now = this.now()): void {
    const scene = this.computeScene(now);
    if (scene === this.stagedScene) return;
    this.stagedScene = scene;
    void this.restage();
    // The panel's highlighted view tracks the broadcast.
    this.deps.broadcast(this.stateSnapshot());
  }

  /** Desired tiles + HUD stage descriptor for a scene. */
  private buildStage(scene: BbHudScene): {
    tiles: BbStageTile[];
    stage: BbHudStage;
  } {
    const res = this.deps.getResolution();
    const full = { x: 0, y: 0, width: res.width, height: res.height };
    const pipRect = bbPipRect(res);
    const hoopCam = this.cams.get('hoop') ?? null;
    const courtCam = this.cams.get('court') ?? null;
    const hoop = hoopCam?.inputId ?? null;
    const court = courtCam?.inputId ?? null;
    const cast = this.commentator?.inputId ?? null;
    const tiles: BbStageTile[] = [];
    const stage: BbHudStage = {
      scene,
      main: null,
      pip: null,
      caster: null,
      split: false,
    };
    const roleOf = (inputId: string): 'hoop' | 'court' | 'commentator' =>
      inputId === hoop ? 'hoop' : inputId === court ? 'court' : 'commentator';
    const place = (inputId: string, rect: typeof full) =>
      tiles.push({ inputId, ...rect });

    switch (scene) {
      case 'score':
      case 'hoop': {
        const main = hoop ?? court;
        if (main) {
          place(main, full);
          stage.main = roleOf(main);
        }
        if (scene === 'score' && main === hoop && court) {
          place(court, pipRect);
          stage.pip = { role: 'court', rect: pipRect };
        }
        break;
      }
      case 'court': {
        const main = court ?? hoop;
        if (main) {
          place(main, full);
          stage.main = roleOf(main);
        }
        break;
      }
      case 'caster': {
        const main = cast ?? court ?? hoop;
        if (main) {
          place(main, full);
          stage.main = roleOf(main);
        }
        break;
      }
      case 'split': {
        const left = court ?? hoop;
        if (cast && left) {
          const leftCam = left === court ? courtCam! : hoopCam!;
          tiles.push(
            ...this.tileRow([
              { inputId: left, aspect: this.camAspect(leftCam) },
              { inputId: cast, aspect: this.camAspect(this.commentator!) },
            ]),
          );
          stage.main = roleOf(left);
          stage.split = true;
          break;
        }
        // No commentator input after all — fall through to the live layout.
      }
      default: {
        // lobby / live / ended (and split without a caster)
        const main = court ?? hoop;
        if (main) {
          place(main, full);
          stage.main = roleOf(main);
        }
        if (main === court && hoop) {
          place(hoop, pipRect);
          stage.pip = { role: 'hoop', rect: pipRect };
        }
      }
    }

    if (cast && !tiles.some((t) => t.inputId === cast)) {
      const visible =
        this.casterPip &&
        scene !== 'caster' &&
        scene !== 'split' &&
        scene !== 'lobby' &&
        scene !== 'ended';
      const rect = kbtCasterCamRect(res, visible);
      place(cast, rect);
      if (visible) stage.caster = rect;
    }
    // Every known input must be mentioned (RoomState's unplaced-input
    // auto-append would resurrect a missing one fullscreen).
    for (const inputId of [hoop, court]) {
      if (inputId && !tiles.some((t) => t.inputId === inputId)) {
        place(inputId, kbtParkRect(res));
      }
    }
    return { tiles, stage };
  }

  private currentStage(): BbHudStage {
    return this.lastStage ?? this.buildStage(this.stagedScene).stage;
  }

  private async restage(): Promise<void> {
    await this.applyStage();
  }

  /**
   * Push the effective stage to the engine with KBT's enter/leave choreography:
   * an entering tile lands on its rect instantly and fades in, a leaving tile
   * holds its on-stage rect through a fade-out and parks on parkTimer,
   * staged→staged moves glide. Then re-merge the stage into the HUD at once.
   */
  private async applyStage(): Promise<void> {
    if (this.disposed) return;
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    const { tiles: all, stage } = this.buildStage(this.stagedScene);
    this.lastStage = stage;
    const staged = new Set(
      all.filter((t) => t.width > 1).map((t) => t.inputId),
    );
    this.lastDesiredTiles = all;
    const fade = { type: 'fade' as const, durationMs: KBT_VIEW_TRANSITION_MS };
    const now = this.now();
    let nextParkAt = Infinity;
    const decorated = all.map((t) => {
      const wasStaged = this.lastStagedInputIds.has(t.inputId);
      if (t.width > 1) {
        this.leavingTiles.delete(t.inputId);
        if (wasStaged) {
          return {
            ...t,
            transitionDurationMs: 300,
            transitionEasing: 'cubic_bezier_ease_in_out',
          };
        }
        this.deps.runInputTransition(t.inputId, { ...fade, direction: 'in' });
        return { ...t, transitionDurationMs: 0 };
      }
      const leaving = this.leavingTiles.get(t.inputId);
      if (leaving && leaving.until - PARK_LEAD_MS > now) {
        nextParkAt = Math.min(nextParkAt, leaving.until - PARK_LEAD_MS);
        return { ...t, ...leaving.rect, transitionDurationMs: 0 };
      }
      if (leaving) this.leavingTiles.delete(t.inputId);
      const rect = wasStaged ? this.lastAppliedRects.get(t.inputId) : undefined;
      if (rect) {
        this.leavingTiles.set(t.inputId, {
          rect,
          until: now + KBT_VIEW_TRANSITION_MS,
        });
        this.deps.runInputTransition(t.inputId, { ...fade, direction: 'out' });
        nextParkAt = Math.min(
          nextParkAt,
          now + KBT_VIEW_TRANSITION_MS - PARK_LEAD_MS,
        );
        return { ...t, ...rect, transitionDurationMs: 0 };
      }
      return { ...t, transitionDurationMs: 0 };
    });
    this.lastStagedInputIds = staged;
    this.lastAppliedRects = new Map(
      decorated.map((t) => [
        t.inputId,
        { x: t.x, y: t.y, width: t.width, height: t.height },
      ]),
    );
    if (nextParkAt < Infinity) {
      this.parkTimer = setTimeout(
        () => this.commitParks(),
        Math.max(0, nextParkAt - now),
      );
    }
    this.publishStageNow();
    try {
      await this.deps.layoutTiles(decorated);
    } catch (err) {
      console.error('[bb] layoutTiles failed', err);
    }
  }

  private commitParks(): void {
    this.parkTimer = null;
    const now = this.now();
    let nextAt = Infinity;
    const tiles = this.lastDesiredTiles.map((t) => {
      const leaving = this.leavingTiles.get(t.inputId);
      if (!leaving) {
        return t.width > 1
          ? {
              ...t,
              transitionDurationMs: 300,
              transitionEasing: 'cubic_bezier_ease_in_out',
            }
          : { ...t, transitionDurationMs: 0 };
      }
      if (leaving.until - PARK_LEAD_MS <= now) {
        this.leavingTiles.delete(t.inputId);
        return { ...t, transitionDurationMs: 0 };
      }
      nextAt = Math.min(nextAt, leaving.until - PARK_LEAD_MS);
      return { ...t, ...leaving.rect, transitionDurationMs: 0 };
    });
    this.lastAppliedRects = new Map(
      tiles.map((t) => [
        t.inputId,
        { x: t.x, y: t.y, width: t.width, height: t.height },
      ]),
    );
    if (nextAt < Infinity) {
      this.parkTimer = setTimeout(
        () => this.commitParks(),
        Math.max(0, nextAt - now),
      );
    }
    this.deps.layoutTiles(tiles).catch((err) => {
      console.error('[bb] park layoutTiles failed', err);
    });
  }

  // ── Clock + publish loop ──────────────────────────────────────────────────

  private ensureRunning(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private maybeStop(): void {
    if (
      this.phase === 'lobby' &&
      this.cams.size === 0 &&
      !this.commentator &&
      this.lastShot == null &&
      !this.replay
    ) {
      this.stop();
    }
  }

  private lastMatchBroadcastAt = 0;

  private tick(): void {
    const now = this.now();
    this.tickClock(now);
    this.pollCameras(now);
    this.checkReplayClock(now);
    this.syncScene(now);
    if (this.phase !== 'lobby') {
      if (now - this.lastMatchBroadcastAt >= MATCH_BROADCAST_MS) {
        this.lastMatchBroadcastAt = now;
        this.deps.broadcast(this.getMatchSnapshot());
      }
      if (now - this.lastPeriodicHudAt >= this.hudMinIntervalMs) {
        this.lastPeriodicHudAt = now;
        this.publishHud();
      }
    }
    this.maybeStop();
  }

  private tickClock(now: number): void {
    if (this.phase !== 'live' || this.period !== 'reg') return;
    if (this.regExpiredAt == null) {
      if (this.remainingMs(now) > 0) return;
      // Buzzer: freeze the clock at 0:00; the decision waits the shot grace.
      this.freezeClock(now);
      this.regElapsedBeforeSegmentMs = this.config.durationMs;
      this.regExpiredAt = now;
      this.deps.broadcast(this.getMatchSnapshot());
      return;
    }
    if (now - this.regExpiredAt < SHOT_GRACE_MS) return;
    const leader = this.leaderByScore();
    if (leader) this.endMatch(leader, false, now);
    else this.enterOvertime(now);
    this.deps.broadcast(this.getMatchSnapshot());
    this.broadcastState();
  }

  /** 1 Hz: reflect WHIP ack liveness into camConnected / SIGNAL LOST. */
  private pollCameras(now: number): void {
    if (now - this.lastCamPoll < 1000) return;
    this.lastCamPoll = now;
    const isLive = this.deps.isInputLive ?? this.deps.isInputConnected;
    let changed = false;
    for (const cam of this.cams.values()) {
      const connected = cam.inputId != null && isLive(cam.inputId);
      if (connected !== cam.camConnected) {
        cam.camConnected = connected;
        cam.camDownAt = connected ? null : now;
        if (!connected) cam.ballTracked = false;
        changed = true;
      }
    }
    const c = this.commentator;
    if (c) {
      const connected = c.inputId != null && isLive(c.inputId);
      if (connected !== c.camConnected) {
        c.camConnected = connected;
        changed = true;
      }
    }
    if (changed) this.broadcastState();
  }

  // ── Snapshots + HUD ───────────────────────────────────────────────────────

  private publicCam(role: BbCamRole): BbCam {
    const cam = this.cams.get(role);
    if (!cam) {
      return {
        role,
        name: '',
        joined: false,
        connected: false,
        camConnected: false,
        source: 'whip',
        calibrated: role === 'hoop' ? this.config.rim != null : false,
      };
    }
    const clip = this.clipSnapshot(cam, this.now());
    return {
      role,
      name: cam.name,
      joined: true,
      connected: cam.connected,
      camConnected: cam.camConnected,
      source: cam.source,
      ...(cam.source === 'file' && cam.fileName
        ? { fileName: cam.fileName }
        : {}),
      ...(clip ? { clip } : {}),
      ...(cam.camWidth && cam.camHeight
        ? { camWidth: cam.camWidth, camHeight: cam.camHeight }
        : {}),
      calibrated: role === 'hoop' ? this.config.rim != null : false,
      ...(role === 'hoop' ? { ballTracked: cam.ballTracked } : {}),
    };
  }

  private teamStats(team: BbTeamId): BbTeamStats {
    const t = this.tally[team];
    return {
      name: this.config.teams[team].name,
      color: this.config.teams[team].color,
      score: t.score,
      otScore: t.otScore,
      makes: t.makes,
      attempts: t.attempts,
      twos: t.twos,
    };
  }

  stateSnapshot(): BbStateEvent {
    return {
      type: 'bb_state',
      roomId: this.roomId,
      phase: this.phase,
      period: this.period,
      config: structuredClone(this.config),
      teams: { A: this.teamStats('A'), B: this.teamStats('B') },
      cams: { hoop: this.publicCam('hoop'), court: this.publicCam('court') },
      commentator: this.commentator
        ? {
            name: this.commentator.name,
            connected: this.commentator.connected,
            camConnected: this.commentator.camConnected,
          }
        : null,
      scene: this.stagedScene,
      viewOverride: { ...this.viewOverride },
      casterPip: this.casterPip,
      pending: [...this.shots]
        .filter((s) => s.status === 'pending')
        .reverse()
        .map((s) => ({ ...s })),
      recent: [...this.shots]
        .slice(-RECENT_SHOTS)
        .reverse()
        .map((s) => ({ ...s })),
      unattributedMisses: this.unattributedMisses,
      leadChanges: this.leadChanges,
      winner: this.winner,
      isRecording: this.deps.hasActiveRecording?.() ?? false,
      replay: this.replaySnapshot(),
    };
  }

  getMatchSnapshot(): BbMatchEvent {
    const now = this.now();
    return {
      type: 'bb_match',
      roomId: this.roomId,
      phase: this.phase,
      period: this.period,
      startedAtMs: this.matchStartedAt,
      remainingMs: this.remainingMs(now),
      elapsedMs: this.periodElapsed(now),
      scores: this.scores(),
      otScores: { A: this.tally.A.otScore, B: this.tally.B.otScore },
      winner: this.winner,
    };
  }

  private broadcastState(): void {
    this.deps.broadcast(this.stateSnapshot());
    this.publishHud();
  }

  /** Immediate re-merge of the current stage into whatever HUD is on air. */
  private publishStageNow(): void {
    if (this.disposed) return;
    if (!this.lastAppliedHud) {
      this.publishHud(true);
      return;
    }
    this.applyToDeps(this.lastAppliedHud);
  }

  private applyToDeps(state: BbHudState | null): void {
    const merged = state ? { ...state, stage: this.currentStage() } : null;
    this.lastAppliedHud = merged;
    this.deps.publishHud(merged);
  }

  /**
   * Publish the burned-in HUD data, held by HUD_HOLD_MS with a monotonic clamp
   * so snapshots land in order on the ~3 s-delayed video. The stage part is
   * re-merged at apply time (see BbHudStage). `immediate` bypasses the hold.
   */
  private publishHud(immediate = false): void {
    if (this.disposed) return;
    const now = this.now();
    const shot = this.lastShot;
    const banner =
      this.banner && now - this.banner.at <= BANNER_MS ? this.banner : null;
    const hoop = this.cams.get('hoop');
    const court = this.cams.get('court');
    const snapshot: BbHudState = {
      stage: this.currentStage(),
      teams: {
        A: { ...this.config.teams.A, score: this.tally.A.score },
        B: { ...this.config.teams.B, score: this.tally.B.score },
      },
      clock: {
        phase: this.phase,
        period: this.period,
        remainingMs: quantizeClock(this.remainingMs(now)),
        running: this.phase === 'live' || this.phase === 'overtime',
      },
      lastShot: shot
        ? {
            team: shot.shot.team,
            teamName: shot.shot.team
              ? this.config.teams[shot.shot.team].name
              : null,
            color: shot.shot.team
              ? this.config.teams[shot.shot.team].color
              : '#f4efe6',
            points: shot.shot.points,
            pending: shot.shot.status === 'pending',
            showBanner:
              shot.shot.status !== 'voided' && now - shot.at <= SCORE_BANNER_MS,
            frameImageId:
              (shot.shot.releaseFrameUrl
                ? this.frameImageIds.get(shot.shot.releaseFrameUrl)
                : undefined) ??
              (shot.shot.frameUrl
                ? this.frameImageIds.get(shot.shot.frameUrl)
                : undefined) ??
              null,
          }
        : null,
      pendingCount: this.shots.filter((s) => s.status === 'pending').length,
      cams: {
        hoop: {
          inputId: hoop?.inputId ?? null,
          live: hoop?.camConnected ?? false,
          name: hoop?.name ?? null,
        },
        court: {
          inputId: court?.inputId ?? null,
          live: court?.camConnected ?? false,
          name: court?.name ?? null,
        },
      },
      otWinPoints: this.config.otWinPoints,
      lobby:
        this.phase === 'lobby'
          ? {
              qr: {
                hoop: { imageId: this.qrImageIds.hoop, label: this.joinLabel },
                court: {
                  imageId: this.qrImageIds.court,
                  label: this.joinLabel,
                },
                commentator: {
                  imageId: this.qrImageIds.commentator,
                  label: this.joinLabel,
                },
              },
              cams: BB_CAM_ROLES.map((role) => {
                const cam = this.cams.get(role);
                return {
                  role,
                  name: cam?.name ?? '',
                  joined: cam != null,
                  live: cam?.camConnected ?? false,
                  calibrated: role === 'hoop' ? this.config.rim != null : false,
                };
              }),
              commentatorName: this.commentator?.name ?? null,
              targetPoints: this.config.targetPoints,
              durationMs: this.config.durationMs,
            }
          : null,
      ended:
        this.phase === 'ended'
          ? {
              winner: this.winner,
              teams: {
                A: this.endedTeam('A'),
                B: this.endedTeam('B'),
              },
              leadChanges: this.leadChanges,
              otPlayed: this.period === 'ot',
            }
          : null,
      commentator: this.commentator
        ? {
            name: this.commentator.name,
            camConnected: this.commentator.camConnected,
            inputId: this.commentator.inputId,
            casterPip: this.casterPip,
          }
        : null,
      banner,
    };
    if (immediate) {
      for (const t of this.hudTimers) clearTimeout(t);
      this.hudTimers.clear();
      this.hudApplyAt = now;
      this.applyToDeps(snapshot);
    } else {
      this.applyHudHeld(snapshot);
    }
  }

  private endedTeam(team: BbTeamId) {
    const t = this.tally[team];
    return {
      score: t.score,
      makes: t.makes,
      attempts: t.attempts,
      twos: t.twos,
    };
  }

  private applyHudHeld(state: BbHudState): void {
    const now = this.now();
    const applyAt = Math.max(now + HUD_HOLD_MS, this.hudApplyAt + 1);
    this.hudApplyAt = applyAt;
    const timer = setTimeout(() => {
      this.hudTimers.delete(timer);
      if (!this.disposed) this.applyToDeps(state);
    }, applyAt - now);
    this.hudTimers.add(timer);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.clearReplayTimer();
    this.replay = null;
    for (const t of this.hudTimers) clearTimeout(t);
    this.hudTimers.clear();
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    for (const imageId of this.frameImageIds.values()) {
      this.deps.unregisterShotFrameImage(imageId);
    }
    this.frameImageIds.clear();
    // Room teardown removes inputs itself; just drop our references.
    for (const cam of this.cams.values()) cam.inputId = null;
    this.cams.clear();
    if (this.commentator) this.commentator.inputId = null;
    this.commentator = null;
    this.shots = [];
    this.attempts = [];
    this.deps.publishHud(null);
  }
}
