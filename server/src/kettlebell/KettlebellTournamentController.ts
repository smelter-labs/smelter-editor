import { randomUUID } from 'node:crypto';
import type {
  KbtCommentatorOverlay,
  KbtConfig,
  KbtErrorCode,
  KbtExerciseKey,
  KbtHeatPhase,
  KbtHeatSummary,
  KbtHypeBannerId,
  KbtMatchAction,
  KbtMatchEvent,
  KbtPerfConfig,
  KbtPlayer,
  KbtRepShot,
  KbtScoreBreakdown,
  KbtSkeletonMode,
  KbtStateEvent,
  KbtTournamentPhase,
  KbtViewOverride,
  KbtViewTransitionStyle,
  KettlebellExercise,
  KettlebellIssueCode,
  RoomEvent,
} from '@smelter-editor/types';
import {
  KBT_DEFAULT_CONFIG,
  KBT_EXERCISE_COLORS,
  KBT_EXERCISE_KEYS,
  KBT_HYPE_BANNERS,
  KETTLEBELL_ISSUE_LABELS,
} from '@smelter-editor/types';
import type {
  KbtBoardRow,
  KbtCommentatorHudOverlay,
  KbtHudScene,
  KbtHudState,
  KbtHudTile,
  KbtStatSide,
} from '../app/store';
import {
  KBT_VIEW_TRANSITION_MS,
  kbtCasterCamRect,
  kbtCasterVisible,
  kbtParkRect,
} from '../app/store';
import { clamp } from '../core/mathUtils';

/** Command from the arcade page's match endpoint. */
export type KbtMatchCommand = {
  action: KbtMatchAction;
  heatIndex?: number;
  /** Target player for kick_player. */
  clientId?: string;
};

/** Why a match command was refused (returned to the host, not thrown). */
export type KbtMatchError = {
  code: KbtErrorCode;
  message: string;
  context?: Record<string, string | number>;
};

/**
 * Everything the controller needs from the room, injected so tests can fake
 * the world (same pattern as KettlebellCoachController's injected broadcast).
 * All camera/AI/layout calls are best-effort async — the controller never
 * blocks its tick on them.
 */

/** One tile of the manual `kbt-stage` layout. The optional transition fields
 * ride through RoomState into the per-input Rescaler; `transitionDurationMs: 0`
 * means a hard cut (the renderer drops the transition entirely). */
export type KbtStageTile = {
  inputId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
};

export type KbtControllerDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  /** Register a WHIP camera input through InputManager (side channel baked
   * in unless `ai: false` — then the input can never run the coach). */
  registerPlayerCam: (
    name: string,
    dims?: { width: number; height: number },
    opts?: { ai?: boolean },
  ) => Promise<{ inputId: string; whipUrl: string; bearerToken: string }>;
  removeInput: (inputId: string) => Promise<void>;
  /** Enable/disable the kettlebell-coach model on one input. */
  setKettlebellCoach: (
    inputId: string,
    enabled: boolean,
    params?: Record<string, number | string>,
  ) => Promise<void>;
  /** Set the overlay animation ticker interval on the room's scene store. */
  setAnimTickMs: (ms: number) => void;
  /** Replace the output layout with these tiles (manual positions). */
  layoutTiles: (tiles: KbtStageTile[]) => Promise<void>;
  /**
   * Run a one-shot fade/dissolve on an input's video (InputManager
   * activeTransition — self-clearing after durationMs, audio untouched).
   */
  runInputTransition: (
    inputId: string,
    transition: {
      type: KbtViewTransitionStyle;
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) => void;
  /** WHIP input is currently connected (registered with the engine). */
  isInputConnected: (inputId: string) => boolean;
  /**
   * WHIP input is actually publishing (heartbeat-acked within the TTL).
   * Optional for older fakes; falls back to isInputConnected — which for
   * WHIP means "registered", not "live".
   */
  isInputLive?: (inputId: string) => boolean;
  /** Output resolution for tile math. */
  getResolution: () => { width: number; height: number };
  /** An MP4 recording of the program output is running (optional for older fakes). */
  hasActiveRecording?: () => boolean;
  /** Write the burned-in HUD state (already hold-scheduled by the controller). */
  publishHud: (state: KbtHudState | null) => void;
  /**
   * Render `url` as a QR PNG and register it with the engine; resolves with
   * the image id the HUD can pass to <Image>. Re-registering for a changed
   * url must yield a fresh id (image content is immutable per id).
   */
  registerJoinQr: (url: string) => Promise<string>;
  /**
   * Register an already-written profile-photo JPEG with the engine; resolves
   * with the image id the HUD can pass to <Image>. Ids embed the content hash
   * (image content is immutable per id — same rule as the join QR).
   */
  registerPlayerPhoto: (
    photoPath: string,
    photoHash: string,
  ) => Promise<string>;
  /**
   * Best-effort retirement of a replaced photo: unregister the engine image
   * (when it got one) and delete the file once the HUD can no longer show it.
   */
  unregisterPlayerPhoto: (imageId: string | null, photoPath: string) => void;
  /**
   * Register a saved rep-apex still (server-relative `/kbt-rep-frames/…` url)
   * as an engine image; resolves null when the file is gone. Idempotent per
   * url (the id embeds a filename hash).
   */
  registerRepShotImage: (url: string) => Promise<string | null>;
  /** Best-effort unregister at dispose; must NOT delete the backing file
   * (it is still HTTP-served; the room's GC sweep owns deletion). */
  unregisterRepShotImage: (imageId: string) => void;
  now?: () => number;
};

type PlayerState = {
  clientId: string;
  /**
   * Resume token, minted once and returned to the phone in kbt_joined. A
   * later join carrying it adopts this entry even when the old socket still
   * looks open — a fast refresh must not fork the player.
   */
  playerKey: string;
  name: string;
  color: string;
  connected: boolean;
  /** When the control socket dropped (null while connected). */
  disconnectedAt: number | null;
  inputId: string | null;
  camConnected: boolean;
  /** When camConnected last flipped false (null while live). */
  camDownAt: number | null;
  poseTracked: boolean;
  /**
   * The phone's wizard reached the briefing screen (kbt_briefed). Cleared on
   * disconnect / kbt_cam_stop / kbt_leave; the page re-sends after reconnect.
   */
  briefed: boolean;
  /** Head + an ankle in frame per the worker (framing hint, not a gate). */
  fullBody: boolean;
  /** Reported camera dimensions (drives aspect-correct tile widths). */
  camWidth: number | null;
  camHeight: number | null;
  bestScore: number;
  finalScore: number | null;
  heatIndex: number | null;
  /** Public URL path of the uploaded profile photo (content-hashed). */
  photoUrl: string | null;
  /** Absolute file path of the photo on disk (cleanup + HUD registration). */
  photoPath: string | null;
  photoHash: string | null;
  /** Engine image id once the photo registered (HUD <Image> handle). */
  photoImageId: string | null;
  /** Apex stills from the best qualification heat (or the final). */
  repShots: KbtRepShot[];
};

type ScoreState = {
  points: number;
  reps: Record<KbtExerciseKey, number>;
  /** Every judged rep attempt this heat, no-count no-reps included — the
   * floater spawn clock + accuracy denominator. */
  attempts: number;
  incorrectReps: number;
  streak: number;
  bestStreak: number;
  name: string;
  color: string;
  photoUrl: string | null;
  exercise: KettlebellExercise;
  lastRepAt: number | null;
  lastRepVerdict: 'correct' | 'incorrect' | null;
  lastRepPoints: number;
  /** Timestamps of this heat's reps within the RPM window (pruned on read). */
  repTimes: number[];
  /** When the last every-5th-rep milestone fired (fx trigger), and for which
   * exercise — snapshot math turns these into KbtHudTile.fx. */
  fxAt: number | null;
  fxExercise: KbtExerciseKey | null;
  /** Apex stills of this heat's counted reps (rep screenshots enabled only). */
  repShots: KbtRepShot[];
};

/** One commentator per room — a WHIP input outside the players/heats world. */
type CommentatorState = {
  clientId: string;
  /** Resume token, same contract as PlayerState.playerKey. */
  playerKey: string;
  name: string;
  connected: boolean;
  inputId: string | null;
  camConnected: boolean;
  camWidth: number | null;
  camHeight: number | null;
};

type HeatState = {
  index: number;
  final: boolean;
  phase: KbtHeatPhase;
  playerIds: string[];
  startsAt: number | null;
  endsAt: number | null;
  scores: Map<string, ScoreState>;
  winner: {
    clientId: string;
    name: string;
    color: string;
    points: number;
  } | null;
  finalized: boolean;
  lastBroadcastAt: number;
};

/** Distinct, bright tile colors (same family as the shooter palette). */
const PLAYER_COLORS = [
  '#FFEB3B', // yellow
  '#00E5FF', // cyan
  '#FF4081', // pink
  '#76FF03', // green
  '#FF9100', // orange
  '#B388FF', // purple
];

const KETTLEBELL_COACH_ID = 'kettlebell-coach';

/** Whitelist for kbt_commentator_match (mirrors the REST schema literals). */
const KBT_MATCH_ACTIONS: readonly KbtMatchAction[] = [
  'roster',
  'assign_heats',
  'start_heat',
  'begin_heat',
  'stop_heat',
  'next_heat',
  'start_final',
  'podium',
  'reset',
  'kick_player',
  'restart_heat',
  'force_begin',
];

const COUNTDOWN_MS = 3000;
const HEAT_MIN_DURATION_MS = 30_000;
const HEAT_MAX_DURATION_MS = 600_000;
const HEAT_MIN_SIZE = 2;
const HEAT_MAX_SIZE = 4;
const TICK_MS = 100; // 10 Hz: heat clock + HUD publish cadence
const MATCH_BROADCAST_MS = 1000; // 1 Hz authoritative clock for clients
/**
 * The AI sees frames ~live while the composited WHIP video runs 3000 ms
 * behind (WHIP_SIDE_CHANNEL_DELAY_MS). Holding every HUD snapshot by the same
 * amount keeps burned-in scores/clock on the frames they belong to — the same
 * trick as the kettlebell skeleton overlay hold in RoomState.
 */
const HUD_HOLD_MS = 3000;
/**
 * A leaving tile parks this much before its fade-out ends: the layout lands
 * while the video is still ~invisible, so the full-opacity frame InputManager
 * restores after clearing the transition never reaches the old rect.
 */
const PARK_LEAD_MS = 50;
/**
 * A rep finished right at the buzzer surfaces up to ~1 analysis frame +
 * pipeline late. Accept scoring events this long past endsAt, and only
 * finalize (winner, frozen board) after the grace closes.
 */
const REP_GRACE_MS = 400;
/** Keep publishing after 'ended' until the held board + banner landed. */
const ENDED_LINGER_MS = HUD_HOLD_MS + 2000;
const BANNER_MS = 4000;
/** How long a scored rep lights its tile (snapshot-relative, see KbtHudTile). */
const REP_FLASH_MS = 600;
const STREAK_MILESTONE_EVERY = 5;
/** Every-5th-rep-of-an-exercise celebration length (aura + shake). Counts raw
 * per-exercise reps — distinct from the correct-rep streak milestone above. */
const MILESTONE_FX_MS = 3000;
const MILESTONE_FX_EVERY = 5;
/** Debounce for pose visibility flips (raw results arrive ~12-16/s). */
const POSE_DEBOUNCE_MS = 700;
/** Roster camera mosaic is capped to keep tiles readable. */
const ROSTER_MOSAIC_MAX = 6;
/** Grace before a forced view pinned to a dropped participant auto-clears. */
const OVERRIDE_STALE_MS = 10_000;

/** Analysis rate by heat size — all heat players' inference shares one GPU. */
function analysisFpsFor(playerCount: number): number {
  if (playerCount <= 2) return 14;
  if (playerCount === 3) return 12;
  return 10;
}


/** HUD consumers read the heat clock at ≥500 ms granularity (blink phase,
 * whole seconds), so coarser snapshots stay pixel-identical — and identical
 * back-to-back snapshots dedupe in the store instead of re-rendering the
 * scene on every periodic publish. Ceil keeps countdown digits their full
 * second. */
function quantizeClock(ms: number | null): number | null {
  return ms == null ? ms : Math.ceil(ms / 500) * 500;
}

/**
 * Kettlebell Tournament for one room: an open roster joined by QR, drawn into
 * heats of 2–4, each heat an AMRAP round scored from the kettlebell-coach's
 * debounced rep events (fed by RoomState). Owns the room's output layout while
 * it runs (player camera tiles) and publishes the burned-in HUD.
 */
export class KettlebellTournamentController {
  private readonly players = new Map<string, PlayerState>();
  private heats: HeatState[] = [];
  private currentHeatIndex: number | null = null;
  private phase: KbtTournamentPhase = 'roster';
  /**
   * Every room owns a controller, so phase alone can't distinguish a KBT room
   * from a plain editor room ('roster' is the initial phase everywhere). Set
   * on the first host control action and never cleared — a tournament reset
   * keeps the room a KBT arena until the room dies.
   */
  private engaged = false;
  private config: KbtConfig = structuredClone(KBT_DEFAULT_CONFIG);
  private colorSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Leader of the running heat (for kbt_lead_change). */
  private leaderId: string | null = null;
  private banner: KbtHudState['banner'] = null;
  private commentator: CommentatorState | null = null;
  /** Join URL for the lobby QR (pushed down from the host page's config). */
  private joinUrl: string | null = null;
  private joinLabel: string | null = null;
  private qrImageId: string | null = null;
  /**
   * Scene the *layout* currently reflects (the caster cam rect differs per
   * scene). HUD publishes are held 3s but layout applies live, so the
   * lower-third frame trails a cam move by the hold — cosmetic, accepted.
   */
  private stagedScene: KbtHudScene = 'lobby';
  /**
   * Commentator panel's forced view; 'auto' = scene derived from the
   * tournament. Cleared by any match action, by the referenced participant
   * leaving, and validated again at compute time (stale-guard).
   */
  private viewOverride: KbtViewOverride = { mode: 'auto' };
  /**
   * Commentator's output overlay identity (rep cam / spotlight / h2h); the
   * data is recomputed into every HUD snapshot so stats stay live. Cleared by
   * match actions and by the referenced player leaving, like viewOverride.
   */
  private commentatorOverlay: Exclude<
    KbtCommentatorOverlay,
    { kind: 'none' }
  > | null = null;
  /** Live skeleton mode for heat tiles (rides in the coach params). */
  private skeletonMode: KbtSkeletonMode = 'neon';
  /** Commentator cam PiP on non-featured scenes (panel toggle, default on). */
  private casterPip = true;
  /** How view switches animate (panel toggle; drives chrome + tile fades). */
  private viewTransitionStyle: KbtViewTransitionStyle = 'fade';
  /** url → engine imageId cache for rep-shot stills (freed at dispose). */
  private readonly repShotImageIds = new Map<string, string>();
  /** Last player-tile layout, so a scene flip can re-stage the caster cam. */
  private lastTiles: KbtStageTile[] = [];
  /**
   * Inputs that were visibly on stage (width > 1) in the last applied layout.
   * Tiles entering from park (or brand new) hard-cut instead of growing out
   * of the 1×1 parking pixel; staged→staged moves glide.
   */
  private lastStagedInputIds = new Set<string>();
  /**
   * Rects from the last applied layout, so a leaving tile can hold its
   * on-stage position while its fade-out runs (park commits in commitParks).
   */
  private lastAppliedRects = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  /** Desired (undecorated) tiles from the last applyStage, for park commits. */
  private lastDesiredTiles: KbtStageTile[] = [];
  /**
   * Tiles mid-fade-out, held at their last on-stage rect until `until`.
   * Durable across restages: a view override restages twice back to back
   * (publishHud's scene flip + the explicit restage), and the second pass
   * must keep holding, not park early.
   */
  private leavingTiles = new Map<
    string,
    {
      rect: { x: number; y: number; width: number; height: number };
      until: number;
    }
  >();
  /** Deferred park commit for tiles fading out; superseded by any restage. */
  private parkTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic clamp for held HUD applies (mirror of kettlebellApplyAt). */
  private hudApplyAt = 0;
  private readonly hudTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Min interval between periodic (clock-driven) HUD publishes; event
   * publishes (reps, scene flips) bypass it. 100 ms = the historical 10 Hz. */
  private hudMinIntervalMs = 100;
  private lastPeriodicHudAt = 0;
  /** Pose flip debounce per clientId. */
  private readonly poseFlipAt = new Map<string, number>();
  private lastCamPoll = 0;
  private simRepSeq = 1_000_000; // simulated reps stay clear of worker indices
  private disposed = false;

  constructor(
    private readonly roomId: string,
    private readonly deps: KbtControllerDeps,
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  // ── WS message handling ───────────────────────────────────────────────────

  handleMessage(clientId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as {
      type?: unknown;
      name?: unknown;
      playerKey?: unknown;
      nativeWidth?: unknown;
      nativeHeight?: unknown;
      override?: unknown;
      action?: unknown;
      heatIndex?: unknown;
      overlay?: unknown;
      bannerId?: unknown;
      mode?: unknown;
      enabled?: unknown;
      style?: unknown;
    };
    const playerKey =
      typeof msg.playerKey === 'string' && msg.playerKey.length <= 64
        ? msg.playerKey
        : undefined;
    switch (msg.type) {
      case 'kbt_join':
        this.join(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Lifter',
          playerKey,
        );
        break;
      case 'kbt_cam_request': {
        const w = Number(msg.nativeWidth);
        const h = Number(msg.nativeHeight);
        const dims =
          Number.isFinite(w) &&
          Number.isFinite(h) &&
          w >= 16 &&
          w <= 8192 &&
          h >= 16 &&
          h <= 8192
            ? { width: Math.round(w), height: Math.round(h) }
            : undefined;
        void this.startCamera(clientId, dims);
        break;
      }
      case 'kbt_cam_stop':
        this.stopCamera(clientId);
        break;
      case 'kbt_briefed':
        this.setBriefed(clientId, true);
        break;
      case 'kbt_leave':
        this.leave(clientId);
        break;
      case 'kbt_spectate':
        this.spectate(clientId);
        break;
      case 'kbt_commentator_join':
        this.joinCommentator(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Commentator',
          playerKey,
        );
        break;
      case 'kbt_commentator_cam_request': {
        const w = Number(msg.nativeWidth);
        const h = Number(msg.nativeHeight);
        const dims =
          Number.isFinite(w) &&
          Number.isFinite(h) &&
          w >= 16 &&
          w <= 8192 &&
          h >= 16 &&
          h <= 8192
            ? { width: Math.round(w), height: Math.round(h) }
            : undefined;
        void this.startCommentatorCamera(clientId, dims);
        break;
      }
      case 'kbt_commentator_leave':
        this.leaveCommentator(clientId);
        break;
      case 'kbt_commentator_view':
        this.setViewOverride(clientId, msg.override);
        break;
      case 'kbt_commentator_overlay':
        this.setCommentatorOverlay(clientId, msg.overlay);
        break;
      case 'kbt_commentator_banner':
        this.triggerHypeBanner(clientId, msg.bannerId);
        break;
      case 'kbt_commentator_skeleton':
        this.setSkeletonMode(clientId, msg.mode);
        break;
      case 'kbt_commentator_rep_float':
        this.setRepFloatText(clientId, msg.enabled);
        break;
      case 'kbt_commentator_caster_pip':
        this.setCasterPip(clientId, msg.enabled);
        break;
      case 'kbt_commentator_transition_style':
        this.setViewTransitionStyle(clientId, msg.style);
        break;
      case 'kbt_commentator_match': {
        const action = msg.action;
        if (
          typeof action === 'string' &&
          (KBT_MATCH_ACTIONS as readonly string[]).includes(action)
        ) {
          const hi = Number(msg.heatIndex);
          this.commentatorControlMatch(clientId, {
            action: action as KbtMatchAction,
            heatIndex: Number.isInteger(hi) ? hi : undefined,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Register (or reconnect) a player. A join carrying a known playerKey
   * adopts that entry even when its old socket still looks open — a fast
   * refresh beats the stale socket's close, and forking the player would
   * split scores and wedge the heat gate (the stale close later finds no
   * player under its clientId and no-ops). Without a key, a join whose name
   * exactly matches a *disconnected* player adopts it (legacy phones); a key
   * that matches nothing skips name adoption — that phone is a genuinely new
   * entrant, and adopting by name could hijack someone else's slot.
   */
  join(clientId: string, rawName: string, playerKey?: string): void {
    const name = rawName.slice(0, 20).trim() || 'Lifter';
    const existing = this.players.get(clientId);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      existing.disconnectedAt = null;
      this.sendJoined(clientId, existing);
      this.ensureRunning();
      this.broadcastState();
      return;
    }
    const byKey = playerKey
      ? [...this.players.values()].find((p) => p.playerKey === playerKey)
      : undefined;
    const orphan =
      byKey ??
      (playerKey == null
        ? [...this.players.values()].find(
            (p) => !p.connected && p.name === name,
          )
        : undefined);
    let player: PlayerState;
    if (orphan) {
      this.adoptPlayer(orphan, clientId);
      orphan.name = name;
      player = orphan;
    } else {
      player = {
        clientId,
        playerKey: playerKey ?? randomUUID(),
        name,
        color: PLAYER_COLORS[this.colorSeq++ % PLAYER_COLORS.length],
        connected: true,
        disconnectedAt: null,
        inputId: null,
        camConnected: false,
        camDownAt: null,
        poseTracked: false,
        briefed: false,
        fullBody: true,
        camWidth: null,
        camHeight: null,
        bestScore: 0,
        finalScore: null,
        heatIndex: null,
        photoUrl: null,
        photoPath: null,
        photoHash: null,
        photoImageId: null,
        repShots: [],
      };
      this.players.set(clientId, player);
    }
    this.sendJoined(clientId, player);
    this.ensureRunning();
    this.broadcastState();
  }

  /** The joiner's private resume snapshot (carries the bearer playerKey). */
  private sendJoined(clientId: string, p: PlayerState): void {
    const heat = this.activeHeat();
    this.deps.sendTo(clientId, {
      type: 'kbt_joined',
      roomId: this.roomId,
      clientId,
      playerKey: p.playerKey,
      name: p.name,
      role: 'player',
      briefed: p.briefed,
      camInputActive: p.inputId != null,
      photoUrl: p.photoUrl,
      heatIndex: p.heatIndex,
      inCurrentHeat: heat != null && heat.playerIds.includes(clientId),
      tournamentPhase: this.phase,
      heatPhase: heat?.phase ?? 'idle',
    });
  }

  /** A rejected request, addressed to the client that made it. */
  private sendError(
    clientId: string,
    code: KbtErrorCode,
    message: string,
    context?: Record<string, string | number>,
  ): void {
    this.deps.sendTo(clientId, {
      type: 'kbt_error',
      roomId: this.roomId,
      code,
      message,
      ...(context ? { context } : {}),
    });
  }

  /** Re-key a (usually disconnected) player's whole trail onto the new clientId. */
  private adoptPlayer(orphan: PlayerState, clientId: string): void {
    const oldId = orphan.clientId;
    this.players.delete(oldId);
    orphan.clientId = clientId;
    orphan.connected = true;
    orphan.disconnectedAt = null;
    this.players.set(clientId, orphan);
    const pose = this.poseFlipAt.get(oldId);
    this.poseFlipAt.delete(oldId);
    if (pose != null) this.poseFlipAt.set(clientId, pose);
    for (const heat of this.heats) {
      heat.playerIds = heat.playerIds.map((id) =>
        id === oldId ? clientId : id,
      );
      const score = heat.scores.get(oldId);
      if (score) {
        heat.scores.delete(oldId);
        heat.scores.set(clientId, score);
      }
      if (heat.winner?.clientId === oldId) heat.winner.clientId = clientId;
    }
    if (this.leaderId === oldId) this.leaderId = clientId;
    const o = this.viewOverride;
    if (
      (o.mode === 'player_solo' || o.mode === 'split') &&
      o.playerId === oldId
    ) {
      o.playerId = clientId;
    }
  }

  /**
   * Attach an uploaded profile photo to the player with this exact name (the
   * phone doesn't know its clientId when it uploads, and reconnect adoption
   * re-keys by name anyway). Returns false when no such player has joined.
   * The file is already on disk; HUD registration is fired best-effort here.
   */
  setPlayerPhoto(
    rawName: string,
    photo: { photoUrl: string; photoPath: string; photoHash: string },
    playerKey?: string,
  ): boolean {
    const name = rawName.slice(0, 20).trim() || 'Lifter';
    // Prefer the resume token — with duplicate names, a bare name match could
    // put the photo on the wrong athlete.
    const p =
      (playerKey
        ? [...this.players.values()].find((pl) => pl.playerKey === playerKey)
        : undefined) ??
      [...this.players.values()].find((pl) => pl.name === name);
    if (!p) return false;
    if (p.photoHash === photo.photoHash) return true; // same content re-sent
    const oldImageId = p.photoImageId;
    const oldPath = p.photoPath;
    p.photoUrl = photo.photoUrl;
    p.photoPath = photo.photoPath;
    p.photoHash = photo.photoHash;
    p.photoImageId = null;
    // Late uploads still reach rows snapshotted at heat draw time.
    for (const heat of this.heats) {
      const score = heat.scores.get(p.clientId);
      if (score) score.photoUrl = photo.photoUrl;
    }
    if (oldPath && oldPath !== photo.photoPath && !this.photoPathInUse(oldPath))
      this.deps.unregisterPlayerPhoto(oldImageId, oldPath);
    this.broadcastState();
    void this.deps
      .registerPlayerPhoto(photo.photoPath, photo.photoHash)
      .then((imageId) => {
        // The player may have re-uploaded (or left) while we awaited.
        const current = this.players.get(p.clientId);
        if (this.disposed || current !== p || p.photoHash !== photo.photoHash)
          return;
        p.photoImageId = imageId;
        this.publishHud();
      })
      .catch((err) =>
        console.error(`[kbt] photo registration failed for ${name}`, err),
      );
    return true;
  }

  /** Identical uploads share a content-hashed file; don't retire shared ones. */
  private photoPathInUse(photoPath: string): boolean {
    return [...this.players.values()].some((p) => p.photoPath === photoPath);
  }

  /**
   * Register a fresh WHIP camera input for this player (retiring any previous
   * one) and send the publish offer. Goes through InputManager so the input
   * has a video side channel — unlike Duck Hunter's decorative avatar cams.
   */
  async startCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const p = this.players.get(clientId);
    if (!p) {
      this.sendError(
        clientId,
        'not_joined',
        'Join the tournament before requesting a camera slot.',
      );
      return;
    }
    this.retireCamera(p);
    if (dims) {
      p.camWidth = dims.width;
      p.camHeight = dims.height;
    }
    let cam: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      cam = await this.deps.registerPlayerCam(p.name, dims);
    } catch (err) {
      console.error(`[kbt] camera input register failed for ${clientId}`, err);
      this.sendError(
        clientId,
        'no_live_camera',
        'Camera slot could not be created — try again.',
      );
      return;
    }
    // The player may have left (or re-requested) while we awaited.
    if (this.players.get(clientId) !== p || p.inputId != null) {
      void this.deps.removeInput(cam.inputId).catch(() => {});
      return;
    }
    p.inputId = cam.inputId;
    p.camConnected = false; // flips true once the publish acks (tick poll)
    this.deps.sendTo(clientId, {
      type: 'kbt_cam_offer',
      roomId: this.roomId,
      clientId,
      inputId: cam.inputId,
      whipUrl: cam.whipUrl,
      bearerToken: cam.bearerToken,
    });
    // Mid-heat cam swap (phone reconnected): put the new input on stage.
    if (this.isPlayerInActiveHeat(clientId)) {
      void this.stageActiveHeat();
    } else if (this.phase === 'roster') {
      void this.layoutRosterMosaic();
    }
    this.ensureRunning();
    this.broadcastState();
  }

  stopCamera(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    p.briefed = false;
    this.retireCamera(p);
    this.clearViewOverrideIfPlayer(clientId);
    if (this.phase === 'roster') void this.layoutRosterMosaic();
    this.broadcastState();
  }

  /**
   * Dev hook (KBT_SIM=1): adopt an already-connected input (local-mp4) as this
   * player's camera, in place of a phone-published WHIP stream. No
   * kbt_cam_offer is sent — nothing publishes. Everything downstream is
   * inputId-keyed and works unchanged: camConnected flips via the 1 Hz
   * isInputConnected poll, stageActiveHeat() arms the coach on it, scoreRep /
   * retireCamera treat it like any WHIP cam.
   */
  attachExternalCam(
    clientId: string,
    inputId: string,
    dims?: { width: number; height: number },
  ): boolean {
    const p = this.players.get(clientId);
    if (!p) return false;
    this.retireCamera(p);
    if (dims) {
      p.camWidth = dims.width;
      p.camHeight = dims.height;
    }
    p.inputId = inputId;
    p.camConnected = false; // flips true on the next tick poll
    if (this.isPlayerInActiveHeat(clientId)) {
      void this.stageActiveHeat();
    } else if (this.phase === 'roster') {
      void this.layoutRosterMosaic();
    }
    this.ensureRunning();
    this.broadcastState();
    return true;
  }

  /**
   * Not cleared in retireCamera(): startCamera() retires on every cam
   * re-request, and on reconnect the re-sent kbt_briefed can land before the
   * cam re-request — clearing there would wipe a briefing that still holds.
   */
  private setBriefed(clientId: string, briefed: boolean): void {
    const p = this.players.get(clientId);
    if (!p) {
      if (briefed) {
        this.sendError(
          clientId,
          'not_joined',
          'Join the tournament before reporting the briefing.',
        );
      }
      return;
    }
    if (p.briefed === briefed) return;
    p.briefed = briefed;
    this.broadcastState();
  }

  private retireCamera(p: PlayerState): void {
    if (p.inputId == null) return;
    const inputId = p.inputId;
    p.inputId = null;
    p.camConnected = false;
    p.camDownAt = null;
    p.poseTracked = false;
    p.fullBody = true;
    // A later restage() must never re-push the retired input to the engine.
    this.lastTiles = this.lastTiles.filter((t) => t.inputId !== inputId);
    void this.deps.setKettlebellCoach(inputId, false).catch(() => {});
    void this.deps.removeInput(inputId).catch(() => {});
  }

  // ── Commentator ───────────────────────────────────────────────────────────

  /**
   * Register (or reconnect) the room's single commentator. Like players, a
   * join carrying the slot's playerKey adopts it even mid-"connected" (fast
   * refresh), a join whose name matches the disconnected commentator adopts
   * the slot (the running WHIP input survives a phone reconnect); a different
   * name replaces the commentator outright.
   */
  joinCommentator(clientId: string, rawName: string, playerKey?: string): void {
    const name = rawName.slice(0, 20).trim() || 'Commentator';
    const c = this.commentator;
    if (
      c &&
      (c.clientId === clientId ||
        (playerKey != null && c.playerKey === playerKey) ||
        (!c.connected && c.name === name))
    ) {
      c.clientId = clientId;
      c.name = name;
      c.connected = true;
    } else {
      if (c) this.retireCommentatorCam(c);
      this.commentator = {
        clientId,
        playerKey: playerKey ?? randomUUID(),
        name,
        connected: true,
        inputId: null,
        camConnected: false,
        camWidth: null,
        camHeight: null,
      };
    }
    this.sendCommentatorJoined(clientId, this.commentator!);
    this.ensureRunning();
    this.broadcastState();
  }

  private sendCommentatorJoined(clientId: string, c: CommentatorState): void {
    const heat = this.activeHeat();
    this.deps.sendTo(clientId, {
      type: 'kbt_joined',
      roomId: this.roomId,
      clientId,
      playerKey: c.playerKey,
      name: c.name,
      role: 'commentator',
      briefed: false,
      camInputActive: c.inputId != null,
      photoUrl: null,
      heatIndex: null,
      inCurrentHeat: false,
      tournamentPhase: this.phase,
      heatPhase: heat?.phase ?? 'idle',
    });
  }

  /** Same offer flow as a player camera, but the input never gets the coach
   * AI and is staged via the caster rect (visible only between heats). */
  async startCommentatorCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) return;
    this.retireCommentatorCam(c);
    if (dims) {
      c.camWidth = dims.width;
      c.camHeight = dims.height;
    }
    let cam: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      cam = await this.deps.registerPlayerCam(`🎙 ${c.name}`, dims, {
        ai: false,
      });
    } catch (err) {
      console.error(
        `[kbt] commentator cam register failed for ${clientId}`,
        err,
      );
      return;
    }
    if (this.commentator !== c || c.inputId != null) {
      void this.deps.removeInput(cam.inputId).catch(() => {});
      return;
    }
    c.inputId = cam.inputId;
    c.camConnected = false;
    this.deps.sendTo(clientId, {
      type: 'kbt_cam_offer',
      roomId: this.roomId,
      clientId,
      inputId: cam.inputId,
      whipUrl: cam.whipUrl,
      bearerToken: cam.bearerToken,
    });
    // Adopt the new input into the current stage (keeps the audio mixed).
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
      this.viewOverride.mode === 'caster' ||
      this.viewOverride.mode === 'split'
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
    this.lastTiles = this.lastTiles.filter((t) => t.inputId !== inputId);
    void this.deps.removeInput(inputId).catch(() => {});
  }

  /**
   * The room reaped inputs behind our back (stale-WHIP sweep). Drop every
   * reference so a later restage can't re-push a dead input and the panel
   * learns the cam is down (the client's auto-republish trigger). No
   * deps.removeInput here — the inputs are already gone from the engine.
   */
  onInputsRemoved(inputIds: string[]): void {
    if (this.disposed) return;
    const gone = new Set(inputIds);
    let changed = false;
    const c = this.commentator;
    if (c?.inputId != null && gone.has(c.inputId)) {
      const inputId = c.inputId;
      c.inputId = null;
      c.camConnected = false;
      this.lastTiles = this.lastTiles.filter((t) => t.inputId !== inputId);
      changed = true;
    }
    for (const p of this.players.values()) {
      if (p.inputId != null && gone.has(p.inputId)) {
        const inputId = p.inputId;
        p.inputId = null;
        p.camConnected = false;
        p.camDownAt = null;
        p.poseTracked = false;
        p.fullBody = true;
        this.lastTiles = this.lastTiles.filter((t) => t.inputId !== inputId);
        changed = true;
      }
    }
    if (!changed) return;
    void this.restage();
    // publishHud (via broadcastState) re-validates overrides, so a caster/
    // split view pinned to a dead input falls back to AUTO on its own.
    this.broadcastState();
  }

  // ── Commentator view + show control (the moderator panel) ─────────────────

  /**
   * Force/release the broadcast view. Only the joined commentator may switch;
   * references must be live (a caster/split needs the commentator's input, a
   * player view needs that player's input) — invalid requests are ignored and
   * the panel's buttons stay on whatever `kbt_state` echoes back.
   */
  setViewOverride(clientId: string, raw: unknown): void {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) {
      this.sendError(
        clientId,
        'not_commentator',
        'Only the joined commentator can switch the broadcast view.',
      );
      return;
    }
    const override = this.parseViewOverride(raw);
    if (!override) {
      this.sendError(clientId, 'invalid_view', 'Unknown view override.');
      return;
    }
    if (
      (override.mode === 'caster' || override.mode === 'split') &&
      c.inputId == null
    ) {
      this.sendError(
        clientId,
        'invalid_view',
        'That view needs your camera publishing.',
      );
      return;
    }
    if (override.mode === 'player_solo' || override.mode === 'split') {
      const p = this.players.get(override.playerId);
      if (!p || p.inputId == null) {
        this.sendError(
          clientId,
          'invalid_view',
          "That view needs the player's camera publishing.",
        );
        return;
      }
    }
    this.viewOverride = override;
    // A view switch is a scene cut: publish the chrome immediately (no 3s
    // hold) and restage even when the scene name is unchanged (solo A → B).
    this.publishHud(true);
    void this.restage();
    this.deps.broadcast(this.stateSnapshot());
  }

  /** Tournament flow control from the panel — the host's vocabulary over WS. */
  commentatorControlMatch(clientId: string, cmd: KbtMatchCommand): void {
    if (!this.commentator || this.commentator.clientId !== clientId) {
      this.sendError(
        clientId,
        'not_commentator',
        'Only the joined commentator can control the match.',
      );
      return;
    }
    const { error } = this.controlMatch(cmd);
    if (error)
      this.sendError(clientId, error.code, error.message, error.context);
  }

  private parseViewOverride(raw: unknown): KbtViewOverride | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as { mode?: unknown; playerId?: unknown };
    switch (o.mode) {
      case 'auto':
      case 'caster':
      case 'grid':
      case 'board':
        return { mode: o.mode };
      case 'player_solo':
      case 'split':
        return typeof o.playerId === 'string'
          ? { mode: o.mode, playerId: o.playerId }
          : null;
      default:
        return null;
    }
  }

  /** Back to AUTO with an immediate scene cut (participant left, match action). */
  private clearViewOverride(): void {
    if (this.viewOverride.mode === 'auto') return;
    this.viewOverride = { mode: 'auto' };
    this.publishHud(true);
    void this.restage();
    this.deps.broadcast(this.stateSnapshot());
  }

  private clearViewOverrideIfPlayer(clientId: string): void {
    const o = this.viewOverride;
    if (
      (o.mode === 'player_solo' || o.mode === 'split') &&
      o.playerId === clientId
    ) {
      this.clearViewOverride();
    }
  }

  // ── Commentator output overlay (rep cam / spotlight / h2h / banners) ───────

  /** True when `clientId` is the joined commentator; emits the error if not. */
  private requireCommentator(clientId: string, what: string): boolean {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) {
      this.sendError(
        clientId,
        'not_commentator',
        `Only the joined commentator can ${what}.`,
      );
      return false;
    }
    return true;
  }

  /**
   * The player's shot list the overlay steps through: the running heat's
   * shots first, else the newest heat this player has shots in, else the
   * rolled-up `player.repShots`. Mirrored client-side in the panel's
   * `repShotsForPlayer` (editor rep-shot-source.ts) — keep in sync.
   */
  private repShotsFor(playerId: string): KbtRepShot[] {
    const active = this.activeHeat()?.scores.get(playerId);
    if (active && active.repShots.length) return active.repShots;
    for (let h = this.heats.length - 1; h >= 0; h--) {
      const s = this.heats[h].scores.get(playerId);
      if (s && s.repShots.length) return s.repShots;
    }
    return this.players.get(playerId)?.repShots ?? [];
  }

  setCommentatorOverlay(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'drive the output overlay')) return;
    const overlay = this.parseCommentatorOverlay(raw);
    if (!overlay) {
      this.sendError(clientId, 'invalid_overlay', 'Unknown overlay.');
      return;
    }
    if (overlay.kind === 'none') {
      this.commentatorOverlay = null;
      this.publishHud(true);
      this.deps.broadcast(this.stateSnapshot());
      return;
    }
    const ids =
      overlay.kind === 'h2h'
        ? [overlay.playerIdA, overlay.playerIdB]
        : [overlay.playerId];
    for (const id of ids) {
      if (!this.players.has(id)) {
        this.sendError(clientId, 'invalid_overlay', 'Unknown player.', {
          playerId: id,
        });
        return;
      }
    }
    if (overlay.kind === 'h2h' && overlay.playerIdA === overlay.playerIdB) {
      this.sendError(
        clientId,
        'invalid_overlay',
        'Head-to-head needs two different players.',
      );
      return;
    }
    if (overlay.kind === 'rep_shot') {
      const shots = this.repShotsFor(overlay.playerId);
      if (shots.length === 0) {
        this.sendError(
          clientId,
          'invalid_overlay',
          'That player has no rep shots yet.',
        );
        return;
      }
      overlay.index = clamp(overlay.index, 0, shots.length - 1);
      this.commentatorOverlay = overlay;
      // Publish now with a placeholder; the registration re-cuts with the
      // image. Pre-arm the neighbors so prev/next steps are instant.
      this.publishHud(true);
      void this.armRepShotImage(shots[overlay.index].url, true);
      for (const i of [overlay.index - 1, overlay.index + 1]) {
        if (i >= 0 && i < shots.length) {
          void this.armRepShotImage(shots[i].url, false);
        }
      }
    } else {
      this.commentatorOverlay = overlay;
      this.publishHud(true);
    }
    this.deps.broadcast(this.stateSnapshot());
  }

  private parseCommentatorOverlay(raw: unknown): KbtCommentatorOverlay | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as {
      kind?: unknown;
      playerId?: unknown;
      playerIdA?: unknown;
      playerIdB?: unknown;
      index?: unknown;
      showVerdict?: unknown;
    };
    switch (o.kind) {
      case 'none':
        return { kind: 'none' };
      case 'spotlight':
        return typeof o.playerId === 'string'
          ? { kind: 'spotlight', playerId: o.playerId }
          : null;
      case 'h2h':
        return typeof o.playerIdA === 'string' &&
          typeof o.playerIdB === 'string'
          ? { kind: 'h2h', playerIdA: o.playerIdA, playerIdB: o.playerIdB }
          : null;
      case 'rep_shot': {
        const index = Number(o.index);
        return typeof o.playerId === 'string' && Number.isInteger(index)
          ? {
              kind: 'rep_shot',
              playerId: o.playerId,
              index,
              showVerdict: o.showVerdict === true,
            }
          : null;
      }
      default:
        return null;
    }
  }

  /** Register a rep still with the engine; optionally re-cut once it lands. */
  private async armRepShotImage(url: string, recut: boolean): Promise<void> {
    if (!this.repShotImageIds.has(url)) {
      const id = await this.deps.registerRepShotImage(url).catch(() => null);
      if (this.disposed) return;
      if (id) this.repShotImageIds.set(url, id);
      else return; // file gone — keep the placeholder, nothing to re-cut
    }
    if (recut) this.publishHud(true);
  }

  triggerHypeBanner(clientId: string, rawId: unknown): void {
    if (!this.requireCommentator(clientId, 'fire a banner')) return;
    const entry =
      typeof rawId === 'string'
        ? KBT_HYPE_BANNERS[rawId as KbtHypeBannerId]
        : undefined;
    if (!entry) {
      this.sendError(clientId, 'invalid_overlay', 'Unknown banner.');
      return;
    }
    this.setBanner('hype', entry.text, entry.color);
    this.publishHud(true);
  }

  setSkeletonMode(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'switch the skeleton')) return;
    if (raw !== 'off' && raw !== 'lines' && raw !== 'neon') {
      this.sendError(clientId, 'invalid_overlay', 'Unknown skeleton mode.');
      return;
    }
    this.skeletonMode = raw;
    this.repushCoachParams();
    this.deps.broadcast(this.stateSnapshot());
  }

  /** Re-push the full coach params to every staged player of a live heat —
   * params replace wholesale on the worker, so a partial push would reset
   * fps/view/frames. No-op outside a live heat. */
  private repushCoachParams(): void {
    const heat = this.activeHeat();
    if (!heat || heat.phase === 'ended') return;
    const fps = this.effectiveAnalysisFps(heat.playerIds.length);
    for (const id of heat.playerIds) {
      const p = this.players.get(id);
      if (p?.inputId) {
        void this.deps
          .setKettlebellCoach(p.inputId, true, this.coachParams(fps))
          .catch((err) =>
            console.error(`[kbt] coach param push failed for ${p.inputId}`, err),
          );
      }
    }
  }

  /** Heat-size analysis rate, unless the perf config pins one. */
  private effectiveAnalysisFps(playerCount: number): number {
    return (
      this.config.perf.analysisFpsOverride ?? analysisFpsFor(playerCount)
    );
  }

  setRepFloatText(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'toggle the rep text')) return;
    if (typeof raw !== 'boolean') {
      this.sendError(clientId, 'invalid_overlay', 'Invalid rep text toggle.');
      return;
    }
    this.config.repFloatText = raw;
    // Push the flag to the HUD immediately (still rides the ~3s hold) so a
    // mid-heat flip lands without waiting for the next rep.
    this.publishHud();
    this.deps.broadcast(this.stateSnapshot());
  }

  /** Toggle the commentator's PiP cam tile (visible outside caster/split). */
  setCasterPip(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'toggle the cam PiP')) return;
    if (typeof raw !== 'boolean') {
      this.sendError(clientId, 'invalid_overlay', 'Invalid cam PiP toggle.');
      return;
    }
    if (this.casterPip === raw) return;
    this.casterPip = raw;
    // The tile moves instantly (restage), so the chrome must not ride the
    // ~3s hold — publish immediately like a scene cut.
    this.publishHud(true);
    void this.restage();
    this.deps.broadcast(this.stateSnapshot());
  }

  setViewTransitionStyle(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'pick the transition style')) return;
    if (raw !== 'fade' && raw !== 'dissolve') {
      this.sendError(clientId, 'invalid_view', 'Unknown transition style.');
      return;
    }
    if (this.viewTransitionStyle === raw) return;
    this.viewTransitionStyle = raw;
    // Style rides the HUD snapshot (the chrome crossfade reads it); publish
    // immediately so the very next switch already animates the new way.
    this.publishHud(true);
    this.deps.broadcast(this.stateSnapshot());
  }

  /**
   * Coach model params for a staged heat. Single source of truth: the worker
   * replaces params wholesale, so both heat staging and the live skeleton
   * toggle must send this full set.
   */
  private coachParams(fps: number): Record<string, number | string> {
    return {
      analysisFps: fps,
      cameraView: this.config.cameraView,
      captureRepFrames: this.config.repScreenshots ? 1 : 0,
      skeleton: this.skeletonMode,
    };
  }

  /** Drop the overlay when a player it references is gone. */
  private clearCommentatorOverlayIfPlayer(clientId: string): void {
    const o = this.commentatorOverlay;
    if (!o) return;
    const referenced =
      o.kind === 'h2h'
        ? o.playerIdA === clientId || o.playerIdB === clientId
        : o.playerId === clientId;
    if (referenced) {
      this.commentatorOverlay = null;
      this.publishHud(true);
      this.deps.broadcast(this.stateSnapshot());
    }
  }

  private casterAspect(c: CommentatorState): number {
    return c.camWidth && c.camHeight ? c.camWidth / c.camHeight : 16 / 9;
  }

  /**
   * Effective forced scene, or null for AUTO. Re-validated on every compute:
   * a vanished input (cam re-request in flight, participant gone) silently
   * falls back to the derived scene instead of forcing an empty stage.
   */
  private overrideScene(): KbtHudScene | null {
    const o = this.viewOverride;
    const casterReady = this.commentator?.inputId != null;
    switch (o.mode) {
      case 'auto':
        return null;
      case 'caster':
        return casterReady ? 'caster' : null;
      case 'grid':
        return 'grid';
      case 'board':
        return 'board';
      case 'player_solo':
        return this.players.get(o.playerId)?.inputId != null ? 'solo' : null;
      case 'split':
        return casterReady && this.players.get(o.playerId)?.inputId != null
          ? 'split'
          : null;
    }
  }

  /** Forced stage tiles, or null to keep the AUTO-derived lastTiles. */
  private overrideTiles():
    | { inputId: string; x: number; y: number; width: number; height: number }[]
    | null {
    const o = this.viewOverride;
    const c = this.commentator;
    if (o.mode === 'caster' && c?.inputId != null) {
      return this.tileRow([
        { inputId: c.inputId, aspect: this.casterAspect(c) },
      ]);
    }
    if (o.mode === 'player_solo') {
      const p = this.players.get(o.playerId);
      if (p?.inputId != null) {
        return this.tileRow([
          { inputId: p.inputId, aspect: this.camAspect(p) },
        ]);
      }
    }
    if (o.mode === 'split' && c?.inputId != null) {
      const p = this.players.get(o.playerId);
      if (p?.inputId != null) {
        return this.tileRow([
          { inputId: c.inputId, aspect: this.casterAspect(c) },
          { inputId: p.inputId, aspect: this.camAspect(p) },
        ]);
      }
    }
    return null;
  }

  /** RoomState pokes this after record start/stop so both control surfaces see it live. */
  notifyRecordingChanged(): void {
    this.broadcastState();
  }

  /** Snapshot-only handshake for the host page (never creates a player). */
  spectate(clientId: string): void {
    this.deps.sendTo(clientId, this.stateSnapshot());
    this.deps.sendTo(clientId, this.getMatchSnapshot());
  }

  leave(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    this.retireCamera(p);
    this.players.delete(clientId);
    this.clearViewOverrideIfPlayer(clientId);
    this.clearCommentatorOverlayIfPlayer(clientId);
    // Heat score sheets keep their own name/color snapshot, so past results
    // stay intact; upcoming idle heats just lose the entrant.
    for (const heat of this.heats) {
      if (heat.phase === 'idle') {
        heat.playerIds = heat.playerIds.filter((id) => id !== clientId);
      }
    }
    if (this.phase === 'roster') void this.layoutRosterMosaic();
    this.broadcastState();
    this.maybeStop();
  }

  /**
   * WS dropped. During an active heat the player must survive (phones lock,
   * networks blip, the score fights on) — only mark the tile SIGNAL LOST when
   * the camera also stops acking. In the roster the entry stays too, flagged
   * disconnected so a re-join by name can adopt it.
   */
  handleDisconnect(clientId: string): void {
    if (this.commentator?.clientId === clientId) {
      // Keep the slot AND the input: the WHIP publish (and its audio in the
      // mix) outlives a dropped control socket; a re-join by name adopts it.
      this.commentator.connected = false;
      this.broadcastState();
      return;
    }
    const p = this.players.get(clientId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    p.briefed = false;
    this.broadcastState();
  }

  // ── Scoring input (fed by RoomState) ──────────────────────────────────────

  /**
   * Tee'd off the coach controller's broadcast: every debounced coach event
   * for every input in the room lands here. Reps are scored only for players
   * of the running heat, inside the AMRAP window.
   */
  onCoachEvent(event: RoomEvent): void {
    if (event.type === 'kettlebell_rep_completed') {
      this.scoreRep(
        event.inputId,
        event.repIndex,
        event.exercise,
        event.verdict,
        event.issues,
        event.screenshotUrl,
      );
    } else if (event.type === 'kettlebell_exercise_changed') {
      const entry = this.activeScoreEntryByInput(event.inputId);
      if (entry) {
        entry.score.exercise = event.exercise;
        // Exercise chip changes ride the regular tick publish.
      }
    }
  }

  /**
   * Live pose visibility from the raw worker results (the coach events carry
   * no pose). Debounced so a single dropped frame doesn't flicker the check.
   */
  onPoseSample(inputId: string, tracked: boolean, fullBody = true): void {
    const p = [...this.players.values()].find((pl) => pl.inputId === inputId);
    if (!p || (p.poseTracked === tracked && p.fullBody === fullBody)) return;
    const now = this.now();
    const since = this.poseFlipAt.get(p.clientId) ?? 0;
    if (now - since < POSE_DEBOUNCE_MS) return;
    this.poseFlipAt.set(p.clientId, now);
    p.poseTracked = tracked;
    p.fullBody = fullBody;
    this.deps.sendTo(p.clientId, {
      type: 'kbt_pose',
      roomId: this.roomId,
      clientId: p.clientId,
      tracked,
      fullBody,
    });
    this.broadcastState();
  }

  /** Dev hook (KBT_SIM=1 route): fabricate a rep for UI work without the model. */
  simulateRep(
    clientId: string,
    exercise: KettlebellExercise,
    verdict: 'correct' | 'incorrect',
  ): boolean {
    const p = this.players.get(clientId);
    if (!p?.inputId) return false;
    this.scoreRep(p.inputId, this.simRepSeq++, exercise, verdict, []);
    return true;
  }

  private isPlayerInActiveHeat(clientId: string): boolean {
    const heat = this.activeHeat();
    return !!heat && heat.playerIds.includes(clientId);
  }

  private activeHeat(): HeatState | null {
    if (this.currentHeatIndex == null) return null;
    const heat = this.heats[this.currentHeatIndex];
    if (!heat || heat.phase === 'idle') return null;
    return heat;
  }

  private activeScoreEntryByInput(
    inputId: string,
  ): { heat: HeatState; player: PlayerState; score: ScoreState } | null {
    const heat = this.activeHeat();
    if (!heat) return null;
    const player = [...this.players.values()].find(
      (p) => p.inputId === inputId,
    );
    if (!player || !heat.playerIds.includes(player.clientId)) return null;
    const score = heat.scores.get(player.clientId);
    if (!score) return null;
    return { heat, player, score };
  }

  private scoreRep(
    inputId: string,
    repIndex: number,
    exercise: KettlebellExercise,
    verdict: 'correct' | 'incorrect',
    issues: KettlebellIssueCode[],
    screenshotUrl?: string,
  ): void {
    const entry = this.activeScoreEntryByInput(inputId);
    if (!entry) return;
    const { heat, player, score } = entry;
    const now = this.now();
    const inWindow =
      heat.phase === 'playing' ||
      (heat.phase === 'ended' &&
        heat.endsAt != null &&
        now - heat.endsAt <= REP_GRACE_MS &&
        !heat.finalized);
    if (!inWindow) return;
    if (exercise === 'idle') return;
    const key = exercise as KbtExerciseKey;
    if (!KBT_EXERCISE_KEYS.includes(key)) return;

    const rule = this.config.scoring[key];
    let points = rule.enabled ? rule.points : 0;
    if (this.config.strictTechnique && verdict === 'incorrect') {
      points = Math.floor(points / 2);
    }
    const counted = this.config.countIncorrectReps || verdict === 'correct';
    if (!counted) points = 0;

    score.attempts += 1;
    if (counted) {
      score.reps[key] += 1;
      if (
        this.config.milestoneFx &&
        score.reps[key] % MILESTONE_FX_EVERY === 0
      ) {
        score.fxAt = now;
        score.fxExercise = key;
      }
      score.points += points;
      score.repTimes.push(now);
    }
    if (verdict === 'incorrect') {
      score.incorrectReps += 1;
      score.streak = 0;
    } else {
      score.streak += 1;
      score.bestStreak = Math.max(score.bestStreak, score.streak);
    }
    score.exercise = exercise;
    score.lastRepAt = now;
    score.lastRepVerdict = verdict;
    score.lastRepPoints = points;
    if (screenshotUrl) {
      score.repShots.push({
        repIndex,
        url: screenshotUrl,
        exercise: key,
        verdict,
        points,
        ...(issues.length ? { issues: [...issues] } : {}),
      });
    }

    this.deps.broadcast({
      type: 'kbt_rep',
      roomId: this.roomId,
      clientId: player.clientId,
      name: player.name,
      exercise,
      points,
      totalPoints: score.points,
      verdict,
      issues,
      repIndex,
      streak: score.streak,
      ...(screenshotUrl ? { screenshotUrl } : {}),
    });

    if (score.streak > 0 && score.streak % STREAK_MILESTONE_EVERY === 0) {
      this.deps.broadcast({
        type: 'kbt_streak',
        roomId: this.roomId,
        clientId: player.clientId,
        name: player.name,
        count: score.streak,
      });
      this.setBanner(
        'streak',
        `${player.name} ×${score.streak} CLEAN!`,
        player.color,
      );
    }

    this.detectLeadChange(heat, player);
    this.publishHud();
  }

  private detectLeadChange(heat: HeatState, scorer: PlayerState): void {
    let leader: { id: string; points: number } | null = null;
    let runnerUpPoints = -1;
    for (const [id, s] of heat.scores) {
      if (!leader || s.points > leader.points) {
        runnerUpPoints = leader?.points ?? -1;
        leader = { id, points: s.points };
      } else if (s.points > runnerUpPoints) {
        runnerUpPoints = s.points;
      }
    }
    // Sole leader only (ties keep the previous leader's crown).
    if (!leader || leader.points === runnerUpPoints) return;
    if (leader.id === this.leaderId) return;
    const wasLed = this.leaderId != null;
    this.leaderId = leader.id;
    if (!wasLed || leader.id !== scorer.clientId) {
      // First blood is not a "lead change" banner-worthy moment unless it
      // dethrones someone; but the event always fires for commentators.
    }
    this.deps.broadcast({
      type: 'kbt_lead_change',
      roomId: this.roomId,
      clientId: scorer.clientId,
      name: scorer.name,
      points: leader.points,
    });
    if (wasLed) {
      const p = this.players.get(leader.id);
      this.setBanner(
        'lead_change',
        `${p?.name ?? '???'} TAKES THE LEAD!`,
        p?.color ?? '#FFFFFF',
      );
    }
  }

  private setBanner(
    kind: 'lead_change' | 'streak' | 'hype',
    text: string,
    color: string,
  ): void {
    this.banner = { kind, text, color, at: this.now() };
  }

  // ── Config + match control (REST) ─────────────────────────────────────────

  setConfig(cfg: {
    scoring?: Partial<
      Record<KbtExerciseKey, Partial<{ enabled: boolean; points: number }>>
    >;
    strictTechnique?: boolean;
    heatDurationMs?: number;
    heatSize?: number;
    /** Lifter orientation vs the phone camera; reaches the analyzer at the
     * next heat staging (a mid-heat flip applies from the following heat). */
    cameraView?: 'front' | 'side';
    /** Save an apex still per counted rep; reaches the analyzer at the next
     * heat staging, like cameraView. */
    repScreenshots?: boolean;
    /** Every-5th-rep on-air celebration (aura + tile shake). */
    milestoneFx?: boolean;
    /** Floating "SNATCH +3" / "SNATCH*" text on every scored rep. */
    repFloatText?: boolean;
    /** When false, incorrect reps add no reps and no points. */
    countIncorrectReps?: boolean;
    /** Performance knobs; live ones apply immediately, recording ones from
     * the next recording start. */
    perf?: Partial<KbtPerfConfig>;
    /** Athlete join URL — becomes the lobby scene's on-air QR. */
    joinUrl?: string;
    /** Short human-readable address shown next to the QR (defaults to the
     * joinUrl's hostname). */
    joinLabel?: string;
  }): KbtConfig {
    if (typeof cfg.joinLabel === 'string' && cfg.joinLabel.trim()) {
      this.joinLabel = cfg.joinLabel.trim().slice(0, 40);
    }
    if (
      typeof cfg.joinUrl === 'string' &&
      cfg.joinUrl &&
      cfg.joinUrl !== this.joinUrl
    ) {
      this.joinUrl = cfg.joinUrl;
      if (!this.joinLabel) {
        try {
          this.joinLabel = new URL(cfg.joinUrl).host;
        } catch {
          this.joinLabel = cfg.joinUrl.slice(0, 40);
        }
      }
      this.qrImageId = null;
      void this.deps
        .registerJoinQr(cfg.joinUrl)
        .then((imageId) => {
          this.qrImageId = imageId;
          this.publishHud();
        })
        .catch((err) =>
          console.error('[kbt] join QR registration failed', err),
        );
    }
    if (cfg.scoring) {
      for (const key of KBT_EXERCISE_KEYS) {
        const patch = cfg.scoring[key];
        if (!patch) continue;
        const rule = this.config.scoring[key];
        if (typeof patch.enabled === 'boolean') rule.enabled = patch.enabled;
        if (typeof patch.points === 'number' && Number.isFinite(patch.points)) {
          rule.points = Math.round(clamp(patch.points, 0, 50));
        }
      }
    }
    if (typeof cfg.strictTechnique === 'boolean') {
      this.config.strictTechnique = cfg.strictTechnique;
    }
    if (
      typeof cfg.heatDurationMs === 'number' &&
      Number.isFinite(cfg.heatDurationMs)
    ) {
      this.config.heatDurationMs = Math.round(
        clamp(cfg.heatDurationMs, HEAT_MIN_DURATION_MS, HEAT_MAX_DURATION_MS),
      );
    }
    if (typeof cfg.heatSize === 'number' && Number.isFinite(cfg.heatSize)) {
      this.config.heatSize = Math.round(
        clamp(cfg.heatSize, HEAT_MIN_SIZE, HEAT_MAX_SIZE),
      );
    }
    if (cfg.cameraView === 'front' || cfg.cameraView === 'side') {
      this.config.cameraView = cfg.cameraView;
    }
    if (typeof cfg.repScreenshots === 'boolean') {
      this.config.repScreenshots = cfg.repScreenshots;
    }
    if (typeof cfg.milestoneFx === 'boolean') {
      this.config.milestoneFx = cfg.milestoneFx;
    }
    if (typeof cfg.repFloatText === 'boolean') {
      this.config.repFloatText = cfg.repFloatText;
    }
    if (typeof cfg.countIncorrectReps === 'boolean') {
      this.config.countIncorrectReps = cfg.countIncorrectReps;
    }
    if (cfg.perf) this.applyPerfConfig(cfg.perf);
    this.broadcastState();
    return structuredClone(this.config);
  }

  private applyPerfConfig(patch: Partial<KbtPerfConfig>): void {
    const perf = this.config.perf;
    const prevFps = perf.analysisFpsOverride;
    if (patch.analysisFpsOverride === null) {
      perf.analysisFpsOverride = null;
    } else if (
      typeof patch.analysisFpsOverride === 'number' &&
      Number.isFinite(patch.analysisFpsOverride)
    ) {
      perf.analysisFpsOverride = Math.round(
        clamp(patch.analysisFpsOverride, 8, 16),
      );
    }
    if (
      patch.animTickHz === 60 ||
      patch.animTickHz === 30 ||
      patch.animTickHz === 15
    ) {
      perf.animTickHz = patch.animTickHz;
    }
    if (
      patch.hudPublishHz === 10 ||
      patch.hudPublishHz === 5 ||
      patch.hudPublishHz === 2
    ) {
      perf.hudPublishHz = patch.hudPublishHz;
    }
    if (
      patch.recordingPreset === 'ultrafast' ||
      patch.recordingPreset === 'superfast' ||
      patch.recordingPreset === 'veryfast' ||
      patch.recordingPreset === 'fast' ||
      patch.recordingPreset === 'medium'
    ) {
      perf.recordingPreset = patch.recordingPreset;
    }
    if (
      patch.recordingScale === 1 ||
      patch.recordingScale === 0.75 ||
      patch.recordingScale === 0.5
    ) {
      perf.recordingScale = patch.recordingScale;
    }
    // Live knobs land immediately; recording knobs are read at record start.
    this.hudMinIntervalMs = Math.round(1000 / perf.hudPublishHz);
    this.deps.setAnimTickMs(Math.round(1000 / perf.animTickHz));
    if (perf.analysisFpsOverride !== prevFps) this.repushCoachParams();
  }

  getConfig(): KbtConfig {
    return structuredClone(this.config);
  }

  /** True once any host control action ran — marks the room as a KBT arena. */
  isEngaged(): boolean {
    return this.engaged;
  }

  controlMatch(cmd: KbtMatchCommand): {
    state: KbtStateEvent;
    match: KbtMatchEvent;
    /** Present when the action was refused — the snapshots are fresh anyway. */
    error?: KbtMatchError;
  } {
    // One rule the commentator can rely on: every show action returns the
    // broadcast to AUTO (the action's own scene is the point of the action).
    // The output overlay follows the same rule; the skeleton mode survives
    // (it's a look preference, not a scene).
    const hadOverride =
      this.viewOverride.mode !== 'auto' || this.commentatorOverlay != null;
    if (hadOverride) {
      this.viewOverride = { mode: 'auto' };
      this.commentatorOverlay = null;
    }
    this.engaged = true;
    let error: KbtMatchError | undefined;
    switch (cmd.action) {
      case 'roster':
        this.phase = 'roster';
        this.currentHeatIndex = null;
        void this.layoutRosterMosaic();
        break;
      case 'assign_heats':
        this.assignHeats();
        break;
      case 'start_heat': {
        const index = cmd.heatIndex ?? this.currentHeatIndex ?? 0;
        const heat = this.heats[index];
        if (!heat || heat.phase !== 'idle') {
          error = {
            code: 'heat_not_idle',
            message: heat
              ? `Heat ${index + 1} already ran or is running — start refused.`
              : `No heat ${index + 1} to start.`,
          };
        } else {
          void this.startHeat(index);
        }
        break;
      }
      case 'begin_heat':
        error = this.beginHeat(false) ?? undefined;
        break;
      case 'force_begin':
        error = this.beginHeat(true) ?? undefined;
        break;
      case 'stop_heat':
        this.stopHeat();
        break;
      case 'next_heat':
        this.nextHeat();
        break;
      case 'start_final':
        error = this.startFinal() ?? undefined;
        break;
      case 'podium':
        this.phase = 'podium';
        break;
      case 'reset':
        this.resetTournament();
        break;
      case 'kick_player':
        error = this.kickPlayer(cmd.clientId) ?? undefined;
        break;
      case 'restart_heat':
        error = this.restartHeat() ?? undefined;
        break;
    }
    this.ensureRunning();
    this.broadcastState();
    // The release of a forced view is commentator-visible feedback — cut the
    // chrome to the derived scene immediately instead of after the hold.
    if (hadOverride) this.publishHud(true);
    const match = this.getMatchSnapshot();
    this.deps.broadcast(match);
    return { state: this.stateSnapshot(), match, error };
  }

  /** Chunk the roster (join order) into qualification heats of heatSize. */
  private assignHeats(): void {
    const entrants = [...this.players.values()];
    this.heats = [];
    const size = this.config.heatSize;
    for (let i = 0; i < entrants.length; i += size) {
      const chunk = entrants.slice(i, i + size);
      const index = this.heats.length;
      for (const p of chunk) p.heatIndex = index;
      this.heats.push(
        this.blankHeat(
          index,
          false,
          chunk.map((p) => p.clientId),
        ),
      );
    }
    // A trailing solo entrant folds into the previous heat (max size permits).
    const last = this.heats[this.heats.length - 1];
    const prev = this.heats[this.heats.length - 2];
    if (
      last &&
      prev &&
      last.playerIds.length === 1 &&
      prev.playerIds.length < HEAT_MAX_SIZE
    ) {
      const soloId = last.playerIds[0];
      prev.playerIds.push(soloId);
      const solo = this.players.get(soloId);
      if (solo) solo.heatIndex = prev.index;
      this.heats.pop();
    }
    this.phase = this.heats.length > 0 ? 'heats' : 'roster';
    this.currentHeatIndex = this.heats.length > 0 ? 0 : null;
  }

  private blankHeat(
    index: number,
    final: boolean,
    playerIds: string[],
  ): HeatState {
    return {
      index,
      final,
      phase: 'idle',
      playerIds,
      startsAt: null,
      endsAt: null,
      scores: new Map(),
      winner: null,
      finalized: false,
      lastBroadcastAt: 0,
    };
  }

  /**
   * Put a heat on stage: fresh score sheets, camera tiles laid out, AI on for
   * exactly these inputs (rate tuned to the heat size). Players check their
   * framing ('POSE ✓') until the host begins the round.
   */
  private async startHeat(heatIndex?: number): Promise<void> {
    const index = heatIndex ?? this.currentHeatIndex ?? 0;
    const heat = this.heats[index];
    if (!heat || heat.phase !== 'idle') return;
    this.currentHeatIndex = index;
    heat.phase = 'intro';
    heat.scores = new Map(
      heat.playerIds.flatMap((id) => {
        const p = this.players.get(id);
        if (!p) return [];
        return [[id, this.blankScore(p)]] as const;
      }),
    );
    this.leaderId = null;
    this.banner = null;
    this.ensureRunning();
    await this.stageActiveHeat();
    this.publishHud();
  }

  private blankScore(p: PlayerState): ScoreState {
    return {
      points: 0,
      reps: { swing: 0, clean: 0, snatch: 0 },
      attempts: 0,
      incorrectReps: 0,
      streak: 0,
      bestStreak: 0,
      name: p.name,
      color: p.color,
      photoUrl: p.photoUrl,
      exercise: 'idle',
      lastRepAt: null,
      lastRepVerdict: null,
      lastRepPoints: 0,
      repTimes: [],
      repShots: [],
      fxAt: null,
      fxExercise: null,
    };
  }

  private camAspect(p: PlayerState): number {
    return p.camWidth && p.camHeight ? p.camWidth / p.camHeight : 16 / 9;
  }

  /**
   * Contain-fit a centered row of camera tiles: each column at the cam's own
   * aspect (16:9 when unreported), full height when the row fits, uniformly
   * scaled down and vertically centered when it doesn't. With the content box
   * now matching the source aspect (toInputConfig native-dims fallback) this
   * shows the WHOLE portrait frame instead of pillarboxed crops. Rounding
   * accumulates x so the last tile lands flush.
   */
  private tileRow(cams: { inputId: string; aspect: number }[]): {
    inputId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] {
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

  /**
   * Apply a player-tile layout, always appending the commentator's input so
   * its audio stays in the mix (updateLayers REPLACES the layer's inputs —
   * an input missing from the list falls silent). The caster tile is the
   * lower-third cam rect on the "talking head" scenes and a 1×1 offscreen
   * pixel during heats (audio-only commentary over the action).
   */
  private async applyLayout(tiles: KbtStageTile[]): Promise<void> {
    // Only the AUTO-derived tiles are remembered — a forced view must never
    // clobber what the stage returns to when the override clears.
    this.lastTiles = tiles;
    await this.applyStage();
  }

  /**
   * Push the effective stage to the engine: the override's tiles when a view
   * is forced, the AUTO tiles otherwise, and the commentator input exactly
   * once — as a main tile on caster/split, as the lower-third / offscreen
   * audio-only rect everywhere else. Every other known input is parked at a
   * 1×1 offscreen pixel: the layout must mention ALL of them, or RoomState's
   * unplaced-input auto-append resurrects the missing ones at their stale
   * rects on top of the stage (parking also keeps their decoders warm).
   * Park/unpark tiles never scale to/from the parking pixel: an entering
   * tile lands on its rect instantly and fades in, a leaving tile holds its
   * on-stage rect through a fade-out and parks on parkTimer; staged→staged
   * moves glide with ease-in-out.
   */
  private async applyStage(): Promise<void> {
    // A new stage supersedes any pending park commit from the previous one.
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    const override = this.overrideTiles();
    const all: KbtStageTile[] = [...(override ?? this.lastTiles)];
    const resolution = this.deps.getResolution();
    const casterInput = this.commentator?.inputId;
    if (casterInput && !all.some((t) => t.inputId === casterInput)) {
      all.push({
        inputId: casterInput,
        ...kbtCasterCamRect(
          resolution,
          kbtCasterVisible(this.stagedScene, this.casterPip),
        ),
      });
    }
    for (const p of this.players.values()) {
      if (p.inputId != null && !all.some((t) => t.inputId === p.inputId)) {
        all.push({ inputId: p.inputId, ...kbtParkRect(resolution) });
      }
    }
    const staged = new Set(
      all.filter((t) => t.width > 1).map((t) => t.inputId),
    );
    this.lastDesiredTiles = all;
    const fade = {
      type: this.viewTransitionStyle,
      durationMs: KBT_VIEW_TRANSITION_MS,
    };
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
        // Entering from park: land on the rect instantly, fade the video in.
        this.deps.runInputTransition(t.inputId, { ...fade, direction: 'in' });
        return { ...t, transitionDurationMs: 0 };
      }
      const leaving = this.leavingTiles.get(t.inputId);
      if (leaving && leaving.until - PARK_LEAD_MS > now) {
        // Still mid-fade-out: keep holding the on-stage rect, the running
        // fade needs no restart.
        nextParkAt = Math.min(nextParkAt, leaving.until - PARK_LEAD_MS);
        return { ...t, ...leaving.rect, transitionDurationMs: 0 };
      }
      if (leaving) this.leavingTiles.delete(t.inputId);
      const rect = wasStaged ? this.lastAppliedRects.get(t.inputId) : undefined;
      if (rect) {
        // Leaving the stage: hold the rect through a fade-out; the park
        // itself commits in commitParks.
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
    try {
      await this.deps.layoutTiles(decorated);
    } catch (err) {
      console.error('[kbt] layoutTiles failed', err);
    }
  }

  /**
   * Park every leaver whose fade-out has (nearly) run — PARK_LEAD_MS early,
   * so the 1×1 rect lands before InputManager restores full opacity — and
   * keep holding the rest, rescheduling for the earliest of them.
   */
  private commitParks(): void {
    this.parkTimer = null;
    const now = this.now();
    let nextAt = Infinity;
    const tiles = this.lastDesiredTiles.map((t) => {
      const leaving = this.leavingTiles.get(t.inputId);
      if (!leaving) {
        // Re-glide staying tiles: a commit can land mid-glide, and a bare
        // re-apply of the target rect would snap the move.
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
      console.error('[kbt] park layoutTiles failed', err);
    });
  }

  /** Re-apply the current stage (scene flip moved the caster cam rect, the
   * commentator input appeared/vanished, or a view override changed). */
  private async restage(): Promise<void> {
    await this.applyStage();
  }

  /** Lay out the active heat's cams as aspect-true columns and arm their AI. */
  private async stageActiveHeat(): Promise<void> {
    const heat =
      this.currentHeatIndex != null ? this.heats[this.currentHeatIndex] : null;
    if (!heat || heat.phase === 'idle' || heat.phase === 'ended') return;
    const staged = heat.playerIds
      .map((id) => this.players.get(id))
      .filter((p): p is PlayerState => !!p && p.inputId != null);
    await this.applyLayout(
      this.tileRow(
        staged.map((p) => ({
          inputId: p.inputId!,
          aspect: this.camAspect(p),
        })),
      ),
    );
    const fps = this.effectiveAnalysisFps(heat.playerIds.length);
    for (const p of staged) {
      void this.deps
        .setKettlebellCoach(p.inputId!, true, this.coachParams(fps))
        .catch((err) =>
          console.error(`[kbt] enable coach failed for ${p.inputId}`, err),
        );
    }
  }

  /** Everybody's camera in a mosaic while the roster fills (self-check + fun). */
  private async layoutRosterMosaic(): Promise<void> {
    if (this.phase !== 'roster') return;
    const cams = [...this.players.values()]
      .filter((p) => p.inputId != null)
      .slice(0, ROSTER_MOSAIC_MAX);
    await this.applyLayout(
      this.tileRow(
        cams.map((p) => ({
          inputId: p.inputId!,
          aspect: this.camAspect(p),
        })),
      ),
    );
  }

  /** Every lifter of this heat still exists, reached the briefing screen and
   *  has a live camera. Hard gate for begin_heat; the host UI mirrors it. */
  private heatReady(heat: HeatState): boolean {
    return heat.playerIds.every((id) => {
      const p = this.players.get(id);
      return !!p && p.briefed && p.camConnected;
    });
  }

  /**
   * intro → countdown; the AMRAP clock arms at countdown end. `force` is the
   * host's explicit override of the ready gate (a dead phone must not block
   * the whole heat forever) — it still needs at least one live camera.
   */
  private beginHeat(force: boolean): KbtMatchError | null {
    const heat = this.activeHeat();
    if (!heat || heat.phase !== 'intro') {
      return {
        code: 'heat_not_intro',
        message: 'No heat is on stage — start it first.',
      };
    }
    if (!this.heatReady(heat)) {
      const waiting: string[] = [];
      for (const id of heat.playerIds) {
        const p = this.players.get(id);
        if (!p) waiting.push('(gone)');
        else if (!p.briefed || !p.camConnected) waiting.push(p.name);
      }
      if (!force) {
        return {
          code: 'not_ready',
          message: `Waiting for: ${waiting.join(', ')}.`,
          context: { players: waiting.join(', ') },
        };
      }
      const anyLive = heat.playerIds.some(
        (id) => this.players.get(id)?.camConnected,
      );
      if (!anyLive) {
        return {
          code: 'no_live_camera',
          message: 'Cannot force start — no live camera in this heat.',
        };
      }
    }
    const now = this.now();
    heat.phase = 'countdown';
    heat.startsAt = now + COUNTDOWN_MS;
    heat.endsAt = heat.startsAt + this.config.heatDurationMs;
    heat.lastBroadcastAt = now;
    this.publishHud();
    return null;
  }

  /**
   * Drop a participant on the host's order: free their gate slot in every
   * heat so the show can go on without them. Rows already scored in
   * running/played heats survive (score sheets snapshot name/color).
   */
  private kickPlayer(clientId?: string): KbtMatchError | null {
    if (!clientId) {
      return { code: 'bad_action', message: 'kick_player needs a clientId.' };
    }
    const p = this.players.get(clientId);
    if (!p) {
      return { code: 'unknown_player', message: 'No such player.' };
    }
    this.retireCamera(p);
    this.players.delete(clientId);
    this.clearViewOverrideIfPlayer(clientId);
    this.clearCommentatorOverlayIfPlayer(clientId);
    for (const heat of this.heats) {
      if (!heat.playerIds.includes(clientId)) continue;
      heat.playerIds = heat.playerIds.filter((id) => id !== clientId);
      // A heat that never got underway loses the empty score row too.
      if (heat.phase === 'idle' || heat.phase === 'intro') {
        heat.scores.delete(clientId);
      }
    }
    const heat = this.activeHeat();
    if (
      heat &&
      (heat.phase === 'intro' ||
        heat.phase === 'countdown' ||
        heat.phase === 'playing')
    ) {
      void this.stageActiveHeat();
    } else if (this.phase === 'roster') {
      void this.layoutRosterMosaic();
    }
    return null;
  }

  /**
   * Re-run a heat that never finished (mass disconnect, false start). Wipes
   * the heat's scores — it didn't complete, so partial reps must not stand —
   * and returns it to a fresh intro with tiles restaged and AI re-armed.
   */
  private restartHeat(): KbtMatchError | null {
    const heat = this.activeHeat();
    if (
      !heat ||
      (heat.phase !== 'intro' &&
        heat.phase !== 'countdown' &&
        heat.phase !== 'playing')
    ) {
      return {
        code: 'heat_not_intro',
        message: 'Only a heat in progress can be restarted.',
      };
    }
    this.disarmHeatAI(heat);
    heat.phase = 'idle';
    heat.startsAt = null;
    heat.endsAt = null;
    heat.scores = new Map();
    heat.winner = null;
    heat.finalized = false;
    this.leaderId = null;
    this.banner = null;
    void this.startHeat(heat.index);
    return null;
  }

  private stopHeat(): void {
    const heat = this.activeHeat();
    if (!heat || heat.phase === 'ended') return;
    const now = this.now();
    heat.phase = 'ended';
    if (heat.endsAt == null || heat.endsAt > now) heat.endsAt = now;
    this.finalizeHeat(heat);
  }

  /** Advance to the next idle heat (its intro still needs start_heat). */
  private nextHeat(): void {
    const next = this.heats.find((h) => h.phase === 'idle');
    this.currentHeatIndex = next ? next.index : null;
  }

  /** Top heatSize players by best qualification score re-run as the final. */
  private startFinal(): KbtMatchError | null {
    const ranked = [...this.players.values()]
      .filter((p) => p.bestScore > 0 || p.heatIndex != null)
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, this.config.heatSize);
    if (ranked.length < 2) {
      return {
        code: 'too_few_finalists',
        message: 'A final needs at least two ranked players.',
      };
    }
    const index = this.heats.length;
    this.heats.push(
      this.blankHeat(
        index,
        true,
        ranked.map((p) => p.clientId),
      ),
    );
    this.phase = 'final';
    this.currentHeatIndex = index;
    return null;
  }

  private resetTournament(): void {
    for (const heat of this.heats) {
      if (heat.phase !== 'idle' && heat.phase !== 'ended') {
        this.disarmHeatAI(heat);
      }
    }
    this.heats = [];
    this.currentHeatIndex = null;
    this.phase = 'roster';
    this.leaderId = null;
    this.banner = null;
    for (const p of this.players.values()) {
      p.bestScore = 0;
      p.finalScore = null;
      p.heatIndex = null;
      p.repShots = [];
    }
    void this.layoutRosterMosaic();
  }

  // ── Heat clock + publish loop ─────────────────────────────────────────────

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
    const heat = this.activeHeat();
    const now = this.now();
    const lingering =
      heat &&
      heat.phase === 'ended' &&
      heat.endsAt != null &&
      now - heat.endsAt < ENDED_LINGER_MS;
    const live =
      heat &&
      (heat.phase === 'intro' ||
        heat.phase === 'countdown' ||
        heat.phase === 'playing');
    if (!live && !lingering && this.players.size === 0 && !this.commentator) {
      this.stop();
    }
  }

  private tick(): void {
    const now = this.now();
    this.tickHeat(now);
    this.pollCameras(now);
    const heat = this.activeHeat();
    if (heat) {
      const withinLinger =
        heat.phase !== 'ended' ||
        (heat.endsAt != null && now - heat.endsAt < ENDED_LINGER_MS);
      // Publish through the linger (clock/winner card), then once more when
      // the linger expires so the scene flips to the standings board.
      const sceneFlip = this.stagedScene !== this.computeScene();
      if (withinLinger || sceneFlip) {
        if (sceneFlip || now - this.lastPeriodicHudAt >= this.hudMinIntervalMs) {
          this.lastPeriodicHudAt = now;
          this.publishHud();
        }
      }
    }
    this.maybeStop();
  }

  private tickHeat(now: number): void {
    const heat = this.activeHeat();
    if (!heat) return;
    if (
      heat.phase === 'countdown' &&
      heat.startsAt != null &&
      now >= heat.startsAt
    ) {
      heat.phase = 'playing';
      heat.lastBroadcastAt = now;
      this.deps.broadcast(this.getMatchSnapshot());
      return;
    }
    if (heat.phase === 'playing' && heat.endsAt != null && now >= heat.endsAt) {
      heat.phase = 'ended';
      // The clock shows TIME! immediately; winner + frozen board wait out the
      // rep grace so a buzzer-beater rep still lands.
      this.deps.broadcast(this.getMatchSnapshot());
      return;
    }
    if (
      heat.phase === 'ended' &&
      !heat.finalized &&
      heat.endsAt != null &&
      now - heat.endsAt > REP_GRACE_MS
    ) {
      this.finalizeHeat(heat);
      return;
    }
    if (
      (heat.phase === 'countdown' ||
        heat.phase === 'playing' ||
        heat.phase === 'intro') &&
      now - heat.lastBroadcastAt >= MATCH_BROADCAST_MS
    ) {
      heat.lastBroadcastAt = now;
      this.deps.broadcast(this.getMatchSnapshot());
    }
  }

  /** Freeze the heat: crown the winner, roll best/final scores, AI off. */
  private finalizeHeat(heat: HeatState): void {
    if (heat.finalized) return;
    heat.finalized = true;
    const rows = [...heat.scores.entries()].sort(
      (a, b) => b[1].points - a[1].points,
    );
    const top = rows[0];
    const isDraw =
      !top || (rows.length > 1 && rows[1][1].points === top[1].points);
    heat.winner =
      top && !isDraw
        ? {
            clientId: top[0],
            name: top[1].name,
            color: top[1].color,
            points: top[1].points,
          }
        : null;
    for (const [clientId, score] of heat.scores) {
      const p = this.players.get(clientId);
      if (!p) continue;
      if (heat.final) {
        p.finalScore = score.points;
        if (score.repShots.length) p.repShots = [...score.repShots];
      } else {
        if (score.points >= p.bestScore && score.repShots.length) {
          p.repShots = [...score.repShots];
        }
        p.bestScore = Math.max(p.bestScore, score.points);
      }
    }
    this.disarmHeatAI(heat);
    this.deps.broadcast(this.getMatchSnapshot());
    this.broadcastState();
    this.publishHud();
  }

  private disarmHeatAI(heat: HeatState): void {
    for (const id of heat.playerIds) {
      const p = this.players.get(id);
      if (p?.inputId) {
        void this.deps.setKettlebellCoach(p.inputId, false).catch(() => {});
        p.poseTracked = false;
      }
    }
  }

  /** 1 Hz: reflect WHIP ack liveness into camConnected / SIGNAL LOST. */
  private pollCameras(now: number): void {
    if (now - this.lastCamPoll < 1000) return;
    this.lastCamPoll = now;
    const isLive = this.deps.isInputLive ?? this.deps.isInputConnected;
    let changed = false;
    for (const p of this.players.values()) {
      const connected = p.inputId != null && isLive(p.inputId);
      if (connected !== p.camConnected) {
        p.camConnected = connected;
        if (connected) {
          p.camDownAt = null;
        } else {
          p.camDownAt = now;
          // No frames are reaching the coach — a lingering POSE ✓ would lie.
          p.poseTracked = false;
          p.fullBody = true;
        }
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
    this.expireStaleOverride(now);
    if (changed) this.broadcastState();
  }

  /**
   * A forced view pinned to a participant who dropped (socket gone or camera
   * dark for a while) would freeze the broadcast on a dead tile — release it
   * back to AUTO after a short grace so blips don't cut the scene.
   */
  private expireStaleOverride(now: number): void {
    const o = this.viewOverride;
    if (o.mode !== 'player_solo' && o.mode !== 'split') return;
    const p = this.players.get(o.playerId);
    const gone =
      !p ||
      (!p.connected &&
        p.disconnectedAt != null &&
        now - p.disconnectedAt > OVERRIDE_STALE_MS) ||
      (!p.camConnected &&
        p.camDownAt != null &&
        now - p.camDownAt > OVERRIDE_STALE_MS);
    if (gone) this.clearViewOverride();
  }

  // ── Snapshots + HUD ───────────────────────────────────────────────────────

  stateSnapshot(): KbtStateEvent {
    return {
      type: 'kbt_state',
      roomId: this.roomId,
      tournamentPhase: this.phase,
      config: structuredClone(this.config),
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      heats: this.heats.map((h) => this.heatSummary(h)),
      currentHeatIndex: this.currentHeatIndex,
      commentator: this.commentator
        ? {
            name: this.commentator.name,
            camConnected: this.commentator.camConnected,
          }
        : null,
      scene: this.computeScene(),
      viewOverride: { ...this.viewOverride },
      commentatorOverlay: this.commentatorOverlay
        ? { ...this.commentatorOverlay }
        : { kind: 'none' },
      skeletonMode: this.skeletonMode,
      casterPip: this.casterPip,
      viewTransitionStyle: this.viewTransitionStyle,
      isRecording: this.deps.hasActiveRecording?.() ?? false,
    };
  }

  private publicPlayer(p: PlayerState): KbtPlayer {
    return {
      clientId: p.clientId,
      name: p.name,
      color: p.color,
      connected: p.connected,
      camConnected: p.camConnected,
      poseTracked: p.poseTracked,
      briefed: p.briefed,
      bestScore: p.bestScore,
      finalScore: p.finalScore,
      heatIndex: p.heatIndex,
      photoUrl: p.photoUrl,
      ...(p.repShots.length ? { repShots: [...p.repShots] } : {}),
    };
  }

  private heatSummary(h: HeatState): KbtHeatSummary {
    return {
      index: h.index,
      final: h.final,
      phase: h.phase,
      playerIds: [...h.playerIds],
      scores: this.scoresRecord(h),
    };
  }

  private scoresRecord(h: HeatState): Record<string, KbtScoreBreakdown> {
    const out: Record<string, KbtScoreBreakdown> = {};
    for (const [id, s] of h.scores) {
      out[id] = {
        points: s.points,
        reps: { ...s.reps },
        incorrectReps: s.incorrectReps,
        bestStreak: s.bestStreak,
        name: s.name,
        color: s.color,
        photoUrl: s.photoUrl,
        ...(s.repShots.length ? { repShots: [...s.repShots] } : {}),
      };
    }
    return out;
  }

  getMatchSnapshot(): KbtMatchEvent {
    const heat =
      this.currentHeatIndex != null ? this.heats[this.currentHeatIndex] : null;
    if (!heat) {
      return {
        type: 'kbt_match',
        roomId: this.roomId,
        heatIndex: null,
        final: false,
        phase: 'idle',
        scores: {},
      };
    }
    const now = this.now();
    return {
      type: 'kbt_match',
      roomId: this.roomId,
      heatIndex: heat.index,
      final: heat.final,
      phase: heat.phase,
      startsAtMs: heat.startsAt ?? undefined,
      endsAtMs: heat.endsAt ?? undefined,
      remainingMs:
        heat.phase === 'countdown' && heat.startsAt != null
          ? Math.max(0, heat.startsAt - now)
          : heat.phase === 'playing' && heat.endsAt != null
            ? Math.max(0, heat.endsAt - now)
            : undefined,
      scores: this.scoresRecord(heat),
      winner:
        heat.phase === 'ended' && heat.finalized ? heat.winner : undefined,
    };
  }

  private broadcastState(): void {
    this.deps.broadcast(this.stateSnapshot());
    // Every roster/cam/phase change also refreshes the burned-in scene (the
    // lobby list, board rows etc. only move on such changes; during heats the
    // 10 Hz tick publishes anyway and an extra held snapshot is harmless).
    this.publishHud();
  }

  /** Which broadcast scene the current tournament state maps to. */
  private computeScene(): KbtHudScene {
    const forced = this.overrideScene();
    if (forced) return forced;
    if (this.phase === 'podium') return 'podium';
    if (this.phase === 'roster') return 'lobby';
    const heat = this.activeHeat();
    if (heat) {
      const pastLinger =
        heat.phase === 'ended' &&
        heat.endsAt != null &&
        this.now() - heat.endsAt >= ENDED_LINGER_MS;
      if (!pastLinger) return heat.playerIds.length === 1 ? 'solo' : 'grid';
    }
    return 'board';
  }

  /** Clock-chip left section, e.g. `1' AMRAP · HEAT 2` / `10' SNATCH · FINAL`. */
  private heatLabelFor(heat: HeatState): string {
    const secs = Math.round(this.config.heatDurationMs / 1000);
    const dur = secs % 60 === 0 ? `${secs / 60}'` : `${secs}"`;
    const enabled = KBT_EXERCISE_KEYS.filter(
      (k) => this.config.scoring[k].enabled,
    );
    const what = enabled.length === 1 ? enabled[0].toUpperCase() : 'AMRAP';
    const which = heat.final ? 'FINAL' : `HEAT ${heat.index + 1}`;
    return `${dur} ${what} · ${which}`;
  }

  /**
   * Reps per minute over a rolling window. Early in a heat the window is the
   * elapsed time (floored to 15s so the first rep doesn't read as 60 RPM).
   */
  private rpmFor(score: ScoreState, heat: HeatState, now: number): number {
    const WINDOW_MS = 60_000;
    const cutoff = now - WINDOW_MS;
    while (score.repTimes.length > 0 && score.repTimes[0] < cutoff) {
      score.repTimes.shift();
    }
    if (score.repTimes.length === 0) return 0;
    const elapsed =
      heat.startsAt != null
        ? clamp(now - heat.startsAt, 15_000, WINDOW_MS)
        : WINDOW_MS;
    return Math.round((score.repTimes.length * 60_000) / elapsed);
  }

  /** Overall standings (final score beats best qualification score). */
  private rankedPlayers(): (PlayerState & { rankPoints: number })[] {
    return [...this.players.values()]
      .filter(
        (p) => p.heatIndex != null || p.bestScore > 0 || p.finalScore != null,
      )
      .map((p) => ({ ...p, rankPoints: p.finalScore ?? p.bestScore }))
      .sort(
        (a, b) =>
          (b.finalScore ?? -1) - (a.finalScore ?? -1) ||
          b.bestScore - a.bestScore,
      );
  }

  private boardRows(): KbtBoardRow[] {
    return this.rankedPlayers()
      .slice(0, 8)
      .map((p, i) => {
        // Reps/pace from the player's latest played heat (average over the
        // heat — the board shows results, not a live window).
        let reps = 0;
        for (let h = this.heats.length - 1; h >= 0; h--) {
          const s = this.heats[h].scores.get(p.clientId);
          if (s) {
            reps = s.reps.swing + s.reps.clean + s.reps.snatch;
            break;
          }
        }
        return {
          rank: i + 1,
          name: p.name,
          color: p.color,
          photoImageId: p.photoImageId,
          points: p.rankPoints,
          reps,
          rpm: Math.round((reps * 60_000) / this.config.heatDurationMs),
        };
      });
  }

  /**
   * One player's stat block for spotlight/h2h. Live values while the active
   * heat scores them; otherwise the newest played heat's sheet (board rules:
   * results, not a live window).
   */
  private statSideFor(
    playerId: string,
    now: number,
  ): { side: KbtStatSide; live: boolean } | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const heat = this.activeHeat();
    const activeScore = heat?.scores.get(playerId);
    if (heat && activeScore) {
      const reps =
        activeScore.reps.swing +
        activeScore.reps.clean +
        activeScore.reps.snatch;
      return {
        live: true,
        side: {
          name: p.name,
          color: p.color,
          photoImageId: p.photoImageId,
          points: activeScore.points,
          rpm: this.rpmFor(activeScore, heat, now),
          reps,
          streak: activeScore.streak,
          bestStreak: activeScore.bestStreak,
          accuracy:
            activeScore.attempts > 0
              ? (activeScore.attempts - activeScore.incorrectReps) /
                activeScore.attempts
              : null,
        },
      };
    }
    let sheet: ScoreState | null = null;
    for (let h = this.heats.length - 1; h >= 0; h--) {
      const s = this.heats[h].scores.get(playerId);
      if (s) {
        sheet = s;
        break;
      }
    }
    const reps = sheet
      ? sheet.reps.swing + sheet.reps.clean + sheet.reps.snatch
      : 0;
    return {
      live: false,
      side: {
        name: p.name,
        color: p.color,
        photoImageId: p.photoImageId,
        points: p.finalScore ?? p.bestScore,
        rpm: Math.round((reps * 60_000) / this.config.heatDurationMs),
        reps,
        streak: 0,
        bestStreak: sheet?.bestStreak ?? 0,
        accuracy:
          sheet && sheet.attempts > 0
            ? (sheet.attempts - sheet.incorrectReps) / sheet.attempts
            : null,
      },
    };
  }

  /**
   * The commentator overlay as burned-in HUD data. Re-resolved every publish
   * (players and shot lists can shift under a held identity) — a vanished
   * reference degrades to no overlay instead of a stale card.
   */
  private overlaySnapshot(now: number): KbtHudState['overlay'] {
    const o = this.commentatorOverlay;
    if (!o) return null;
    switch (o.kind) {
      case 'rep_shot': {
        const p = this.players.get(o.playerId);
        const shots = this.repShotsFor(o.playerId);
        if (!p || shots.length === 0) return null;
        const index = clamp(o.index, 0, shots.length - 1);
        const shot = shots[index];
        return {
          kind: 'rep_shot',
          player: { name: p.name, color: p.color },
          shot: {
            imageId: this.repShotImageIds.get(shot.url) ?? null,
            repIndex: shot.repIndex,
            exercise: shot.exercise,
            verdict: shot.verdict,
            points: shot.points,
            issues: (shot.issues ?? []).map(
              (c) => KETTLEBELL_ISSUE_LABELS[c] ?? c,
            ),
          },
          index,
          total: shots.length,
          showVerdict: o.showVerdict,
        };
      }
      case 'spotlight': {
        const s = this.statSideFor(o.playerId, now);
        return s ? { kind: 'spotlight', side: s.side, live: s.live } : null;
      }
      case 'h2h': {
        const a = this.statSideFor(o.playerIdA, now);
        const b = this.statSideFor(o.playerIdB, now);
        return a && b
          ? { kind: 'h2h', a: a.side, b: b.side, live: a.live && b.live }
          : null;
      }
    }
  }

  /**
   * Publish the burned-in HUD, held by HUD_HOLD_MS with a monotonic clamp so
   * snapshots land in order on the ~3s-delayed video (see HUD_HOLD_MS docs).
   * Builds the full scene snapshot (kb_design): lobby / solo / grid / board /
   * podium plus the commentator lower-third. `immediate` skips the hold — a
   * commentator-initiated scene cut must not wear the old scene's chrome for
   * 3s (the video inside the tiles still runs delayed; accepted for a cut).
   */
  private publishHud(immediate = false): void {
    if (this.disposed) return;
    const now = this.now();
    const scene = this.computeScene();
    if (scene !== this.stagedScene) {
      this.stagedScene = scene;
      // The caster cam rect is scene-dependent; move it with the scene.
      void this.restage();
      // Tick-driven flips (e.g. the post-linger board) must reach the panel
      // too, so its highlighted view tracks the broadcast. Direct broadcast —
      // broadcastState() would re-enter publishHud.
      this.deps.broadcast(this.stateSnapshot());
    }

    const heat = this.activeHeat();
    const tiles: Record<string, KbtHudTile> = {};
    let match: KbtHudState['match'] = null;
    let heatLabel: string | null = null;
    let leader: KbtHudState['leader'] = null;

    if (heat && (scene === 'solo' || scene === 'grid' || scene === 'split')) {
      heatLabel = this.heatLabelFor(heat);
      const ranked = [...heat.scores.entries()].sort(
        (a, b) => b[1].points - a[1].points,
      );
      const rankOf = new Map(ranked.map(([id], i) => [id, i + 1]));
      // A forced player view frames one athlete; the hero/tile chrome must
      // follow (SoloScene picks the first tile in the record).
      const featured =
        this.viewOverride.mode === 'player_solo' ||
        this.viewOverride.mode === 'split'
          ? this.viewOverride.playerId
          : null;
      for (const id of heat.playerIds) {
        if (featured && id !== featured) continue;
        const p = this.players.get(id);
        const s = heat.scores.get(id);
        if (!p?.inputId || !s) continue;
        tiles[p.inputId] = {
          clientId: id,
          name: s.name,
          color: s.color,
          photoImageId: p.photoImageId,
          points: s.points,
          reps: s.reps.swing + s.reps.clean + s.reps.snatch,
          repSeq: s.attempts,
          repsByExercise: { ...s.reps },
          rpm: this.rpmFor(s, heat, now),
          rank: rankOf.get(id) ?? heat.playerIds.length,
          streak: s.streak,
          exercise: s.exercise,
          flash: s.lastRepAt != null && now - s.lastRepAt <= REP_FLASH_MS,
          lastRepVerdict: s.lastRepVerdict,
          lastRepPoints: s.lastRepPoints,
          fx:
            s.fxAt != null &&
            s.fxExercise != null &&
            now - s.fxAt <= MILESTONE_FX_MS
              ? {
                  exercise: s.fxExercise,
                  color: KBT_EXERCISE_COLORS[s.fxExercise],
                  p: Math.min(1, (now - s.fxAt) / MILESTONE_FX_MS),
                }
              : null,
          signalLost: !p.camConnected && heat.phase !== 'intro',
        };
      }
      match = {
        phase: heat.phase === 'idle' ? 'intro' : heat.phase,
        heatIndex: heat.index,
        final: heat.final,
        startsAt: heat.startsAt,
        endsAt: heat.endsAt,
        remainingMs: quantizeClock(
          heat.phase === 'countdown' && heat.startsAt != null
            ? Math.max(0, heat.startsAt - now)
            : heat.phase === 'playing' && heat.endsAt != null
              ? Math.max(0, heat.endsAt - now)
              : heat.phase === 'ended'
                ? 0
                : null,
        ),
        winner: heat.finalized ? heat.winner : null,
      };
      const top = ranked[0];
      if (top && top[1].points > 0) {
        leader = { name: top[1].name, points: top[1].points };
      }
    } else {
      const top = this.rankedPlayers()[0];
      if (top && top.rankPoints > 0) {
        leader = { name: top.name, points: top.rankPoints };
      }
    }

    const banner =
      this.banner && now - this.banner.at <= BANNER_MS ? this.banner : null;
    const snapshot: KbtHudState = {
      scene,
      tiles,
      match,
      heatLabel,
      lobby:
        scene === 'lobby'
          ? {
              qrImageId: this.qrImageId,
              joinLabel: this.joinLabel,
              joined: [...this.players.values()].map((p) => ({
                name: p.name,
                color: p.color,
                camConnected: p.camConnected,
                photoImageId: p.photoImageId,
              })),
              joinedCount: this.players.size,
            }
          : null,
      board:
        scene === 'board'
          ? {
              rows: this.boardRows(),
              final: this.heats.some((h) => h.final && h.finalized),
            }
          : null,
      podium:
        scene === 'podium'
          ? {
              rows: this.rankedPlayers()
                .slice(0, 3)
                .map((p, i) => ({
                  rank: i + 1,
                  name: p.name,
                  color: p.color,
                  points: p.rankPoints,
                  photoImageId: p.photoImageId,
                })),
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
      leader,
      banner,
      overlay: this.overlaySnapshot(now),
      // Rides the same ~3s hold as everything else, so a mid-heat flip
      // reaches the air aligned with the delayed video.
      repFloatText: this.config.repFloatText,
      countIncorrectReps: this.config.countIncorrectReps,
      viewTransitionStyle: this.viewTransitionStyle,
    };
    if (immediate) {
      // Scene cut: supersede every queued held snapshot and land this one
      // now. Resetting the clamp lets the next held publish schedule from
      // the present instead of queueing behind stale timers.
      for (const t of this.hudTimers) clearTimeout(t);
      this.hudTimers.clear();
      this.hudApplyAt = now;
      this.deps.publishHud(snapshot);
    } else {
      this.applyHudHeld(snapshot);
    }
  }

  private applyHudHeld(state: KbtHudState | null): void {
    const now = this.now();
    const applyAt = Math.max(now + HUD_HOLD_MS, this.hudApplyAt + 1);
    this.hudApplyAt = applyAt;
    const timer = setTimeout(() => {
      this.hudTimers.delete(timer);
      if (!this.disposed) this.deps.publishHud(state);
    }, applyAt - now);
    this.hudTimers.add(timer);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const t of this.hudTimers) clearTimeout(t);
    this.hudTimers.clear();
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    for (const imageId of this.repShotImageIds.values()) {
      this.deps.unregisterRepShotImage(imageId);
    }
    this.repShotImageIds.clear();
    const retiredPhotos = new Set<string>();
    for (const p of this.players.values()) {
      if (p.inputId != null) {
        // Room teardown removes inputs itself; just drop our references.
        p.inputId = null;
      }
      if (p.photoPath && !retiredPhotos.has(p.photoPath)) {
        retiredPhotos.add(p.photoPath);
        this.deps.unregisterPlayerPhoto(p.photoImageId, p.photoPath);
      }
    }
    this.players.clear();
    if (this.commentator) this.commentator.inputId = null;
    this.commentator = null;
    this.heats = [];
    this.deps.publishHud(null);
  }
}

export { KETTLEBELL_COACH_ID as KBT_COACH_MODEL_ID };
