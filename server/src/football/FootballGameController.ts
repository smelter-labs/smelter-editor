import { randomUUID } from 'node:crypto';
import type {
  FbAiEventsStatus,
  FbAiRunState,
  FbCam,
  FbCamRole,
  FbClipClock,
  FbConfig,
  FbDirectorPatch,
  FbMinimapSize,
  FbDirectorState,
  FbErrorCode,
  FbEventEntry,
  FbEventKind,
  FbMatchAction,
  FbMatchEvent,
  FbPeriod,
  FbPhase,
  FbSession,
  FbSide,
  FbStateEvent,
  FbTeamId,
  FbTeamStats,
  FbTrackingStats,
  FbView,
  FbViewOverride,
  RoomEvent,
} from '@smelter-editor/types';
import {
  FB_CAM_ROLES,
  FB_DEFAULT_CONFIG,
  FB_DIRECTOR_LIMITS,
  FB_EVENT_KINDS,
  FB_MATCH_ACTIONS,
  FB_MINIMAP_SIZES,
  FB_PANO_VIEWS,
  FB_SMOOTHING_PRESET_MS,
  FB_TEAM_IDS,
  FB_TRICAM_VIEWS,
} from '@smelter-editor/types';
import type { FbHudScene, FbHudStage, FbHudState } from '../app/store';
import { KBT_VIEW_TRANSITION_MS, kbtParkRect } from '../app/store';
import { clamp } from '../core/mathUtils';
import {
  BALL_LOST_WIDE_MS,
  cropForReplay,
  cropOf,
  exactCropOf,
  goalCrop,
  resolvePanoView,
  stepFollow,
  stepTricam,
  tileForCrop,
  wideCrop,
  type Crop,
  type FollowState,
  type Pano,
  type TricamState,
} from './director';
import {
  aiConfidence,
  parseFbGroundTruth,
  selectAiEvents,
  type FbGtEvent,
} from './groundTruth';
import { FbAiLog, eventLabel, eventTitle } from './aiLog';
import {
  ballAt,
  ballMean,
  ballSpeedPx,
  centroidAt,
  emptyTelemetry,
  parseBall,
  parseClipMeta,
  parseZones,
  parseZxy,
  playersAt,
  sprintAt,
  statsAt,
  unprojectPitch,
  type FbTelemetry,
  type FbZxy,
} from './telemetry';

/** Command from the arcade page's match endpoint (and the panel over WS). */
export type FbMatchCommand = {
  action: FbMatchAction;
  /** Target camera for kick_cam. */
  role?: FbCamRole;
};

export type FbMatchError = {
  code: FbErrorCode;
  message: string;
  context?: Record<string, string | number>;
};

/** One tile of the manual `fb-stage` layout (same contract as BbStageTile). */
export type FbStageTile = {
  inputId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
};

export type FbFileClock = {
  anchorWallMs: number;
  playFromMs: number;
  durationMs: number | null;
  delayMs: number;
};

/** Raw sidecar JSONs next to a clip (parsed here so tests stay in-memory). */
export type FbClipTelemetryFiles = {
  meta?: unknown;
  zxy?: unknown;
  ball?: unknown;
  zones?: unknown;
};

/**
 * Everything the controller needs from the room, injected so tests can fake
 * the world (same pattern as BbControllerDeps). All camera/layout calls are
 * best-effort async — the controller never blocks its tick on them.
 */
export type FbControllerDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  removeInput: (inputId: string) => Promise<void>;
  setAnimTickMs: (ms: number) => void;
  /** Replace the output layout with these tiles (manual positions). */
  layoutTiles: (tiles: FbStageTile[]) => Promise<void>;
  runInputTransition: (
    inputId: string,
    transition: {
      type: 'fade' | 'dissolve';
      durationMs: number;
      direction: 'in' | 'out';
    },
  ) => void;
  isInputConnected: (inputId: string) => boolean;
  isInputLive?: (inputId: string) => boolean;
  getResolution: () => { width: number; height: number };
  hasActiveRecording?: () => boolean;
  publishHud: (state: FbHudState | null) => void;
  registerJoinQr: (url: string) => Promise<string>;
  registerReplayClip: (
    file: string,
    offsetMs: number,
  ) => Promise<string | null>;
  unregisterReplayClip: (inputId: string, file: string) => void;
  getPipelineTimeMs: () => number;
  getFileClock?: (inputId: string) => FbFileClock | null;
  resyncFileCams?: () => Promise<void>;
  /** The events sidecar next to a file clip (`<clip>.events.json`, then `events.json`). */
  loadClipEvents?: (
    clipFileName: string,
  ) => Promise<{ fileName: string; json: unknown } | null>;
  /** The telemetry sidecars next to a file clip (`<clip>.alfheim.json`, `zxy.json`, `ball.json`, `zones.json`). */
  loadClipTelemetry?: (
    clipFileName: string,
  ) => Promise<FbClipTelemetryFiles | null>;
  /**
   * Instant replay cut from a file cam's mp4: `mediaMs − 3 s … + 1 s` at
   * half speed into data/fb-replays, optionally cropped (source px).
   */
  cutReplayClip?: (
    clipFileName: string,
    mediaMs: number,
    eventId: string,
    crop?: { x: number; y: number; w: number; h: number },
  ) => Promise<{ file: string; durationMs: number } | null>;
  now?: () => number;
};

type CamState = {
  role: FbCamRole;
  inputId: string | null;
  camConnected: boolean;
  camWidth: number | null;
  camHeight: number | null;
  fileName: string | null;
  telemetry: FbTelemetry;
  telemetryFlags: {
    zxy: boolean;
    ball: boolean;
    zones: boolean;
    events: boolean;
  };
  /** A sidecar read is in flight. */
  telemetryLoading: boolean;
};

type CommentatorState = {
  clientId: string;
  commentatorKey: string;
  name: string;
  connected: boolean;
  /** Wall time the socket dropped (null while connected). */
  disconnectedAt: number | null;
};

type TeamTally = {
  score: number;
  chances: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  sprints: number;
};

type AiRun = {
  fileName: string;
  events: FbGtEvent[];
  cursor: number;
  loopIndex: number;
  fired: number;
  skipped: number;
  clockSig: string | null;
  nextFireAt: number | null;
};

type EventInput = {
  source: 'ai' | 'manual';
  kind: FbEventKind;
  team: FbTeamId | null;
  side?: FbSide;
  aiConfidence: number;
  /** goal from the AI: never auto-confirm. */
  candidate?: boolean;
  detail?: string;
  tag?: number;
  topKmh?: number;
  speedMs?: number;
  onTarget?: boolean;
  mediaMs?: number;
};

const TICK_MS = 100;
const MATCH_BROADCAST_MS = 1000;
/** The follow window steps on every controller tick (the gate absorbs timer jitter)… */
const DIRECTOR_TICK_MS = TICK_MS - 10;
/**
 * …and each step's tile glide outlasts the tick: the next step interrupts it
 * mid-flight, so the camera never arrives and waits (a late or dropped tick
 * just rides the same glide a little longer).
 */
const DIRECTOR_GLIDE_MS = 250;
const DIRECTOR_BROADCAST_MS = 1000;
const VIEW_SWITCH_MS = 600;
const PARK_LEAD_MS = 50;
const BANNER_MS = 4000;
const EVENT_BANNER_MS = 3500;
const REPLAY_CLIP_LEAD_MS = 250;
const REPLAY_OPEN_GRACE_MS = 3000;
const RECENT_EVENTS = 14;
/**
 * A looping demo clip re-fires its plays every lap, so an unattended room
 * would grow the ledger and the REF CALL queue for ever. Past these caps the
 * oldest REF CALLs expire (voided) and the oldest ledger rows are folded into
 * a base tally (the scores and stats stay exact, only the rows go).
 */
const MAX_PENDING = 12;
const MAX_LEDGER = 600;
const LEDGER_TRIM_BATCH = 100;
/** A moderator whose socket has been gone this long frees the seat. */
const COMMENTATOR_GONE_MS = 90_000;
const HALF_MIN_MS = 60_000;
const HALF_MAX_MS = 60 * 60_000;
/** An AI event whose fire time is further in the past than this is skipped. */
const AI_LATE_MAX_MS = 2000;
const AI_RUN_BROADCAST_MS = 1000;
/** Restart looping file cams this long before the first one reaches its end. */
const LOOP_RESYNC_LEAD_MS = 200;
/** AI events at or above this confidence are confirmed at once (goal candidates never are). */
const AUTO_CONFIRM_MIN_CONF = 0.6;
/** Kinds that get an on-air banner (the rest show as a chip / ledger row). */
const BANNER_KINDS = new Set<FbEventKind>(['goal', 'chance', 'shot', 'corner']);
/** Full-panorama size when the clip carries no zones (Alfheim). */
const DEFAULT_PANO: Pano = { w: 4450, h: 2000 };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isTeamId(v: unknown): v is FbTeamId {
  return v === 'A' || v === 'B';
}
function isCamRole(v: unknown): v is FbCamRole {
  return (FB_CAM_ROLES as readonly unknown[]).includes(v);
}
function isEventKind(v: unknown): v is FbEventKind {
  return (FB_EVENT_KINDS as readonly unknown[]).includes(v);
}
function emptyTally(): TeamTally {
  return {
    score: 0,
    chances: 0,
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    sprints: 0,
  };
}
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const q1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Football Game ("Touchline") for one room: dataset file cameras (a stitched
 * panorama or three fixed cameras), a virtual director cutting the broadcast
 * window, a two-half match clock, a ledger of plays fired from the clip's
 * annotated telemetry (goal candidates queued for the moderator) or entered
 * by the moderator, instant replay, a tracking minimap and the burned-in HUD.
 */
export class FootballGameController {
  private config: FbConfig = structuredClone(FB_DEFAULT_CONFIG);
  private readonly cams = new Map<FbCamRole, CamState>();
  private commentator: CommentatorState | null = null;

  // ── match clock ──
  private phase: FbPhase = 'lobby';
  private period: FbPeriod = 1;
  private matchStartedAt: number | null = null;
  private segmentStartedAt: number | null = null;
  private elapsedBeforeSegmentMs = 0;
  /** KICK-OFF took the clip's kick-off as the clock offset (config.clockFromClip). */
  private clockFromClipUsed = false;
  private endedAt: number | null = null;
  private winner: FbTeamId | null = null;

  // ── ledger ──
  private events: FbEventEntry[] = [];
  private eventSeq = 0;
  private tally: Record<FbTeamId, TeamTally> = {
    A: emptyTally(),
    B: emptyTally(),
  };
  private leader: FbTeamId | null = null;
  /** Tally + last leader of the rows trimmed off a very long ledger. */
  private baseTally: Record<FbTeamId, TeamTally> = {
    A: emptyTally(),
    B: emptyTally(),
  };
  private baseLeader: FbTeamId | null = null;
  private statsCache: {
    zxy: FbZxy;
    idx: number;
    stats: ReturnType<typeof statsAt>;
  } | null = null;
  private lastEvent: { event: FbEventEntry; at: number } | null = null;
  private banner: FbHudState['banner'] = null;

  // ── broadcast view / director ──
  private viewOverride: FbViewOverride = { mode: 'auto' };
  private stagedScene: FbHudScene = 'lobby';
  private lastStage: FbHudStage | null = null;
  private joinLabel: string | null = null;
  private joinUrl: string | null = null;
  private qrImageId: string | null = null;
  private follow: FollowState | null = null;
  private tricam: TricamState | null = null;
  private lastDirectorAt = 0;
  private lastDirectorBroadcastAt = 0;
  private directorApplying = false;
  private effectiveView: FbView = 'wide';
  private currentCrop: Crop | null = null;
  /** The same window unrounded — the tile is laid out from this one. */
  private currentCropExact: Crop | null = null;
  private ballLostSince: number | null = null;
  private ballTracked = false;
  private minimapOn = true;

  // ── instant replay ──
  private instantReplay: {
    eventId: string;
    file: string | null;
    inputId: string | null;
    durationMs: number;
    openAt: number;
    clipStartAt: number | null;
    closeAt: number | null;
    dropped: boolean;
  } | null = null;
  private instantReplayTimer: ReturnType<typeof setTimeout> | null = null;

  // ── layout machinery (ported from the kettlebell tournament) ──
  private lastStagedInputIds = new Set<string>();
  private lastAppliedRects = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  private lastDesiredTiles: FbStageTile[] = [];
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
  private hudMinIntervalMs = 200;
  private lastPeriodicHudAt = 0;
  private lastAppliedHud: FbHudState | null = null;

  // ── AI events ──
  private readonly aiLog = new FbAiLog();
  private aiEventsOn = true;
  private aiRun: AiRun | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private aiLoading = false;
  private aiFailedFor: string | null = null;
  private aiPrepared: {
    clip: string;
    fileName: string;
    events: FbGtEvent[];
    kickoffMs: number | null;
    attacks: Record<FbTeamId, FbSide> | null;
  } | null = null;
  private lastAiRunBroadcastAt = 0;
  private lastLoopResyncSig: string | null = null;
  /** Kick-off of the clip (media ms; negative when the clip starts mid-half). */
  private clipKickoffMs: number | null = null;
  /** Which team attacks the left goal in period 1, from the sidecar. */
  private clipAttacksLeft: FbTeamId | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCamPoll = 0;
  private lastMatchBroadcastAt = 0;
  private disposed = false;
  private engaged = false;

  isEngaged(): boolean {
    return this.engaged;
  }

  constructor(
    private readonly roomId: string,
    private readonly deps: FbControllerDeps,
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
      commentatorKey?: unknown;
      team?: unknown;
      color?: unknown;
      override?: unknown;
      action?: unknown;
      enabled?: unknown;
      eventId?: unknown;
      kind?: unknown;
      voided?: unknown;
      size?: unknown;
      director?: unknown;
    };
    switch (msg.type) {
      case 'fb_spectate':
        this.spectate(clientId);
        break;
      case 'fb_commentator_join':
        this.joinCommentator(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Moderator',
          typeof msg.commentatorKey === 'string' &&
            msg.commentatorKey.length <= 64
            ? msg.commentatorKey
            : undefined,
        );
        break;
      case 'fb_commentator_leave':
        this.leaveCommentator(clientId);
        break;
      case 'fb_commentator_view':
        this.setViewOverride(clientId, msg.override);
        break;
      case 'fb_commentator_ai_events':
        this.setAiEvents(clientId, msg.enabled);
        break;
      case 'fb_commentator_minimap':
        this.setMinimap(clientId, msg.enabled);
        break;
      case 'fb_commentator_minimap_size':
        if (!this.requireCommentator(clientId, 'resize the minimap')) break;
        if (typeof msg.size === 'number')
          this.setConfig({ minimapSize: msg.size });
        break;
      case 'fb_commentator_director':
        if (!this.requireCommentator(clientId, 'tune the director')) break;
        if (msg.director && typeof msg.director === 'object')
          this.setConfig({ director: msg.director as FbDirectorPatch });
        break;
      case 'fb_commentator_replay':
        if (!this.requireCommentator(clientId, 'toggle the replay')) break;
        if (typeof msg.enabled === 'boolean')
          this.setConfig({ replay: msg.enabled });
        break;
      case 'fb_team_color':
        this.setTeamColor(clientId, msg.team, msg.color);
        break;
      case 'fb_commentator_match': {
        const action = msg.action;
        if (
          typeof action === 'string' &&
          (FB_MATCH_ACTIONS as readonly string[]).includes(action)
        ) {
          this.commentatorControlMatch(clientId, {
            action: action as FbMatchAction,
            role: isCamRole(msg.role) ? msg.role : undefined,
          });
        }
        break;
      }
      case 'fb_event_resolve':
        if (!this.requireCommentator(clientId, 'resolve events')) break;
        if (typeof msg.eventId !== 'string') {
          this.sendError(clientId, 'invalid_event', 'Missing event id.');
          break;
        }
        if (
          !this.resolveEvent({
            eventId: msg.eventId,
            team:
              msg.team === undefined
                ? undefined
                : isTeamId(msg.team)
                  ? msg.team
                  : null,
            kind: isEventKind(msg.kind) ? msg.kind : undefined,
            voided: typeof msg.voided === 'boolean' ? msg.voided : undefined,
          })
        ) {
          this.sendError(clientId, 'unknown_event', 'No such event.', {
            eventId: msg.eventId,
          });
        }
        break;
      case 'fb_event_add':
        if (!this.requireCommentator(clientId, 'add events')) break;
        if (!isTeamId(msg.team) || !isEventKind(msg.kind)) {
          this.sendError(clientId, 'invalid_event', 'Unknown team or kind.');
          break;
        }
        if (!this.addManualEvent(msg.team, msg.kind)) {
          this.sendError(
            clientId,
            'bad_action',
            'Kick off before adding events.',
          );
        }
        break;
      case 'fb_event_undo':
        if (!this.requireCommentator(clientId, 'undo events')) break;
        if (
          !this.undoEvent(
            typeof msg.eventId === 'string' ? msg.eventId : undefined,
          )
        ) {
          this.sendError(clientId, 'unknown_event', 'Nothing to undo.');
        }
        break;
      default:
        break;
    }
  }

  private sendError(
    clientId: string,
    code: FbErrorCode,
    message: string,
    context?: Record<string, string | number>,
  ): void {
    this.deps.sendTo(clientId, {
      type: 'fb_error',
      roomId: this.roomId,
      code,
      message,
      ...(context ? { context } : {}),
    });
  }

  spectate(clientId: string): void {
    this.deps.sendTo(clientId, this.stateSnapshot());
    this.deps.sendTo(clientId, this.getMatchSnapshot());
    this.deps.sendTo(clientId, {
      type: 'fb_ai_log',
      roomId: this.roomId,
      reset: true,
      entries: this.aiLog.snapshot(),
    });
  }

  // ── Cameras (file clips only) ─────────────────────────────────────────────

  /**
   * A local-mp4 input (RoomState.attachFbMp4Cam) takes a camera role. The
   * clip's telemetry sidecars load in the background; AI EVENTS arm once the
   * events sidecar and the clip clock are there.
   */
  attachExternalCam(
    role: FbCamRole,
    inputId: string,
    dims?: { width: number; height: number },
    fileName?: string,
  ): boolean {
    this.engaged = true;
    let cam = this.cams.get(role);
    if (!cam) {
      cam = {
        role,
        inputId: null,
        camConnected: false,
        camWidth: null,
        camHeight: null,
        fileName: null,
        telemetry: emptyTelemetry(),
        telemetryFlags: {
          zxy: false,
          ball: false,
          zones: false,
          events: false,
        },
        telemetryLoading: false,
      };
      this.cams.set(role, cam);
    } else {
      this.retireCamInput(cam);
    }
    cam.fileName = fileName ?? null;
    if (dims) {
      cam.camWidth = dims.width;
      cam.camHeight = dims.height;
    }
    cam.inputId = inputId;
    cam.camConnected = false;
    cam.telemetry = emptyTelemetry();
    cam.telemetryFlags = {
      zxy: false,
      ball: false,
      zones: false,
      events: false,
    };
    if (fileName) void this.loadTelemetry(cam, fileName);
    // The driving clip may have changed: drop the armed plays, the tick re-arms.
    if (this.aiPrepared?.clip !== this.drivingClip()) {
      this.aiFailedFor = null;
      this.aiPrepared = null;
      this.unloadAiRun();
    }
    this.follow = null;
    this.tricam = null;
    this.aiLog.push(
      {
        kind: 'session',
        tone: 'chalk',
        label: 'CAM',
        text: `${role} · ${fileName ?? inputId}`,
      },
      this.now(),
    );
    void this.restage();
    this.ensureRunning();
    this.broadcastState();
    return true;
  }

  private async loadTelemetry(cam: CamState, fileName: string): Promise<void> {
    const load = this.deps.loadClipTelemetry;
    if (!load) return;
    cam.telemetryLoading = true;
    try {
      const files = await load(fileName);
      if (this.disposed || cam.fileName !== fileName) return;
      const t = emptyTelemetry();
      if (files?.meta != null) {
        try {
          t.meta = parseClipMeta(files.meta);
        } catch (err) {
          console.warn(`[fb] ${fileName}: bad alfheim.json`, err);
        }
      }
      if (files?.zones != null) {
        try {
          t.zones = parseZones(files.zones);
        } catch (err) {
          console.warn(`[fb] ${fileName}: bad zones.json`, err);
        }
      }
      if (files?.zxy != null) {
        try {
          t.zxy = parseZxy(files.zxy);
        } catch (err) {
          console.warn(`[fb] ${fileName}: bad zxy.json`, err);
        }
      }
      if (files?.ball != null) {
        try {
          t.ball = parseBall(files.ball);
        } catch (err) {
          console.warn(`[fb] ${fileName}: bad ball.json`, err);
        }
      }
      cam.telemetry = t;
      cam.telemetryFlags = {
        zxy: t.zxy != null,
        ball: t.ball != null,
        zones: t.zones != null,
        events: cam.telemetryFlags.events,
      };
      this.aiLog.push(
        {
          kind: 'session',
          tone: t.ball || t.zxy ? 'good' : 'amber',
          label: 'TELEMETRY',
          text: `${cam.role} · ${[t.ball ? 'ball' : null, t.zxy ? `zxy ${t.zxy.tags.length} tags` : null, t.zones ? 'zones' : null].filter(Boolean).join(' · ') || 'none'}`,
        },
        this.now(),
      );
      this.flushAiLog();
      this.broadcastState();
    } catch (err) {
      console.warn(`[fb] telemetry load failed for ${fileName}`, err);
    } finally {
      cam.telemetryLoading = false;
    }
  }

  private retireCamInput(cam: CamState): void {
    if (cam.inputId == null) return;
    const inputId = cam.inputId;
    cam.inputId = null;
    cam.camConnected = false;
    void this.deps.removeInput(inputId).catch(() => {});
  }

  private releaseCamSlot(cam: CamState): void {
    this.retireCamInput(cam);
    this.dropCamSlot(cam);
  }

  /** Forget a camera slot whose input is gone (kicked, or reaped by the room). */
  private dropCamSlot(cam: CamState): void {
    this.cams.delete(cam.role);
    // Only the manual view that needed this camera goes back to AUTO.
    if (
      this.viewOverride.mode === 'view' &&
      (cam.role === 'pano' || this.viewOverride.view === cam.role)
    )
      this.clearViewOverride();
    this.follow = null;
    this.tricam = null;
  }

  /** Inputs of the file-backed cams (for the clip sync/restart action). */
  fileCamInputIds(): { role: FbCamRole; inputId: string }[] {
    const out: { role: FbCamRole; inputId: string }[] = [];
    for (const cam of this.cams.values()) {
      if (cam.inputId != null)
        out.push({ role: cam.role, inputId: cam.inputId });
    }
    return out;
  }

  session(): FbSession | null {
    if (this.cams.get('pano')?.inputId) return 'pano';
    for (const role of ['centre', 'left', 'right'] as const) {
      if (this.cams.get(role)?.inputId) return 'tricam';
    }
    return null;
  }

  /** The cam whose clip drives the clock / telemetry / events. */
  private drivingCam(): CamState | null {
    for (const role of ['pano', 'centre', 'left', 'right'] as const) {
      const cam = this.cams.get(role);
      if (cam?.inputId) return cam;
    }
    return null;
  }

  private drivingClip(): string | null {
    return this.drivingCam()?.fileName ?? null;
  }

  private telemetry(): FbTelemetry | null {
    return this.drivingCam()?.telemetry ?? null;
  }

  fileClock(): { role: FbCamRole; inputId: string; clock: FbFileClock } | null {
    const get = this.deps.getFileClock;
    if (!get) return null;
    for (const role of ['pano', 'centre', 'left', 'right'] as const) {
      const cam = this.cams.get(role);
      if (!cam || cam.inputId == null) continue;
      const clock = get(cam.inputId);
      if (clock) return { role, inputId: cam.inputId, clock };
    }
    return null;
  }

  private static mediaAt(clock: FbFileClock, now: number): number {
    const t = clock.playFromMs + (now - clock.anchorWallMs);
    return clock.durationMs && clock.durationMs > 0 && t >= 0
      ? t % clock.durationMs
      : t;
  }

  /** Media time of the frame ON AIR at wall time `now`. */
  private airMediaMs(now: number): number | null {
    const fc = this.fileClock();
    if (!fc) return null;
    return FootballGameController.mediaAt(fc.clock, now) - fc.clock.delayMs;
  }

  /** HUD data hold: the clip's side-channel delay (0 without a model). */
  private hudHoldMs(): number {
    return this.fileClock()?.clock.delayMs ?? 0;
  }

  private clipSnapshot(cam: CamState, now: number): FbClipClock | undefined {
    if (cam.inputId == null) return undefined;
    const clock = this.deps.getFileClock?.(cam.inputId);
    if (!clock) return undefined;
    return {
      playFromMs: clock.playFromMs,
      mediaMs: Math.round(FootballGameController.mediaAt(clock, now)),
      durationMs: clock.durationMs,
      delayMs: clock.delayMs,
    };
  }

  private pano(): Pano {
    const t = this.telemetry();
    if (t?.zones) return t.zones.pano;
    if (t?.meta?.panoWidth && t.meta.panoHeight)
      return { w: t.meta.panoWidth, h: t.meta.panoHeight };
    const cam = this.cams.get('pano');
    if (cam?.camWidth && cam.camHeight)
      return { w: cam.camWidth, h: cam.camHeight };
    return DEFAULT_PANO;
  }

  private outputAspect(): number {
    const r = this.deps.getResolution();
    return r.width / Math.max(1, r.height);
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
      c.disconnectedAt = null;
    } else if (c && c.connected) {
      // The seat is held by a live socket: a stranger cannot take it over
      // (the host frees it with `kick_commentator`, the holder with LEAVE).
      this.sendError(
        clientId,
        'role_taken',
        `${c.name} is moderating this match.`,
      );
      return;
    } else {
      this.commentator = {
        clientId,
        commentatorKey: key ?? randomUUID(),
        name,
        connected: true,
        disconnectedAt: null,
      };
    }
    const cur = this.commentator!;
    this.deps.sendTo(clientId, {
      type: 'fb_commentator_joined',
      roomId: this.roomId,
      clientId,
      commentatorKey: cur.commentatorKey,
      name: cur.name,
      phase: this.phase,
    });
    this.ensureRunning();
    this.broadcastState();
  }

  leaveCommentator(clientId: string): void {
    const c = this.commentator;
    if (!c || c.clientId !== clientId) return;
    this.commentator = null;
    this.broadcastState();
    this.maybeStop();
  }

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
    const error = this.applyViewOverride(raw);
    if (error) this.sendError(clientId, 'invalid_view', error);
  }

  /**
   * Host fallback (REST): the laptop can steer the director when the
   * moderator's phone is gone. Returns the refusal, null when applied.
   */
  hostSetViewOverride(raw: unknown): string | null {
    this.engaged = true;
    return this.applyViewOverride(raw);
  }

  private applyViewOverride(raw: unknown): string | null {
    const override = this.parseViewOverride(raw);
    if (!override) return 'Unknown view override.';
    if (override.mode === 'view') {
      const session = this.session();
      const allowed =
        session === 'pano'
          ? FB_PANO_VIEWS
          : session === 'tricam'
            ? FB_TRICAM_VIEWS
            : [];
      if (!allowed.includes(override.view))
        return 'That view needs its camera attached.';
      if (
        session === 'tricam' &&
        override.view !== 'auto' &&
        !this.cams.get(override.view as FbCamRole)?.inputId
      ) {
        return 'That camera is not attached.';
      }
    }
    this.viewOverride =
      override.mode === 'view' && override.view === 'auto'
        ? { mode: 'auto' }
        : override;
    this.aiLog.push(
      {
        kind: 'director',
        tone: 'chalk',
        label: 'VIEW',
        text:
          this.viewOverride.mode === 'auto' ? 'auto' : this.viewOverride.view,
      },
      this.now(),
    );
    this.flushAiLog();
    this.directorTick(this.now(), true);
    this.deps.broadcast(this.stateSnapshot());
    return null;
  }

  private parseViewOverride(raw: unknown): FbViewOverride | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as { mode?: unknown; view?: unknown };
    if (o.mode === 'auto') return { mode: 'auto' };
    if (o.mode === 'view' && typeof o.view === 'string') {
      const all: readonly string[] = [...FB_PANO_VIEWS, ...FB_TRICAM_VIEWS];
      if (all.includes(o.view)) return { mode: 'view', view: o.view as FbView };
    }
    return null;
  }

  private clearViewOverride(): void {
    if (this.viewOverride.mode === 'auto') return;
    this.viewOverride = { mode: 'auto' };
    this.deps.broadcast(this.stateSnapshot());
  }

  setMinimap(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'toggle the minimap')) return;
    if (typeof raw !== 'boolean') {
      this.sendError(clientId, 'invalid_view', 'Invalid minimap toggle.');
      return;
    }
    this.setMinimapOn(raw);
  }

  /** Minimap on air (the moderator's toggle; the host's REST fallback). */
  setMinimapOn(raw: boolean): void {
    if (this.minimapOn === raw) return;
    this.minimapOn = raw;
    this.aiLog.push(
      {
        kind: 'ai',
        tone: 'chalk',
        label: 'MINIMAP',
        text: raw ? 'on air' : 'off',
      },
      this.now(),
    );
    this.flushAiLog();
    this.broadcastState();
  }

  setTeamColor(clientId: string, rawTeam: unknown, rawColor: unknown): void {
    if (!this.requireCommentator(clientId, 'set a team colour')) return;
    if (
      !isTeamId(rawTeam) ||
      typeof rawColor !== 'string' ||
      !HEX_COLOR.test(rawColor)
    ) {
      this.sendError(clientId, 'invalid_color', 'Invalid team colour.');
      return;
    }
    this.setConfig({ teams: { [rawTeam]: { color: rawColor } } });
  }

  commentatorControlMatch(clientId: string, cmd: FbMatchCommand): void {
    if (!this.requireCommentator(clientId, 'control the match')) return;
    const { error } = this.controlMatch(cmd);
    if (error)
      this.sendError(clientId, error.code, error.message, error.context);
  }

  // ── AI EVENTS (annotated plays) ───────────────────────────────────────────

  setAiEvents(clientId: string, raw: unknown): void {
    if (!this.requireCommentator(clientId, 'toggle AI events')) return;
    if (typeof raw !== 'boolean') {
      this.sendError(clientId, 'invalid_view', 'Invalid AI events toggle.');
      return;
    }
    this.setAiEventsEnabled(raw);
  }

  setAiEventsEnabled(enabled: boolean): void {
    if (this.aiEventsOn === enabled) return;
    this.aiEventsOn = enabled;
    this.config.ai.events = enabled;
    if (!enabled) {
      this.unloadAiRun();
      this.aiLog.push(
        { kind: 'ai', tone: 'dim', label: 'AI EVENTS', text: 'off' },
        this.now(),
      );
    } else {
      this.aiFailedFor = null;
      void this.armAiEvents();
    }
    this.flushAiLog();
    this.broadcastState();
  }

  aiEventsStatus(): FbAiEventsStatus {
    if (!this.aiEventsOn) return 'off';
    if (this.aiRun) return 'armed';
    const clip = this.drivingClip();
    if (!clip) return 'no_clip';
    if (this.aiFailedFor === clip) return 'no_events';
    return 'loading';
  }

  /** Load the driving clip's plays (once per clip) and arm them on the file clock. */
  private async armAiEvents(): Promise<void> {
    if (!this.aiEventsOn || this.aiLoading || this.disposed || this.aiRun)
      return;
    const clip = this.drivingClip();
    if (!clip) return;
    if (this.aiFailedFor === clip) return;
    if (this.aiPrepared?.clip !== clip) {
      this.aiPrepared = null;
      this.aiLoading = true;
      this.broadcastState();
      let failure: string | null = null;
      try {
        const found = await this.deps.loadClipEvents?.(clip);
        if (!found) failure = `no annotated plays next to ${clip}`;
        else {
          const gt = parseFbGroundTruth(found.json);
          this.aiPrepared = {
            clip,
            fileName: found.fileName,
            events: gt.events,
            kickoffMs: gt.kickoffMs,
            attacks: gt.attacks,
          };
          this.clipKickoffMs = gt.kickoffMs;
          this.clipAttacksLeft = gt.attacks
            ? gt.attacks.A === 'left'
              ? 'A'
              : 'B'
            : null;
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      } finally {
        this.aiLoading = false;
      }
      if (this.disposed) return;
      if (failure || !this.aiPrepared) {
        this.aiFailedFor = clip;
        for (const cam of this.cams.values())
          if (cam.fileName === clip) cam.telemetryFlags.events = false;
        this.aiLog.push(
          {
            kind: 'ai',
            tone: 'amber',
            label: 'AI EVENTS',
            text: `${failure ?? 'no plays'} · manual ledger only`,
          },
          this.now(),
        );
        this.flushAiLog();
        this.broadcastState();
        return;
      }
      for (const cam of this.cams.values())
        if (cam.fileName === clip) cam.telemetryFlags.events = true;
    }
    if (!this.aiEventsOn || this.aiRun) return;
    if (!this.fileClock()) {
      this.broadcastState();
      return;
    }
    const p = this.aiPrepared;
    if (!p) return;
    const selected = selectAiEvents(
      { events: p.events },
      this.config.ai.kinds,
      this.config.attacksLeft,
    );
    this.aiRun = {
      fileName: p.fileName,
      events: selected,
      cursor: 0,
      loopIndex: 0,
      fired: 0,
      skipped: 0,
      clockSig: null,
      nextFireAt: null,
    };
    this.engaged = true;
    this.scheduleAi();
    this.ensureRunning();
    const counts: Record<string, number> = {};
    for (const e of selected) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    this.aiLog.push(
      {
        kind: 'ai',
        tone: 'good',
        label: 'AI EVENTS',
        text: `armed · ${selected.length} plays · ${Object.entries(counts)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ')}`,
      },
      this.now(),
    );
    this.flushAiLog();
    this.broadcastState();
  }

  private unloadAiRun(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    this.aiRun = null;
  }

  private aiRunSnapshot(): FbAiRunState | null {
    const r = this.aiRun;
    if (!r) return null;
    const now = this.now();
    const next = r.cursor < r.events.length ? r.events[r.cursor] : null;
    return {
      fileName: r.fileName,
      total: r.events.length,
      fired: r.fired,
      skipped: r.skipped,
      nextEventTMs: next?.tMs ?? null,
      nextFireInMs:
        r.nextFireAt != null ? Math.max(0, r.nextFireAt - now) : null,
      clockRole: this.fileClock()?.role ?? null,
    };
  }

  private static clockSig(fc: { inputId: string; clock: FbFileClock }): string {
    return `${fc.inputId}:${fc.clock.anchorWallMs}:${fc.clock.playFromMs}`;
  }

  /**
   * Wall time a play fires: the frame at `tMs` reaches the AI at
   * anchor + (tMs − playFrom) and airs `delayMs` later; the HUD hold is that
   * same delay, so firing at the AI time lands the banner on the frame.
   */
  private aiFireAt(
    e: FbGtEvent,
    loopIndex: number,
    clock: FbFileClock,
  ): number {
    const loopMs =
      clock.durationMs && clock.durationMs > 0
        ? loopIndex * clock.durationMs
        : 0;
    return (
      clock.anchorWallMs +
      (e.tMs + loopMs - clock.playFromMs) +
      clock.delayMs -
      this.hudHoldMs()
    );
  }

  private scheduleAi(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
    const r = this.aiRun;
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
    const sig = FootballGameController.clockSig(fc);
    if (r.clockSig !== sig) {
      r.clockSig = sig;
      const elapsed = now - fc.clock.anchorWallMs + fc.clock.playFromMs;
      r.loopIndex = dur ? Math.max(0, Math.floor(elapsed / dur)) : 0;
      r.cursor = 0;
    }
    for (;;) {
      if (r.cursor >= r.events.length) {
        if (dur && r.events.length > 0) {
          r.loopIndex++;
          r.cursor = 0;
          continue;
        }
        r.nextFireAt = null;
        return;
      }
      const fireAt = this.aiFireAt(r.events[r.cursor], r.loopIndex, fc.clock);
      if (fireAt < now - AI_LATE_MAX_MS) {
        r.cursor++;
        continue;
      }
      r.nextFireAt = fireAt;
      this.aiTimer = setTimeout(() => this.fireAi(), Math.max(0, fireAt - now));
      return;
    }
  }

  private fireAi(): void {
    this.aiTimer = null;
    const r = this.aiRun;
    if (!r || this.disposed) return;
    const fc = this.fileClock();
    const e = r.events[r.cursor];
    if (!fc || !e || FootballGameController.clockSig(fc) !== r.clockSig) {
      this.scheduleAi();
      return;
    }
    const now = this.now();
    const fireAt = this.aiFireAt(e, r.loopIndex, fc.clock);
    if (Math.abs(fireAt - now) > AI_LATE_MAX_MS) {
      this.scheduleAi();
      return;
    }
    r.cursor++;
    if (!this.matchAcceptsEvents()) {
      r.skipped++;
      this.scheduleAi();
      return;
    }
    r.fired++;
    this.scheduleAi();
    this.fireAiEvent(e, now);
  }

  /** An annotated play lands like a model call. */
  private fireAiEvent(e: FbGtEvent, now: number): void {
    const conf = aiConfidence(e.kind, e.tMs);
    const detailParts: string[] = [];
    if (e.kind === 'shot')
      detailParts.push(
        e.onTarget ? 'on target' : 'off target',
        e.speedMs != null ? `${e.speedMs} m/s` : '',
      );
    if (e.kind === 'sprint')
      detailParts.push(
        `#${e.tag ?? '?'}`,
        e.topKmh != null ? `${e.topKmh} km/h` : '',
        e.meters != null ? `${e.meters} m` : '',
      );
    if (
      e.kind === 'corner' ||
      e.kind === 'chance' ||
      e.kind === 'goal' ||
      e.kind === 'attack'
    )
      detailParts.push(e.side ? `${e.side} goal` : '');
    const detail = detailParts.filter(Boolean).join(' · ');
    const ingested = this.ingestEvent({
      source: 'ai',
      kind: e.kind,
      team: e.team,
      side: e.side,
      aiConfidence: conf,
      candidate: e.kind === 'goal',
      detail: detail || undefined,
      tag: e.tag,
      topKmh: e.topKmh,
      speedMs: e.speedMs,
      onTarget: e.onTarget,
      mediaMs: e.tMs,
    });
    const { label, tone } = eventLabel(e.kind);
    this.aiLog.push(
      {
        kind: ingested?.status === 'pending' ? 'refcall' : 'event',
        tone: ingested?.status === 'pending' ? 'amber' : tone,
        label,
        text: `${e.team ? `${this.config.teams[e.team].short} · ` : ''}${Math.round(conf * 100)} %${detail ? ` · ${detail}` : ''}${ingested?.status === 'pending' ? ' · REF CALL' : ''}`,
        t: e.tMs / 1000,
      },
      now,
    );
    this.flushAiLog();
  }

  private checkAiClock(now: number): void {
    const r = this.aiRun;
    if (!r) return;
    const fc = this.fileClock();
    const sig = fc ? FootballGameController.clockSig(fc) : null;
    if (sig !== r.clockSig) this.scheduleAi();
    if (now - this.lastAiRunBroadcastAt >= AI_RUN_BROADCAST_MS) {
      this.lastAiRunBroadcastAt = now;
      this.deps.broadcast(this.stateSnapshot());
    }
  }

  /** Looping file cams: joint restart just before the first clip wraps. */
  private checkFileCamLoop(now: number): void {
    const resync = this.deps.resyncFileCams;
    const get = this.deps.getFileClock;
    if (!resync || !get) return;
    const clocks: { inputId: string; clock: FbFileClock }[] = [];
    for (const cam of this.cams.values()) {
      if (cam.inputId == null) continue;
      const clock = get(cam.inputId);
      if (clock && clock.durationMs && clock.durationMs > 0)
        clocks.push({ inputId: cam.inputId, clock });
    }
    if (clocks.length === 0) return;
    const sig = clocks.map((c) => FootballGameController.clockSig(c)).join('|');
    if (sig === this.lastLoopResyncSig) return;
    const wrapping = clocks.some(
      ({ clock }) =>
        clock.playFromMs + (now - clock.anchorWallMs) >=
        (clock.durationMs as number) - LOOP_RESYNC_LEAD_MS,
    );
    if (!wrapping) return;
    this.lastLoopResyncSig = sig;
    resync().catch((err) =>
      console.warn(
        `[fb] loop resync failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  // ── Disconnects / reaped inputs ───────────────────────────────────────────

  handleDisconnect(clientId: string): void {
    if (this.commentator?.clientId === clientId) {
      this.commentator.connected = false;
      this.commentator.disconnectedAt = this.now();
      this.broadcastState();
    }
  }

  /** A moderator who never came back frees the seat (and the lobby card). */
  private reapCommentator(now: number): void {
    const c = this.commentator;
    if (!c || c.connected || c.disconnectedAt == null) return;
    if (now - c.disconnectedAt < COMMENTATOR_GONE_MS) return;
    this.commentator = null;
    this.broadcastState();
  }

  onInputsRemoved(inputIds: string[]): void {
    if (this.disposed) return;
    const gone = new Set(inputIds);
    let changed = false;
    for (const cam of [...this.cams.values()]) {
      if (cam.inputId != null && gone.has(cam.inputId)) {
        // A reaped input never comes back (a clip restart keeps its id): free
        // the slot, or the panel row would read "CONNECTING · <file>" for ever.
        cam.inputId = null;
        cam.camConnected = false;
        this.dropCamSlot(cam);
        changed = true;
      }
    }
    if (!changed) return;
    void this.restage();
    this.broadcastState();
  }

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
        Record<
          FbTeamId,
          Partial<{ name: string; short: string; color: string }>
        >
      >;
      halfMs?: number;
      clockFromClip?: boolean;
      attacksLeft?: FbTeamId | null;
      autoFlow?: boolean;
      director?: FbDirectorPatch;
      ai?: Partial<FbConfig['ai']>;
      replay?: boolean;
      replayDelayMs?: number;
      minimap?: boolean;
      minimapSize?: number;
      perf?: Partial<FbConfig['perf']>;
      joinUrls?: Partial<Record<'commentator', string>>;
      joinLabel?: string;
    } = {},
  ): FbConfig {
    this.engaged = true;
    const c = this.config;
    let aiSelectionChanged = false;
    if (partial.teams) {
      for (const team of FB_TEAM_IDS) {
        const t = partial.teams[team];
        if (!t) continue;
        if (typeof t.name === 'string')
          c.teams[team].name = t.name.slice(0, 16).trim() || c.teams[team].name;
        if (typeof t.short === 'string')
          c.teams[team].short =
            t.short.slice(0, 4).trim().toUpperCase() || c.teams[team].short;
        if (typeof t.color === 'string' && HEX_COLOR.test(t.color))
          c.teams[team].color = t.color.toLowerCase();
      }
    }
    if (typeof partial.halfMs === 'number' && Number.isFinite(partial.halfMs)) {
      c.halfMs = clamp(Math.round(partial.halfMs), HALF_MIN_MS, HALF_MAX_MS);
    }
    if (typeof partial.clockFromClip === 'boolean')
      c.clockFromClip = partial.clockFromClip;
    if (partial.attacksLeft === null || isTeamId(partial.attacksLeft)) {
      if (partial.attacksLeft !== c.attacksLeft) aiSelectionChanged = true;
      c.attacksLeft = partial.attacksLeft;
    }
    if (partial.director) {
      const d = partial.director;
      if (d.zoom === 'tight' || d.zoom === 'normal' || d.zoom === 'wide')
        c.director.zoom = d.zoom;
      if (d.smoothing === 'snappy' || d.smoothing === 'smooth')
        c.director.smoothTimeMs = FB_SMOOTHING_PRESET_MS[d.smoothing];
      if (d.switchStyle === 'glide' || d.switchStyle === 'cut')
        c.director.switchStyle = d.switchStyle;
      if (typeof d.lookaheadMs === 'number' && Number.isFinite(d.lookaheadMs)) {
        c.director.lookaheadMs = clamp(Math.round(d.lookaheadMs), 0, 2000);
      }
      for (const key of [
        'averageMs',
        'smoothTimeMs',
        'deadZonePx',
        'maxSpeedPxS',
      ] as const) {
        const v = d[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const lim = FB_DIRECTOR_LIMITS[key];
        c.director[key] = clamp(Math.round(v), lim.min, lim.max);
      }
      if (typeof d.catchUp === 'boolean') c.director.catchUp = d.catchUp;
    }
    if (partial.ai) {
      const a = partial.ai;
      if (typeof a.events === 'boolean' && a.events !== this.aiEventsOn) {
        this.setAiEventsEnabled(a.events);
      }
      if (Array.isArray(a.kinds)) {
        const kinds = a.kinds.filter(isEventKind);
        if (kinds.join() !== c.ai.kinds.join()) aiSelectionChanged = true;
        c.ai.kinds = kinds;
      }
      if (Array.isArray(a.replayOn))
        c.ai.replayOn = a.replayOn.filter(isEventKind);
    }
    if (typeof partial.replay === 'boolean') c.replay = partial.replay;
    if (typeof partial.autoFlow === 'boolean') c.autoFlow = partial.autoFlow;
    if (
      typeof partial.replayDelayMs === 'number' &&
      Number.isFinite(partial.replayDelayMs)
    ) {
      c.replayDelayMs = clamp(Math.round(partial.replayDelayMs), 0, 5_000);
    }
    if (typeof partial.minimap === 'boolean') {
      c.minimap = partial.minimap;
      this.minimapOn = partial.minimap;
    }
    if (
      typeof partial.minimapSize === 'number' &&
      Number.isFinite(partial.minimapSize)
    ) {
      c.minimapSize = clamp(
        Math.round(partial.minimapSize),
        FB_MINIMAP_SIZES[0],
        FB_MINIMAP_SIZES[FB_MINIMAP_SIZES.length - 1],
      ) as FbMinimapSize;
    }
    if (partial.perf) {
      const p = partial.perf;
      if (p.animTickHz === 60 || p.animTickHz === 30 || p.animTickHz === 15)
        c.perf.animTickHz = p.animTickHz;
      if (p.hudPublishHz === 10 || p.hudPublishHz === 5 || p.hudPublishHz === 2)
        c.perf.hudPublishHz = p.hudPublishHz;
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
      )
        c.perf.recordingScale = p.recordingScale;
      this.hudMinIntervalMs = Math.round(1000 / c.perf.hudPublishHz);
      this.deps.setAnimTickMs(Math.round(1000 / c.perf.animTickHz));
    }
    if (typeof partial.joinLabel === 'string')
      this.joinLabel = partial.joinLabel.slice(0, 64) || null;
    const url = partial.joinUrls?.commentator;
    if (typeof url === 'string' && url && url !== this.joinUrl) {
      this.joinUrl = url;
      this.qrImageId = null;
      void this.deps
        .registerJoinQr(url)
        .then((imageId) => {
          if (this.disposed || this.joinUrl !== url) return;
          this.qrImageId = imageId;
          this.publishHud();
        })
        .catch((err) => console.error('[fb] join QR registration failed', err));
    }
    if (aiSelectionChanged && this.aiRun) {
      // Re-select the plays with the new kinds / side mapping.
      this.unloadAiRun();
      void this.armAiEvents();
    }
    this.broadcastState();
    return structuredClone(this.config);
  }

  // ── Match flow ────────────────────────────────────────────────────────────

  controlMatch(cmd: FbMatchCommand): {
    state: FbStateEvent;
    match: FbMatchEvent;
    error?: FbMatchError;
  } {
    this.engaged = true;
    const error = this.applyMatchAction(cmd);
    if (!error) {
      // A new segment starts on the director's pick; a pause, a resume or a
      // kick must not yank the moderator's manual view back to AUTO. A kicked
      // camera only drops the override that was pointing at it.
      const keepsView =
        cmd.action === 'pause' ||
        cmd.action === 'resume' ||
        cmd.action === 'kick_commentator' ||
        (cmd.action === 'kick_cam' &&
          !(
            this.viewOverride.mode === 'view' &&
            this.viewOverride.view === cmd.role
          ));
      if (!keepsView && this.viewOverride.mode !== 'auto')
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

  private applyMatchAction(cmd: FbMatchCommand): FbMatchError | null {
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
        if (this.phase !== 'lobby')
          return { code: 'bad_action', message: 'The match already started.' };
        this.resetMatch();
        this.phase = 'live';
        this.period = 1;
        this.matchStartedAt = now;
        this.segmentStartedAt = now;
        {
          // The clip's annotated kick-off sets the clock offset (the footage
          // may open mid-half); from here the wall clock runs, so a looping
          // demo clip never resets the match clock.
          const air = this.airMediaMs(now);
          const kick = this.clipKickoffMs;
          this.clockFromClipUsed =
            this.config.clockFromClip && air != null && kick != null;
          this.elapsedBeforeSegmentMs = this.clockFromClipUsed
            ? Math.max(0, (air as number) - (kick as number))
            : 0;
        }
        this.setBanner('kick_off', 'KICK-OFF', '#f4f1e8', now);
        this.aiLog.push(
          {
            kind: 'clock',
            tone: 'good',
            label: 'KICK-OFF',
            text: this.clockFromClipActive()
              ? `clock from the clip · ${fmtClock(this.periodElapsed(now))}`
              : 'clock started',
          },
          now,
        );
        this.ensureRunning();
        return null;
      case 'pause':
        if (this.phase !== 'live')
          return { code: 'bad_action', message: 'Nothing to pause.' };
        this.freezeClock(now);
        this.phase = 'paused';
        return null;
      case 'resume':
        if (this.phase !== 'paused')
          return { code: 'bad_action', message: 'The match is not paused.' };
        this.phase = 'live';
        this.segmentStartedAt = now;
        return null;
      case 'half_time':
        if (this.phase !== 'live' && this.phase !== 'paused')
          return { code: 'bad_action', message: 'No running half.' };
        if (this.period !== 1)
          return {
            code: 'bad_action',
            message: 'Already in the second half — use FULL TIME.',
          };
        this.freezeClock(now);
        this.phase = 'halftime';
        this.setBanner('half_time', 'HALF TIME', '#f4f1e8', now);
        this.aiLog.push(
          {
            kind: 'clock',
            tone: 'chalk',
            label: 'HALF TIME',
            text: `${this.config.teams.A.short} ${this.tally.A.score} – ${this.tally.B.score} ${this.config.teams.B.short}`,
          },
          now,
        );
        return null;
      case 'second_half':
        if (this.phase !== 'halftime')
          return { code: 'bad_action', message: 'Call half time first.' };
        this.phase = 'live';
        this.period = 2;
        this.elapsedBeforeSegmentMs = 0;
        this.segmentStartedAt = now;
        this.setBanner('kick_off', 'SECOND HALF', '#f4f1e8', now);
        return null;
      case 'end':
        if (
          this.phase !== 'live' &&
          this.phase !== 'paused' &&
          this.phase !== 'halftime'
        ) {
          return { code: 'bad_action', message: 'No running match to end.' };
        }
        this.endMatch(now);
        return null;
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
        if (!this.commentator)
          return { code: 'bad_action', message: 'No moderator joined.' };
        this.commentator = null;
        return null;
      default:
        return { code: 'bad_action', message: 'Unknown action.' };
    }
  }

  private resetMatch(): void {
    this.phase = 'lobby';
    this.period = 1;
    this.matchStartedAt = null;
    this.segmentStartedAt = null;
    this.elapsedBeforeSegmentMs = 0;
    this.clockFromClipUsed = false;
    this.endedAt = null;
    this.winner = null;
    this.events = [];
    this.baseTally = { A: emptyTally(), B: emptyTally() };
    this.baseLeader = null;
    this.eventSeq = 0;
    this.lastEvent = null;
    this.banner = null;
    this.closeInstantReplay();
    this.recompute();
  }

  private freezeClock(now: number): void {
    if (this.segmentStartedAt == null) return;
    this.elapsedBeforeSegmentMs += Math.max(0, now - this.segmentStartedAt);
    this.segmentStartedAt = null;
  }

  private clockFromClipActive(): boolean {
    return this.clockFromClipUsed;
  }

  /** Ms elapsed in the current half (counts past halfMs as added time). */
  private periodElapsed(now: number): number {
    if (this.matchStartedAt == null) return 0;
    const running =
      this.phase === 'live' && this.segmentStartedAt != null
        ? now - this.segmentStartedAt
        : 0;
    return this.elapsedBeforeSegmentMs + Math.max(0, running);
  }

  /** `autoFlow`: the clock blows the whistle when a half runs out. */
  private checkAutoFlow(now: number): void {
    if (!this.config.autoFlow || this.phase !== 'live') return;
    if (this.periodElapsed(now) < this.config.halfMs) return;
    this.controlMatch({ action: this.period === 1 ? 'half_time' : 'end' });
  }

  private endMatch(now: number): void {
    this.freezeClock(now);
    this.phase = 'ended';
    this.endedAt = now;
    this.winner = this.leaderByScore();
    const color = this.winner
      ? this.config.teams[this.winner].color
      : '#f4f1e8';
    this.setBanner(
      'final',
      this.winner
        ? `${this.config.teams[this.winner].name} WIN`
        : 'FULL TIME — DRAW',
      color,
      now,
    );
    this.aiLog.push(
      {
        kind: 'clock',
        tone: 'chalk',
        label: 'FULL TIME',
        text: `${this.config.teams.A.short} ${this.tally.A.score} – ${this.tally.B.score} ${this.config.teams.B.short}`,
      },
      now,
    );
    this.deps.broadcast(this.getMatchSnapshot());
    this.publishHud();
  }

  private leaderByScore(): FbTeamId | null {
    const a = this.tally.A.score;
    const b = this.tally.B.score;
    return a === b ? null : a > b ? 'A' : 'B';
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  private matchAcceptsEvents(): boolean {
    return this.phase === 'live' || this.phase === 'paused';
  }

  private scores(): Record<FbTeamId, number> {
    return { A: this.tally.A.score, B: this.tally.B.score };
  }

  private static tallyEvent(
    tally: Record<FbTeamId, TeamTally>,
    e: FbEventEntry,
  ): void {
    if (e.status !== 'confirmed' || !e.team) return;
    const t = tally[e.team];
    switch (e.kind) {
      case 'goal':
        t.score += 1;
        break;
      case 'chance':
        t.chances += 1;
        break;
      case 'shot':
        t.shots += 1;
        if (e.onTarget) t.shotsOnTarget += 1;
        break;
      case 'corner':
        t.corners += 1;
        break;
      case 'sprint':
        t.sprints += 1;
        break;
      default:
        break;
    }
  }

  private static topOf(tally: Record<FbTeamId, TeamTally>): FbTeamId | null {
    return tally.A.score === tally.B.score
      ? null
      : tally.A.score > tally.B.score
        ? 'A'
        : 'B';
  }

  /**
   * `leader` is the LAST team to have been in front: it survives an equaliser,
   * so "TAKE THE LEAD" airs only when the lead changes hands (not on the
   * opening goal, not when the same team goes back in front).
   */
  private recompute(): void {
    this.tally = {
      A: { ...this.baseTally.A },
      B: { ...this.baseTally.B },
    };
    let leader: FbTeamId | null = this.baseLeader;
    for (const e of this.events) {
      if (e.status !== 'confirmed' || !e.team) continue;
      FootballGameController.tallyEvent(this.tally, e);
      const top = FootballGameController.topOf(this.tally);
      if (top) leader = top;
    }
    this.leader = leader;
  }

  /** Keep the ledger and the REF CALL queue bounded (see MAX_LEDGER). */
  private boundLedger(): void {
    const pending = this.events.filter((e) => e.status === 'pending');
    for (const e of pending.slice(0, Math.max(0, pending.length - MAX_PENDING)))
      e.status = 'voided';
    if (this.events.length <= MAX_LEDGER) return;
    const gone = this.events.splice(0, LEDGER_TRIM_BATCH);
    for (const e of gone) {
      if (e.status !== 'confirmed' || !e.team) continue;
      FootballGameController.tallyEvent(this.baseTally, e);
      const top = FootballGameController.topOf(this.baseTally);
      if (top) this.baseLeader = top;
    }
  }

  private afterLedgerChange(now: number): void {
    const before = this.leader;
    this.recompute();
    if (this.leader && this.leader !== before && before != null) {
      this.setBanner(
        'lead_change',
        `${this.config.teams[this.leader].name} TAKE THE LEAD`,
        this.config.teams[this.leader].color,
        now,
      );
    }
    // Scores ride on fb_match too: keep the panel's clock row in step.
    this.deps.broadcast(this.getMatchSnapshot());
  }

  private setBanner(
    kind: NonNullable<FbHudState['banner']>['kind'],
    text: string,
    color: string,
    at: number,
  ): void {
    this.banner = { kind, text, color, at };
  }

  private ingestEvent(input: EventInput): FbEventEntry | null {
    const now = this.now();
    if (!this.matchAcceptsEvents()) return null;
    const team = input.team;
    const confirmed =
      input.source === 'manual' ||
      (!input.candidate &&
        team != null &&
        input.aiConfidence >= AUTO_CONFIRM_MIN_CONF);
    const entry = this.buildEvent(
      input,
      now,
      confirmed ? 'confirmed' : 'pending',
    );
    this.events.push(entry);
    this.boundLedger();
    this.afterLedgerChange(now);
    this.lastEvent = { event: entry, at: now };
    if (this.config.ai.replayOn.includes(entry.kind))
      this.scheduleInstantReplay(entry, now);
    this.deps.broadcast({
      type: 'fb_event',
      roomId: this.roomId,
      kind: input.source === 'manual' ? 'manual' : 'fired',
      event: { ...entry },
      scores: this.scores(),
    });
    this.publishHud();
    this.broadcastState();
    this.ensureRunning();
    return entry;
  }

  private buildEvent(
    input: EventInput,
    now: number,
    status: FbEventEntry['status'],
  ): FbEventEntry {
    let mediaMs = input.mediaMs;
    if (mediaMs == null) {
      const air = this.airMediaMs(now);
      if (air != null) mediaMs = Math.round(air);
    }
    return {
      id: randomUUID(),
      index: ++this.eventSeq,
      atMs: now,
      ...(mediaMs != null ? { mediaMs } : {}),
      kind: input.kind,
      team: input.team,
      ...(input.side ? { side: input.side } : {}),
      status,
      source: input.source,
      aiConfidence: clamp(input.aiConfidence, 0, 1),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.tag != null ? { tag: input.tag } : {}),
      ...(input.topKmh != null ? { topKmh: input.topKmh } : {}),
      ...(input.speedMs != null ? { speedMs: input.speedMs } : {}),
      ...(input.onTarget != null ? { onTarget: input.onTarget } : {}),
      period: this.period,
      clockMs: this.periodElapsed(now),
    };
  }

  /** Moderator edit: confirm a goal candidate (assign a team) / change kind / void. */
  resolveEvent(cmd: {
    eventId: string;
    team?: FbTeamId | null;
    kind?: FbEventKind;
    voided?: boolean;
  }): FbEventEntry | null {
    const e = this.events.find((x) => x.id === cmd.eventId);
    if (!e) return null;
    const now = this.now();
    let kind: 'assigned' | 'voided' = 'assigned';
    if (cmd.voided === true) {
      e.status = 'voided';
      kind = 'voided';
    } else {
      if (cmd.team !== undefined) e.team = cmd.team;
      if (cmd.kind) e.kind = cmd.kind;
      e.status = e.team ? 'confirmed' : 'pending';
    }
    this.afterLedgerChange(now);
    if (
      e.kind === 'goal' &&
      e.status === 'confirmed' &&
      this.lastEvent?.event.id !== e.id
    ) {
      // A confirmed goal is the headline: banner it now.
      this.lastEvent = { event: e, at: now };
    }
    this.deps.broadcast({
      type: 'fb_event',
      roomId: this.roomId,
      kind,
      event: { ...e },
      scores: this.scores(),
    });
    this.aiLog.push(
      {
        kind: 'refcall',
        tone: kind === 'voided' ? 'dim' : 'good',
        label: 'REF',
        text:
          kind === 'voided'
            ? `${eventTitle(e.kind)} voided`
            : `${eventTitle(e.kind)} → ${e.team ? this.config.teams[e.team].short : 'nobody'}`,
      },
      now,
    );
    this.flushAiLog();
    this.publishHud();
    this.broadcastState();
    return e;
  }

  /** Moderator: a play the AI could not see (or a correction). */
  addManualEvent(team: FbTeamId, kind: FbEventKind): FbEventEntry | null {
    if (this.phase === 'lobby') return null;
    if (this.phase === 'ended' || this.phase === 'halftime') {
      const now = this.now();
      const e = this.buildEvent(
        { source: 'manual', kind, team, aiConfidence: 1 },
        now,
        'confirmed',
      );
      this.events.push(e);
      this.afterLedgerChange(now);
      this.winner = this.phase === 'ended' ? this.leaderByScore() : this.winner;
      this.deps.broadcast({
        type: 'fb_event',
        roomId: this.roomId,
        kind: 'manual',
        event: { ...e },
        scores: this.scores(),
      });
      this.publishHud();
      this.broadcastState();
      return e;
    }
    return this.ingestEvent({ source: 'manual', kind, team, aiConfidence: 1 });
  }

  /** Void the given event, else the newest confirmed goal, else the newest confirmed event. */
  undoEvent(eventId?: string): FbEventEntry | null {
    const target = eventId
      ? this.events.find((e) => e.id === eventId)
      : ([...this.events]
          .reverse()
          .find((e) => e.status === 'confirmed' && e.kind === 'goal') ??
        [...this.events].reverse().find((e) => e.status === 'confirmed'));
    if (!target || target.status === 'voided') return null;
    const now = this.now();
    target.status = 'voided';
    this.afterLedgerChange(now);
    if (this.phase === 'ended') this.winner = this.leaderByScore();
    this.deps.broadcast({
      type: 'fb_event',
      roomId: this.roomId,
      kind: 'undone',
      event: { ...target },
      scores: this.scores(),
    });
    this.publishHud();
    this.broadcastState();
    return target;
  }

  /** Dev hook (FB_SIM=1): fabricate an AI event. */
  simulateEvent(
    kind: FbEventKind,
    team: FbTeamId | null,
    side?: FbSide,
    confidence = 0.9,
  ): FbEventEntry | null {
    const now = this.now();
    const e = this.ingestEvent({
      source: 'ai',
      kind,
      team,
      side,
      aiConfidence: confidence,
      candidate: kind === 'goal',
    });
    if (e) {
      const { label, tone } = eventLabel(kind);
      this.aiLog.push(
        {
          kind: e.status === 'pending' ? 'refcall' : 'event',
          tone,
          label,
          text: `simulated · ${team ?? 'nobody'}`,
        },
        now,
      );
      this.flushAiLog();
    }
    return e;
  }

  // ── Instant replay ────────────────────────────────────────────────────────

  private scheduleInstantReplay(event: FbEventEntry, now: number): void {
    this.closeInstantReplay();
    const cam = this.replaySourceCam();
    const cut = this.deps.cutReplayClip;
    if (
      !this.config.replay ||
      !cam?.inputId ||
      !cam.fileName ||
      event.mediaMs == null ||
      !cut
    )
      return;
    const openAt = now + this.hudHoldMs() + this.config.replayDelayMs;
    this.instantReplay = {
      eventId: event.id,
      file: null,
      inputId: null,
      durationMs: 0,
      openAt,
      clipStartAt: null,
      closeAt: null,
      dropped: false,
    };
    const eventId = event.id;
    const crop = this.replayCrop(cam, event.mediaMs);
    void cut(cam.fileName, event.mediaMs, eventId, crop ?? undefined)
      .then((clip) => {
        if (this.disposed) return;
        this.onReplayEvent(
          clip
            ? { type: 'replay_ready', eventId, ...clip }
            : { type: 'replay_failed', eventId, reason: 'file cut failed' },
        );
      })
      .catch((err) => {
        if (this.disposed) return;
        this.onReplayEvent({
          type: 'replay_failed',
          eventId,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    this.armInstantReplayTimer(openAt - now);
  }

  /** The panorama, or the camera on air in a three-camera session. */
  private replaySourceCam(): CamState | null {
    const pano = this.cams.get('pano');
    if (pano?.inputId) return pano;
    const onAir = this.tricam?.cam ? this.cams.get(this.tricam.cam) : null;
    if (onAir?.inputId) return onAir;
    return this.drivingCam();
  }

  /** Replay crop in SOURCE px (the clip may be a downscaled panorama). */
  private replayCrop(
    cam: CamState,
    mediaMs: number,
  ): { x: number; y: number; w: number; h: number } | null {
    if (cam.role !== 'pano') return null;
    const t = cam.telemetry;
    const pano = this.pano();
    const centre = t.ball
      ? ballMean(t.ball, mediaMs - 1500, mediaMs + 500)
      : null;
    if (!centre) return null;
    const crop = cropForReplay(
      { x: centre.px, y: centre.py },
      this.config.director,
      pano,
      this.outputAspect(),
    );
    const k = cam.camWidth ? cam.camWidth / pano.w : 1;
    return {
      x: Math.round(crop.x * k),
      y: Math.round(crop.y * k),
      w: Math.round(crop.w * k),
      h: Math.round(crop.h * k),
    };
  }

  private onReplayEvent(
    ev:
      | {
          type: 'replay_ready';
          eventId: string;
          file: string;
          durationMs: number;
        }
      | { type: 'replay_failed'; eventId: string; reason?: string },
  ): void {
    const r = this.instantReplay;
    if (!r || r.eventId !== ev.eventId || r.inputId || r.dropped) return;
    if (ev.type === 'replay_failed') {
      this.aiLog.push(
        {
          kind: 'replay',
          tone: 'bad',
          label: 'REPLAY',
          text: `clip failed · ${ev.reason ?? 'error'}`,
        },
        this.now(),
      );
      this.flushAiLog();
      this.dropInstantReplay(`cut: ${ev.reason ?? 'failed'}`);
      return;
    }
    if (!(ev.durationMs > 0)) {
      this.dropInstantReplay('empty clip');
      return;
    }
    r.file = ev.file;
    r.durationMs = ev.durationMs;
    this.aiLog.push(
      {
        kind: 'replay',
        tone: 'chalk',
        label: 'REPLAY',
        text: `clip ready · ${(ev.durationMs / 1000).toFixed(1)} s`,
      },
      this.now(),
    );
    this.flushAiLog();
    const now = this.now();
    const startIn = Math.max(0, r.openAt - REPLAY_CLIP_LEAD_MS - now);
    const offsetMs = this.deps.getPipelineTimeMs() + startIn;
    r.clipStartAt = now + startIn;
    void this.deps
      .registerReplayClip(ev.file, offsetMs)
      .then((inputId) => {
        if (this.disposed || this.instantReplay !== r || r.dropped) {
          if (inputId) this.deps.unregisterReplayClip(inputId, ev.file);
          return;
        }
        if (!inputId) {
          this.dropInstantReplay('register failed');
          return;
        }
        r.inputId = inputId;
        const at = this.now();
        if (at >= r.openAt) this.openInstantReplay(at);
      })
      .catch((err) => {
        console.error('[fb] replay clip register failed', err);
        this.dropInstantReplay('register failed');
      });
  }

  private armInstantReplayTimer(delayMs: number): void {
    if (this.instantReplayTimer) clearTimeout(this.instantReplayTimer);
    this.instantReplayTimer = setTimeout(
      () => {
        this.instantReplayTimer = null;
        this.tickInstantReplay();
      },
      Math.max(0, delayMs),
    );
  }

  private tickInstantReplay(): void {
    if (this.disposed) return;
    const r = this.instantReplay;
    if (!r || r.dropped) return;
    const now = this.now();
    if (r.closeAt != null) {
      if (now >= r.closeAt) this.closeInstantReplay();
      else this.armInstantReplayTimer(r.closeAt - now);
      return;
    }
    if (r.inputId) {
      if (now >= r.openAt) this.openInstantReplay(now);
      else this.armInstantReplayTimer(r.openAt - now);
      return;
    }
    if (now >= r.openAt + REPLAY_OPEN_GRACE_MS) {
      this.dropInstantReplay('clip never arrived');
      return;
    }
    this.armInstantReplayTimer(r.openAt + REPLAY_OPEN_GRACE_MS - now);
  }

  private openInstantReplay(now: number): void {
    const r = this.instantReplay;
    if (!r || !r.inputId || r.closeAt != null) return;
    const clipEndAt = (r.clipStartAt ?? now) + r.durationMs;
    r.closeAt = Math.max(
      now + KBT_VIEW_TRANSITION_MS,
      clipEndAt - KBT_VIEW_TRANSITION_MS,
    );
    this.armInstantReplayTimer(r.closeAt - now);
    this.syncScene(now);
  }

  private closeInstantReplay(): void {
    const r = this.instantReplay;
    if (!r) return;
    this.instantReplay = null;
    if (this.instantReplayTimer) {
      clearTimeout(this.instantReplayTimer);
      this.instantReplayTimer = null;
    }
    const { inputId, file } = r;
    if (inputId && file)
      setTimeout(
        () => this.deps.unregisterReplayClip(inputId, file),
        KBT_VIEW_TRANSITION_MS + 100,
      );
    if (!this.disposed) this.syncScene();
  }

  private dropInstantReplay(reason: string): void {
    const r = this.instantReplay;
    if (!r) return;
    console.log(`[fb] instant replay dropped (${reason})`);
    r.dropped = true;
    if (this.instantReplayTimer) {
      clearTimeout(this.instantReplayTimer);
      this.instantReplayTimer = null;
    }
    if (r.inputId && r.file) this.deps.unregisterReplayClip(r.inputId, r.file);
    r.inputId = null;
    if (!this.disposed) this.syncScene();
  }

  private instantReplayOpen(now: number): boolean {
    const r = this.instantReplay;
    return !!r && !r.dropped && r.closeAt != null && now < r.closeAt;
  }

  // ── Director ──────────────────────────────────────────────────────────────

  private requestedView(): FbView {
    return this.viewOverride.mode === 'view' ? this.viewOverride.view : 'auto';
  }

  /**
   * One director step: the follow window (panorama) or the camera cut
   * (three cameras) for the frame about to air; pushes the main tile with a
   * linear glide of one tick, or restages on a view switch.
   */
  private directorTick(now: number, force = false): void {
    if (!force && now - this.lastDirectorAt < DIRECTOR_TICK_MS) return;
    const dt = this.lastDirectorAt ? now - this.lastDirectorAt : 0;
    this.lastDirectorAt = now;
    const session = this.session();
    if (!session) return;
    const air = this.airMediaMs(now + DIRECTOR_GLIDE_MS);
    const t = this.telemetry();
    if (session === 'pano') {
      const pano = this.pano();
      const aspect = this.outputAspect();
      const requested = this.requestedView();
      const view = resolvePanoView(requested);
      const cfg = this.config.director;
      let target: { x: number; y: number } | null = null;
      let speed = 0;
      let fixed: { w: number } | null = null;
      if (view === 'follow') {
        if (t?.ball && air != null) {
          const b = ballMean(
            t.ball,
            air - cfg.averageMs,
            air + cfg.lookaheadMs,
          );
          if (b) {
            target = { x: b.px, y: b.py };
            speed = ballSpeedPx(t.ball, air);
          }
        }
      } else {
        const crop =
          view === 'wide'
            ? wideCrop(pano, aspect, t?.zones ?? null)
            : goalCrop(
                view === 'left-goal' ? 'left' : 'right',
                pano,
                aspect,
                t?.zones ?? null,
              );
        target = { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
        fixed = { w: crop.w };
      }
      const tracked = view !== 'follow' || target != null;
      if (view === 'follow') {
        if (target) this.ballLostSince = null;
        else if (this.ballLostSince == null) this.ballLostSince = now;
      } else this.ballLostSince = null;
      const lostForMs =
        this.ballLostSince != null ? now - this.ballLostSince : 0;
      const switched = this.effectiveView !== view;
      this.effectiveView = view;
      if (
        this.ballTracked !== (target != null && view === 'follow') &&
        view === 'follow'
      ) {
        this.ballTracked = target != null;
        this.aiLog.push(
          {
            kind: 'director',
            tone: this.ballTracked ? 'good' : 'amber',
            label: 'BALL',
            text: this.ballTracked
              ? 'tracked'
              : `lost · wide in ${(BALL_LOST_WIDE_MS / 1000).toFixed(0)} s`,
          },
          now,
        );
      }
      // A view switch snaps the state to the new window and lets the tile
      // transition (VIEW_SWITCH_MS eased, or a hard cut) carry the move;
      // within a view the window eases one tick at a time.
      const zones = t?.zones ?? null;
      let next: FollowState;
      if (fixed) {
        next =
          switched || !this.follow
            ? { cx: target!.x, cy: target!.y, w: fixed.w, vx: 0, vy: 0, vw: 0 }
            : stepFollow(
                this.follow,
                {
                  target,
                  speedPxS: 0,
                  dtMs: dt,
                  auto: false,
                  lostForMs: 0,
                  fixedWidth: fixed.w,
                },
                cfg,
                pano,
                aspect,
                zones,
              );
      } else {
        next = stepFollow(
          switched ? null : this.follow,
          {
            target,
            speedPxS: speed,
            dtMs: dt,
            auto: requested === 'auto',
            lostForMs,
          },
          cfg,
          pano,
          aspect,
          zones,
        );
      }
      this.follow = next;
      this.currentCrop = cropOf(next, aspect, pano);
      this.currentCropExact = exactCropOf(next, aspect, pano);
      void this.applyDirectorTile(
        switched
          ? cfg.switchStyle === 'cut'
            ? 0
            : VIEW_SWITCH_MS
          : DIRECTOR_GLIDE_MS,
        switched,
      );
      if (switched) this.deps.broadcast(this.stateSnapshot());
    } else {
      const requested = this.requestedView();
      const available = (['left', 'centre', 'right'] as const).filter(
        (r) => this.cams.get(r)?.inputId,
      );
      let cam: FbCamRole;
      if (
        requested === 'left' ||
        requested === 'centre' ||
        requested === 'right'
      ) {
        cam = requested;
        this.tricam = { cam, since: now, candidate: null };
      } else {
        const centroid = t?.zxy && air != null ? centroidAt(t.zxy, air) : null;
        const attacksLeft = this.attacksLeftNow();
        this.tricam = stepTricam(
          this.tricam,
          centroid?.x ?? null,
          attacksLeft == null ? null : attacksLeft === 'A',
          now,
          available,
        );
        cam = this.tricam.cam;
      }
      this.ballTracked = t?.zxy != null;
      const view: FbView =
        requested === 'auto' ? (cam === 'pano' ? 'centre' : cam) : requested;
      const switched = this.effectiveView !== view;
      this.effectiveView = view;
      if (switched) {
        this.aiLog.push(
          { kind: 'director', tone: 'chalk', label: 'CUT', text: `${cam} cam` },
          now,
        );
        void this.restage();
        this.deps.broadcast(this.stateSnapshot());
      }
    }
    if (now - this.lastDirectorBroadcastAt >= DIRECTOR_BROADCAST_MS) {
      this.lastDirectorBroadcastAt = now;
      this.deps.broadcast({
        type: 'fb_director',
        roomId: this.roomId,
        director: this.directorSnapshot(),
      });
    }
  }

  /**
   * Which team attacks the left goal IN THE FOOTAGE: the host's override, else
   * the clip's sidecar. Never swapped by the period — the picture does not
   * change ends at half time (a second-half clip says so in its own sidecar),
   * and the AI EVENTS mapping (`selectAiEvents`) reads the same value.
   */
  private attacksLeftNow(): FbTeamId | null {
    return this.config.attacksLeft ?? this.clipAttacksLeft;
  }

  private directorSnapshot(): FbDirectorState {
    const c = this.currentCrop;
    return {
      session: this.session(),
      view: this.requestedView(),
      effectiveView: this.effectiveView,
      crop:
        this.session() === 'pano' && c
          ? { x: c.x, y: c.y, w: c.w, h: c.h }
          : null,
      cam: this.session() === 'tricam' ? (this.tricam?.cam ?? null) : null,
      ballTracked: this.ballTracked,
    };
  }

  /** The panorama's tile for the current crop (the virtual camera). */
  private panoTile(): FbStageTile | null {
    const cam = this.cams.get('pano');
    if (!cam?.inputId) return null;
    const pano = this.pano();
    const res = this.deps.getResolution();
    const crop =
      this.currentCropExact ??
      wideCrop(pano, res.width / res.height, this.telemetry()?.zones ?? null);
    return { inputId: cam.inputId, ...tileForCrop(crop, pano, res) };
  }

  /** Move the main tile only (no choreography), one glide per tick. */
  private async applyDirectorTile(
    transitionMs: number,
    eased: boolean,
  ): Promise<void> {
    if (this.directorApplying || this.disposed) return;
    const main = this.panoTile();
    if (!main) return;
    if (!this.lastStagedInputIds.has(main.inputId)) {
      // Not on stage yet (lobby before the first restage): a full restage.
      await this.restage();
      return;
    }
    const tiles: FbStageTile[] = this.lastDesiredTiles.map((t) =>
      t.inputId === main.inputId
        ? {
            ...t,
            x: main.x,
            y: main.y,
            width: main.width,
            height: main.height,
            transitionDurationMs: transitionMs,
            ...(eased && transitionMs > 0
              ? { transitionEasing: 'cubic_bezier_ease_in_out' }
              : {}),
          }
        : { ...t, transitionDurationMs: 0 },
    );
    if (!tiles.some((t) => t.inputId === main.inputId)) {
      await this.restage();
      return;
    }
    this.lastDesiredTiles = tiles;
    this.lastAppliedRects.set(main.inputId, {
      x: main.x,
      y: main.y,
      width: main.width,
      height: main.height,
    });
    this.directorApplying = true;
    try {
      await this.deps.layoutTiles(tiles);
    } catch (err) {
      console.error('[fb] director layoutTiles failed', err);
    } finally {
      this.directorApplying = false;
    }
  }

  // ── Scenes + stage ────────────────────────────────────────────────────────

  private computeScene(now = this.now()): FbHudScene {
    if (this.phase === 'lobby') return 'lobby';
    if (
      this.phase === 'ended' &&
      this.endedAt != null &&
      now - this.endedAt >= this.hudHoldMs() + EVENT_BANNER_MS
    )
      return 'ended';
    if (this.instantReplayOpen(now)) return 'replay';
    return 'live';
  }

  private syncScene(now = this.now()): void {
    const scene = this.computeScene(now);
    if (scene === this.stagedScene) return;
    this.stagedScene = scene;
    void this.restage();
    this.deps.broadcast(this.stateSnapshot());
  }

  private buildStage(scene: FbHudScene): {
    tiles: FbStageTile[];
    stage: FbHudStage;
  } {
    const res = this.deps.getResolution();
    const tiles: FbStageTile[] = [];
    const session = this.session();
    const stage: FbHudStage = {
      scene,
      mainInputId: null,
      session,
      view: this.effectiveView,
      crop: null,
      replay: null,
    };
    const replay = this.instantReplay;
    if (scene === 'replay' && replay?.inputId) {
      const e = this.events.find((x) => x.id === replay.eventId) ?? null;
      const team = e?.team ?? null;
      stage.replay = {
        inputId: replay.inputId,
        title: e ? eventTitle(e.kind) : 'REPLAY',
        team,
        teamName: team ? this.config.teams[team].name : null,
        color: team ? this.config.teams[team].color : '#f4f1e8',
        clock: e ? fmtClock(e.clockMs) : '',
      };
    }
    if (session === 'pano') {
      const main = this.panoTile();
      if (main) {
        tiles.push(main);
        stage.mainInputId = main.inputId;
        const c = this.currentCrop;
        if (c) stage.crop = { x: c.x, y: c.y, width: c.w, height: c.h };
      }
    } else if (session === 'tricam') {
      const onAir = this.tricam?.cam ?? 'centre';
      const cam = this.cams.get(onAir)?.inputId
        ? this.cams.get(onAir)!
        : [...this.cams.values()].find((c) => c.inputId);
      if (cam?.inputId) {
        tiles.push({
          inputId: cam.inputId,
          x: 0,
          y: 0,
          width: res.width,
          height: res.height,
        });
        stage.mainInputId = cam.inputId;
      }
    }
    for (const cam of this.cams.values()) {
      if (cam.inputId && !tiles.some((t) => t.inputId === cam.inputId)) {
        tiles.push({ inputId: cam.inputId, ...kbtParkRect(res) });
      }
    }
    return { tiles, stage };
  }

  private currentStage(): FbHudStage {
    return this.lastStage ?? this.buildStage(this.stagedScene).stage;
  }

  private async restage(): Promise<void> {
    await this.applyStage();
  }

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
        if (wasStaged)
          return {
            ...t,
            transitionDurationMs: 300,
            transitionEasing: 'cubic_bezier_ease_in_out',
          };
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
    if (nextParkAt < Infinity)
      this.parkTimer = setTimeout(
        () => this.commitParks(),
        Math.max(0, nextParkAt - now),
      );
    this.publishStageNow();
    try {
      await this.deps.layoutTiles(decorated);
    } catch (err) {
      console.error('[fb] layoutTiles failed', err);
    }
  }

  private commitParks(): void {
    this.parkTimer = null;
    const now = this.now();
    let nextAt = Infinity;
    const tiles = this.lastDesiredTiles.map((t) => {
      const leaving = this.leavingTiles.get(t.inputId);
      if (!leaving)
        return t.width > 1
          ? {
              ...t,
              transitionDurationMs: 300,
              transitionEasing: 'cubic_bezier_ease_in_out',
            }
          : { ...t, transitionDurationMs: 0 };
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
    if (nextAt < Infinity)
      this.parkTimer = setTimeout(
        () => this.commitParks(),
        Math.max(0, nextAt - now),
      );
    this.deps
      .layoutTiles(tiles)
      .catch((err) => console.error('[fb] park layoutTiles failed', err));
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
      this.lastEvent == null &&
      !this.aiRun
    )
      this.stop();
  }

  private tick(): void {
    const now = this.now();
    this.pollCameras(now);
    this.reapCommentator(now);
    this.checkFileCamLoop(now);
    this.checkAiClock(now);
    if (this.aiEventsOn && !this.aiRun && !this.aiLoading)
      void this.armAiEvents();
    this.directorTick(now);
    this.checkAutoFlow(now);
    this.syncScene(now);
    if (this.phase !== 'lobby') {
      if (now - this.lastMatchBroadcastAt >= MATCH_BROADCAST_MS) {
        this.lastMatchBroadcastAt = now;
        this.deps.broadcast(this.getMatchSnapshot());
      }
    }
    if (now - this.lastPeriodicHudAt >= this.hudMinIntervalMs) {
      this.lastPeriodicHudAt = now;
      this.publishHud();
    }
    this.flushAiLog();
    this.maybeStop();
  }

  private pollCameras(now: number): void {
    if (now - this.lastCamPoll < 1000) return;
    this.lastCamPoll = now;
    const isLive = this.deps.isInputConnected;
    let changed = false;
    for (const cam of this.cams.values()) {
      const connected = cam.inputId != null && isLive(cam.inputId);
      if (connected !== cam.camConnected) {
        cam.camConnected = connected;
        changed = true;
      }
    }
    if (changed) this.broadcastState();
  }

  // ── Snapshots + HUD ───────────────────────────────────────────────────────

  private publicCam(role: FbCamRole): FbCam {
    const cam = this.cams.get(role);
    if (!cam) return { role, connected: false, source: 'file' };
    const clip = this.clipSnapshot(cam, this.now());
    return {
      role,
      connected: cam.camConnected,
      source: 'file',
      ...(cam.fileName ? { fileName: cam.fileName } : {}),
      ...(clip ? { clip } : {}),
      ...(cam.camWidth && cam.camHeight
        ? { camWidth: cam.camWidth, camHeight: cam.camHeight }
        : {}),
      ...(cam.telemetry.meta?.session
        ? { session: cam.telemetry.meta.session }
        : {}),
      telemetry: { ...cam.telemetryFlags },
    };
  }

  private teamStats(team: FbTeamId): FbTeamStats {
    const t = this.tally[team];
    return {
      name: this.config.teams[team].name,
      short: this.config.teams[team].short,
      color: this.config.teams[team].color,
      score: t.score,
      chances: t.chances,
      shots: t.shots,
      shotsOnTarget: t.shotsOnTarget,
      corners: t.corners,
      sprints: t.sprints,
    };
  }

  private trackingStats(now: number): FbTrackingStats[] {
    const t = this.telemetry();
    const air = this.airMediaMs(now);
    if (!t?.zxy || air == null) return [];
    return [...this.statsFor(t.zxy, air)].sort((a, b) => b.topKmh - a.topKmh);
  }

  /**
   * `statsAt` for the on-air sample, shared by the panel's tracking table and
   * the minimap chips: both ask for the same sample several times a tick.
   */
  private statsFor(zxy: FbZxy, airMs: number): ReturnType<typeof statsAt> {
    const idx = Math.round(airMs / (1000 / zxy.hz));
    const c = this.statsCache;
    if (c && c.zxy === zxy && c.idx === idx) return c.stats;
    const stats = statsAt(zxy, airMs);
    this.statsCache = { zxy, idx, stats };
    return stats;
  }

  stateSnapshot(): FbStateEvent {
    const now = this.now();
    return {
      type: 'fb_state',
      roomId: this.roomId,
      phase: this.phase,
      period: this.period,
      config: structuredClone(this.config),
      teams: { A: this.teamStats('A'), B: this.teamStats('B') },
      cams: {
        pano: this.publicCam('pano'),
        left: this.publicCam('left'),
        centre: this.publicCam('centre'),
        right: this.publicCam('right'),
      },
      session: this.session(),
      commentator: this.commentator
        ? { name: this.commentator.name, connected: this.commentator.connected }
        : null,
      scene: this.stagedScene,
      viewOverride: { ...this.viewOverride },
      director: this.directorSnapshot(),
      minimap: this.minimapOn,
      aiEvents: this.aiEventsStatus(),
      aiRun: this.aiRunSnapshot(),
      pending: [...this.events]
        .filter((e) => e.status === 'pending')
        .reverse()
        .map((e) => ({ ...e })),
      recent: [...this.events]
        .slice(-RECENT_EVENTS)
        .reverse()
        .map((e) => ({ ...e })),
      tracking: this.trackingStats(now),
      winner: this.winner,
      isRecording: this.deps.hasActiveRecording?.() ?? false,
    };
  }

  getMatchSnapshot(): FbMatchEvent {
    const now = this.now();
    return {
      type: 'fb_match',
      roomId: this.roomId,
      phase: this.phase,
      period: this.period,
      startedAtMs: this.matchStartedAt,
      elapsedMs: this.periodElapsed(now),
      halfMs: this.config.halfMs,
      clockFromClip: this.clockFromClipActive(),
      scores: this.scores(),
      winner: this.winner,
    };
  }

  private broadcastState(): void {
    this.deps.broadcast(this.stateSnapshot());
    this.publishHud();
  }

  private publishStageNow(): void {
    if (this.disposed) return;
    if (!this.lastAppliedHud) {
      this.publishHud(true);
      return;
    }
    this.applyToDeps(this.lastAppliedHud);
  }

  private applyToDeps(state: FbHudState | null): void {
    const merged = state ? { ...state, stage: this.currentStage() } : null;
    this.lastAppliedHud = merged;
    this.deps.publishHud(merged);
  }

  private buildMinimap(airMs: number | null): FbHudState['minimap'] {
    if (!this.minimapOn || !this.config.minimap) return null;
    const t = this.telemetry();
    if (!t?.zxy || airMs == null) return null;
    const players = playersAt(t.zxy, airMs).map((p) => ({
      tag: p.tag,
      x: Math.round(p.x * 2) / 2,
      y: Math.round(p.y * 2) / 2,
      kmh: Math.round(p.v * 3.6),
    }));
    let ball: { x: number; y: number } | null = null;
    if (t.ball) {
      const b = ballAt(t.ball, airMs);
      if (b && Number.isFinite(b.X) && Number.isFinite(b.Y))
        ball = { x: Math.round(b.X * 2) / 2, y: Math.round(b.Y * 2) / 2 };
      else if (b && t.zones?.camera) {
        const [X, Y] = unprojectPitch(t.zones.camera, b.px, b.py);
        ball = { x: Math.round(X * 2) / 2, y: Math.round(Y * 2) / 2 };
      }
    }
    const sprint = sprintAt(t.zxy, airMs);
    let top: { tag: number; kmh: number } | null = null;
    for (const s of this.statsFor(t.zxy, airMs))
      if (!top || s.topKmh > top.kmh)
        top = { tag: s.tag, kmh: Math.round(s.topKmh) };
    return {
      size: this.config.minimapSize,
      teamColor: this.config.teams.A.color,
      teamShort: this.config.teams.A.short,
      players,
      ball,
      sprint: sprint
        ? { tag: sprint.tag, kmh: Math.round(sprint.topKmh) }
        : null,
      top,
    };
  }

  private publishHud(immediate = false): void {
    if (this.disposed) return;
    const now = this.now();
    const hold = this.hudHoldMs();
    // Held fields describe the frame airing when they land.
    const airMs = this.airMediaMs(now + hold);
    const last = this.lastEvent;
    const banner =
      this.banner && now - this.banner.at <= BANNER_MS ? this.banner : null;
    const driving = this.drivingCam();
    const tracking = this.phase === 'ended' ? this.trackingStats(now) : [];
    const snapshot: FbHudState = {
      stage: this.currentStage(),
      teams: {
        A: { ...this.config.teams.A, score: this.tally.A.score },
        B: { ...this.config.teams.B, score: this.tally.B.score },
      },
      clock: {
        phase: this.phase,
        period: this.period,
        elapsedMs: Math.floor(this.periodElapsed(now + hold) / 1000) * 1000,
        halfMs: this.config.halfMs,
        running: this.phase === 'live',
      },
      lastEvent: last
        ? {
            kind: last.event.kind,
            title: eventTitle(last.event.kind),
            team: last.event.team,
            teamName: last.event.team
              ? this.config.teams[last.event.team].name
              : null,
            color: last.event.team
              ? this.config.teams[last.event.team].color
              : '#f4f1e8',
            pending: last.event.status === 'pending',
            detail: last.event.detail ?? null,
            showBanner:
              last.event.status !== 'voided' &&
              BANNER_KINDS.has(last.event.kind) &&
              now - last.at <= EVENT_BANNER_MS,
          }
        : null,
      pendingCount: this.events.filter((e) => e.status === 'pending').length,
      minimap: this.phase === 'lobby' ? null : this.buildMinimap(airMs),
      lobby:
        this.phase === 'lobby'
          ? {
              qr: { imageId: this.qrImageId, label: this.joinLabel },
              cams: [...this.cams.values()].map((cam) => ({
                role: cam.role,
                fileName: cam.fileName,
                live: cam.camConnected,
              })),
              commentatorName: this.commentator?.name ?? null,
              halfMs: this.config.halfMs,
              telemetry: driving ? { ...driving.telemetryFlags } : null,
            }
          : null,
      ended:
        this.phase === 'ended'
          ? {
              winner: this.winner,
              teams: { A: this.endedTeam('A'), B: this.endedTeam('B') },
              topSpeed: tracking[0]
                ? { tag: tracking[0].tag, kmh: Math.round(tracking[0].topKmh) }
                : null,
              topDistance: tracking.length
                ? (() => {
                    const d = [...tracking].sort(
                      (a, b) => b.meters - a.meters,
                    )[0];
                    return { tag: d.tag, meters: d.meters };
                  })()
                : null,
            }
          : null,
      banner,
    };
    if (immediate || hold === 0) {
      for (const t of this.hudTimers) clearTimeout(t);
      this.hudTimers.clear();
      this.hudApplyAt = now;
      this.applyToDeps(snapshot);
    } else {
      this.applyHudHeld(snapshot, hold);
    }
  }

  private endedTeam(team: FbTeamId) {
    const t = this.tally[team];
    return {
      score: t.score,
      chances: t.chances,
      shots: t.shots,
      shotsOnTarget: t.shotsOnTarget,
      corners: t.corners,
    };
  }

  private flushAiLog(): void {
    if (this.disposed) return;
    const entries = this.aiLog.drain();
    if (entries.length === 0) return;
    this.deps.broadcast({ type: 'fb_ai_log', roomId: this.roomId, entries });
  }

  private applyHudHeld(state: FbHudState, hold: number): void {
    const now = this.now();
    const applyAt = Math.max(now + hold, this.hudApplyAt + 1);
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
    this.unloadAiRun();
    for (const t of this.hudTimers) clearTimeout(t);
    this.hudTimers.clear();
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    if (this.instantReplayTimer) {
      clearTimeout(this.instantReplayTimer);
      this.instantReplayTimer = null;
    }
    if (this.instantReplay?.inputId && this.instantReplay.file) {
      this.deps.unregisterReplayClip(
        this.instantReplay.inputId,
        this.instantReplay.file,
      );
    }
    this.instantReplay = null;
    for (const cam of this.cams.values()) cam.inputId = null;
    this.cams.clear();
    this.commentator = null;
    this.events = [];
    this.deps.publishHud(null);
  }
}
