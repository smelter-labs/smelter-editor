import { randomUUID } from 'node:crypto';
import type {
  ObActionSource,
  ObActiveLowerThird,
  ObAudioPolicy,
  ObCamRole,
  ObConfig,
  ObConfigPatch,
  ObControlAction,
  ObEffects,
  ObErrorCode,
  ObLlmModelId,
  ObLlmStatus,
  ObLogEntry,
  ObLogKind,
  ObLogTone,
  ObOperatorCommand,
  ObPhase,
  ObPresetId,
  ObRuleset,
  ObRundownItem,
  ObShot,
  ObSignalSummary,
  ObState,
  ObStats,
  ObTally,
  ObTitleBug,
  ObTransition,
  RoomEvent,
} from '@smelter-editor/types';
import {
  OB_CONFIG_LIMITS,
  OB_DEFAULT_CONFIG,
  OB_PACING_DIAL_FACTOR,
  OB_PRESET_IDS,
  OB_PRESET_META,
  OB_RULESET_LIMITS,
  OB_TRANSITION_LIMITS,
  isObCamRole,
  isObLlmModelId,
  obPresetRuleset,
  obShotCams,
  obShotsEqual,
  parseObRuleset,
} from '@smelter-editor/types';
import type { ObHudState } from '../app/store';
import { CAPTIONS_SIDE_CHANNEL_DELAY_MS } from '../captions/constants';
import { WHIP_SIDE_CHANNEL_DELAY_MS } from '../ai-models/side-channel-config';
import type {
  ObAttentionFn,
  ObAudioSample,
  ObBrain,
  ObBrainContext,
  ObBriefResult,
  ObClock,
  ObDecision,
  ObLlmDeps,
  ObLlmModule,
  ObSignalSample,
  ObSignalsApi,
  ObSituation,
  ObVideoSample,
} from './contracts';
import {
  ObCams,
  cleanName,
  cleanTalent,
  roleLabel,
  toPublicCam,
  type ObCamRecord,
} from './cams';
import {
  isGrade,
  isTransitionType,
  parseAudioPolicy,
  parseObCommand,
} from './commands';
import { ObLog, camLabel, describeShot, describeTransition } from './log';
import {
  begin,
  dipEndsAt,
  finishTransition,
  initialProgram,
  onAirCams,
  scheduleAt,
  settle,
  standaloneDip,
  tallyOf,
  type ObLiveTransition,
  type ObProgramState,
} from './program';
import {
  audioMap,
  buildStage,
  primaryCam,
  transitionPlan,
  type ObInputTransition,
  type ObSceneCam,
  type ObStage,
  type ObStageTile,
  type ObTransitionPlan,
} from './scene';
import { OB_VIRTUAL_GLIDE_MS, ObVirtualCam } from './virtualCam';
import { ObLlmError } from './llm/errors';
import { obVanParamsForRole } from '../ai-models/ob-van/manifest';

// ── Public contract ────────────────────────────────────────────────────────

export type ObFileClock = {
  anchorWallMs: number;
  playFromMs: number;
  durationMs: number | null;
  delayMs: number;
};

/** How a camera's input is registered for the signal worker / captions. */
export type ObCamSignalOpts = {
  enabled: boolean;
  delayMs: number;
  transcription: boolean;
  params: Record<string, number | string>;
};

/**
 * Everything the controller needs from the room, injected so tests can fake
 * the world (same pattern as FbControllerDeps). Layout / camera calls are
 * best-effort async — the controller never blocks its tick on them.
 */
export type ObControllerDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  removeInput: (inputId: string) => Promise<void>;
  /** Replace the `ob-stage` layer with these tiles. */
  layoutTiles: (tiles: ObStageTile[]) => Promise<void>;
  runInputTransition: (
    inputId: string,
    transition: Omit<ObInputTransition, 'inputId'>,
  ) => void;
  setInputVolume: (inputId: string, volume: number) => void;
  isInputConnected: (inputId: string) => boolean;
  /** WHIP liveness (heartbeat); file / adopted cams use isInputConnected. */
  isInputLive?: (inputId: string) => boolean;
  getResolution: () => { width: number; height: number };
  hasActiveRecording?: () => boolean;
  publishHud: (state: ObHudState | null) => void;
  registerJoinQr: (url: string) => Promise<string>;
  /** A phone seat's WHIP input (InputManager; side channel per `opts`). */
  registerGameCam: (
    name: string,
    dims: { width: number; height: number } | undefined,
    opts: ObCamSignalOpts,
  ) => Promise<{ inputId: string; whipUrl: string; bearerToken: string }>;
  /** Re-apply the signal model / transcription (mp4 inputs re-register). */
  configureCamSignals?: (
    inputId: string,
    opts: ObCamSignalOpts,
  ) => Promise<void>;
  /** Side-channel delay the input was registered with (ms). */
  getSideChannelDelayMs?: (inputId: string) => number;
  /** Wall time of the engine's pipeline start (pts 0), null before start. */
  smelterStartMs?: () => number | null;
  getFileClock?: (inputId: string) => ObFileClock | null;
  resyncFileCams?: () => Promise<void>;
  /** Instant replay cut from a file cam's mp4 (data/ob-replays). */
  cutReplayClip?: (
    clipFileName: string,
    mediaMs: number,
    replayId: string,
  ) => Promise<{ file: string; durationMs: number } | null>;
  registerReplayClip: (
    file: string,
    offsetMs: number,
  ) => Promise<string | null>;
  unregisterReplayClip: (inputId: string, file: string) => void;
  getPipelineTimeMs: () => number;
  now?: () => number;
};

export type ObControllerFactories = {
  createSignals: (clock: ObClock) => ObSignalsApi;
  /** The auto pilot (`createObBrain` from `./brain`); `onNote` surfaces its diagnostics. */
  createBrain: (
    ruleset: ObRuleset,
    hooks: { onNote: (note: string) => void },
  ) => ObBrain;
  attention: ObAttentionFn;
  /** The LLM layer (`createObLlm` from `./llm`); null / absent = no LLM. */
  createLlm?: (
    deps: ObLlmDeps,
    opts: { intervalS: number },
  ) => ObLlmModule | null;
  /** The air clock (`makeObClock` from `./signals`); default `createObClock`. */
  createClock?: (deps: ObClockSource) => ObClock;
};

/** What an air clock needs from the room (same shape as `ObClockDeps`). */
export type ObClockSource = {
  smelterStartMs: () => number | null;
  registeredDelayMs: (camId: string) => number;
  now?: () => number;
};

export type ObCommandError = { ok: false; code: ObErrorCode; message: string };
export type ObCommandResult = { ok: true } | ObCommandError;

/** A sample for `simulateSignal` (OB_SIM): the worker payload without timing. */
export type ObSimSample =
  | Omit<ObAudioSample, 'arrivalMs' | 'procMs' | 'ptsNanos'>
  | Omit<ObVideoSample, 'arrivalMs' | 'procMs' | 'ptsNanos'>
  | { kind: 'transcript'; text: string };

/** A program change from any source (operator command, brain, LLM, system). */
export type ObChange = Pick<
  ObDecision,
  'shot' | 'transition' | 'effects' | 'lowerThird' | 'replay' | 'pacing'
> & {
  holdMs?: number;
  reason?: string;
  reasons?: string[];
  /** TAKE from preview: the old program lands on preview. */
  swapPreview?: boolean;
  logKind?: ObLogKind;
};

// ── Null implementations (tests, modules not wired) ────────────────────────

export const NULL_BRAIN: ObBrain = {
  step: () => null,
  setRuleset: () => {},
  reset: () => {},
};

export const NULL_ATTENTION: ObAttentionFn = () => null;

/** Signals stub: remembers what it was fed, reports nothing. */
export class ObNullSignals implements ObSignalsApi {
  readonly ingested: { camId: string; sample: ObSignalSample }[] = [];
  ingest(camId: string, sample: ObSignalSample): void {
    this.ingested.push({ camId, sample });
    if (this.ingested.length > 500) this.ingested.shift();
  }
  expire(): void {}
  view() {
    return {};
  }
  summary(): Record<string, ObSignalSummary> {
    return {};
  }
  setKeywordGroups(): void {}
  removeCam(): void {}
  reset(): void {
    this.ingested.length = 0;
  }
}

export const OB_NULL_FACTORIES: ObControllerFactories = {
  createSignals: () => new ObNullSignals(),
  createBrain: () => NULL_BRAIN,
  attention: NULL_ATTENTION,
};

/**
 * The air clock: a worker sample's air time from its pts (the engine's
 * pipeline start + pts), falling back to arrival − processing + the camera's
 * side-channel delay. `lookaheadMs` = how far ahead of now the freshest
 * signals sit (the median over cameras of air − arrival).
 */
export function createObClock(src: ObClockSource): ObClock {
  const now = src.now ?? Date.now;
  const ahead = new Map<string, number>();
  return {
    airMsOf(camId, s) {
      const delay = src.registeredDelayMs(camId);
      const fallback = s.arrivalMs - s.procMs + delay;
      const start = src.smelterStartMs();
      let air = fallback;
      if (s.ptsNanos != null && start != null) {
        const byPts = start + s.ptsNanos / 1e6;
        const skew = byPts - s.arrivalMs;
        if (skew <= delay + 1000 && skew >= -5000) air = byPts;
      }
      ahead.set(camId, air - s.arrivalMs);
      return air;
    },
    nowAir: () => now(),
    lookaheadMs() {
      const v = [...ahead.values()].sort((a, b) => a - b);
      if (v.length === 0) return 0;
      return Math.max(0, v[Math.floor(v.length / 2)]);
    },
  };
}

// ── Tunables ───────────────────────────────────────────────────────────────

const TICK_MS = 100;
/** A leaving tile parks this long before its fade-out ends (the shader then clears). */
const PARK_LEAD_MS = 50;
/** zoom-punch: the punch-out layout waits for the overscan frame to reach the engine. */
const PUNCH_STEP_MS = 60;
const STATE_MIN_INTERVAL_MS = 100;
const SIGNALS_MIN_INTERVAL_MS = 250;
const CAM_POLL_MS = 1000;
const SIGNAL_FRESH_MS = 3000;
/** The analyst may tip a near-tie, never pin a camera against a speaker. */
const OB_LLM_PREFER_BOOST_MAX = 0.3;
/** An LLM pacing override expires on its own; only the operator's persists. */
const OB_LLM_PACING_TTL_MS = 60_000;
const REPLAY_OPEN_GRACE_MS = 8000;
const REPLAY_CLOSE_LEAD_MS = 350;
const REPLAY_UNREGISTER_MS = 450;
const LOOP_RESYNC_LEAD_MS = 200;
/** A restarted clip's first samples (fresh VAD state, decoder start) are noise. */
const FILE_CAM_SETTLE_MS = 700;
/** File cams this close in length and start phase loop natively and stay in sync… */
const LOCKSTEP_MAX_LENGTH_DIFF_MS = 50;
const LOCKSTEP_MAX_PHASE_DIFF_MS = 250;
/** …until their length differences add up to this much drift. */
const LOCKSTEP_MAX_DRIFT_MS = 150;
const HISTORY_MAX = 20;
const LOG_TAIL = 20;
const TRANSCRIBED_ROLES = new Set<ObCamRole>(['speaker', 'guest', 'wide']);

const OFFLINE_LLM: ObLlmStatus = {
  available: false,
  model: null,
  analyst: false,
  intervalS: OB_DEFAULT_CONFIG.llm.analystIntervalS,
  busy: false,
  runs: 0,
  tokensIn: 0,
  tokensOut: 0,
  estCostUsd: 0,
  lastRunAtMs: null,
  lastNote: null,
  backoffUntilMs: null,
  error: null,
};

const clamp = (v: number, lim: { min: number; max: number }) =>
  Math.min(lim.max, Math.max(lim.min, Math.round(v)));

type ScheduledChange = {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  change: ObChange;
  source: ObActionSource;
  applyAtMs: number;
};

type ReplayState = {
  id: string;
  camId: string;
  camName: string;
  file: string | null;
  inputId: string | null;
  durationMs: number;
  requestedAt: number;
  clipStartAt: number | null;
  closeAt: number | null;
  dropped: boolean;
};

type StatsAcc = {
  startedAtMs: number | null;
  endedAtMs: number | null;
  cuts: number;
  bySource: Record<ObActionSource, number>;
  onAirMsByCam: Record<string, number>;
  holdSumMs: number;
  holds: number;
};

function emptyStats(): StatsAcc {
  return {
    startedAtMs: null,
    endedAtMs: null,
    cuts: 0,
    bySource: { operator: 0, auto: 0, llm: 0, system: 0 },
    onAirMsByCam: {},
    holdSumMs: 0,
    holds: 0,
  };
}

/** Worker payload → sample (plan B1: `{kind:'audio'|'video', …, procMs}`). */
export function parseWorkerSample(
  data: unknown,
  arrivalMs: number,
  ptsNanos?: number,
): ObAudioSample | ObVideoSample | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const n = (v: unknown, dflt = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  const pts = ptsNanos != null && Number.isFinite(ptsNanos) ? { ptsNanos } : {};
  if (d.kind === 'audio') {
    return {
      kind: 'audio',
      ...pts,
      arrivalMs,
      procMs: n(d.procMs),
      rms: n(d.rms, -90),
      speechProb: n(d.speechProb),
      speech: d.speech === true,
      onset: d.onset === true,
      ...(Array.isArray(d.bands)
        ? { bands: d.bands.filter((b): b is number => typeof b === 'number') }
        : {}),
    };
  }
  if (d.kind === 'video') {
    const box = (v: unknown) => {
      if (typeof v !== 'object' || v === null) return null;
      const b = v as Record<string, unknown>;
      if (![b.x, b.y, b.w, b.h].every((x) => typeof x === 'number'))
        return null;
      return {
        x: n(b.x),
        y: n(b.y),
        w: n(b.w),
        h: n(b.h),
        ...(typeof b.conf === 'number' ? { conf: b.conf } : {}),
      };
    };
    const persons = Array.isArray(d.persons)
      ? d.persons
          .map(box)
          .filter((b): b is NonNullable<ReturnType<typeof box>> => b !== null)
      : [];
    return {
      kind: 'video',
      ...pts,
      arrivalMs,
      procMs: n(d.procMs),
      frameW: n(d.frameW),
      frameH: n(d.frameH),
      persons,
      ball: box(d.ball),
      motion: n(d.motion),
    };
  }
  return null;
}

/**
 * OB Van ("the van") for one room: a manual desk — program / preview buses,
 * TAKE / CUT, shots, transitions, effects, lower thirds, title bug, audio
 * policy, tally on the phones — plus an auto pilot that cuts from per-camera
 * signals through the rules brain, and an optional LLM assistant. Every
 * program change, whoever asks for it, goes through `applyDecision`.
 */
export class ObVanController {
  private config: ObConfig = structuredClone(OB_DEFAULT_CONFIG);
  private phase: ObPhase = 'setup';
  private readonly cams = new ObCams();
  private prog: ObProgramState;
  /** The shot the stage shows (lags `prog.program` until a fade / dip cut). */
  private shownShot: ObShot | null = null;
  private operator: { clientId: string; name: string; key: string } | null =
    null;

  // ── program extras ──
  private effects: ObEffects = { ...OB_DEFAULT_CONFIG.effects };
  private lowerThird: ObActiveLowerThird | null = null;
  private titleSegment: string | null = null;
  private rundownIndex = -1;
  private ruleset: ObRuleset;
  private autoPausedUntil: number | null = null;
  private holdUntil: number | null = null;
  private lastDecisionAt: number | null = null;
  private pacingOverride: {
    minHoldMs?: number;
    maxHoldMs?: number;
    /** Set for llm-sourced overrides; cleared by `expire`. */
    untilMs?: number;
  } | null = null;
  private preferCam: { camId: string; untilMs: number; boost: number } | null =
    null;
  private history: { shot: ObShot; atAirMs: number }[] = [];
  private readonly scheduled = new Map<number, ScheduledChange>();
  private scheduleSeq = 0;
  private stats: StatsAcc = emptyStats();
  private wrapNotes: string | null = null;

  // ── stage machinery ──
  private lastTiles: ObStageTile[] = [];
  private lastStage: ObStage | null = null;
  private readonly leaving = new Map<string, number>();
  private readonly fadingUntil = new Map<string, number>();
  private readonly transitionTimers = new Set<ReturnType<typeof setTimeout>>();
  private parkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly virtualCam = new ObVirtualCam();
  private virtualApplying = false;
  private readonly lastVolumes = new Map<string, number>();
  private readonly lastTally = new Map<string, ObTally>();

  // ── replay ──
  private replay: ReplayState | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly replayUnregisterTimers = new Set<
    ReturnType<typeof setTimeout>
  >();

  // ── join QR ──
  private joinUrl: string | null = null;
  private qrImageId: string | null = null;

  // ── modules ──
  private readonly clock: ObClock;
  private readonly signals: ObSignalsApi;
  private readonly brain: ObBrain;
  private readonly llm: ObLlmModule | null;
  private llmStatusCache: ObLlmStatus | null = null;
  private readonly log = new ObLog();

  // ── loop + publish ──
  private timer: ReturnType<typeof setInterval> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStateAt = 0;
  private lastSignalsAt = 0;
  private lastSignalsKey = '';
  private lastHudKey = '';
  private lastCamPoll = 0;
  private lastLoopResyncSig: string | null = null;
  /** File cams mid-restart: worker samples are dropped until this wall time. */
  private readonly settleUntil = new Map<string, number>();
  private disposed = false;
  private engaged = false;

  constructor(
    private readonly roomId: string,
    private readonly deps: ObControllerDeps,
    private readonly factories: ObControllerFactories = OB_NULL_FACTORIES,
  ) {
    this.prog = initialProgram(this.now());
    this.ruleset = obPresetRuleset(this.config.presetId);
    this.clock = (factories.createClock ?? createObClock)({
      now: () => this.now(),
      smelterStartMs: () => this.deps.smelterStartMs?.() ?? null,
      registeredDelayMs: (camId) => this.cams.get(camId)?.delayMs ?? 0,
    });
    this.signals = factories.createSignals(this.clock);
    this.signals.setKeywordGroups(this.ruleset.keywords);
    this.brain = factories.createBrain(this.ruleset, {
      onNote: (note) =>
        this.pushLog({
          source: 'auto',
          kind: 'auto',
          tone: 'dim',
          label: 'AUTO',
          text: note,
        }),
    });
    this.llm =
      factories.createLlm?.(
        {
          getSituation: () => this.getSituation(),
          apply: (cmd, reasons) => {
            const r = this.operate(cmd, 'llm', reasons);
            if (!r.ok)
              this.pushLog({
                source: 'llm',
                kind: 'error',
                tone: 'bad',
                label: 'LLM',
                text: `${cmd.op} refused · ${r.message}`,
              });
          },
          log: (entry) => this.pushLog(entry),
          onStatus: (status) => {
            this.llmStatusCache = status;
            this.markStateDirty();
          },
          now: () => this.now(),
        },
        { intervalS: this.config.llm.analystIntervalS },
      ) ?? null;
    // `OB_VAN_LLM_MODEL` may pick a different initial model than the config
    // default — reflect it in the config when it is one the UI knows.
    const liveModel = this.llm?.status().model;
    if (liveModel && isObLlmModelId(liveModel))
      this.config.llm.model = liveModel;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  isEngaged(): boolean {
    return this.engaged;
  }

  private engage(): void {
    this.engaged = true;
    this.ensureRunning();
  }

  // ── WS ─────────────────────────────────────────────────────────────────

  handleMessage(clientId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    switch (msg.type) {
      case 'ob_spectate':
        this.spectate(clientId);
        break;
      case 'ob_operator_join':
        this.joinOperator(
          clientId,
          typeof msg.name === 'string' ? msg.name : 'Operator',
          typeof msg.operatorKey === 'string' && msg.operatorKey.length <= 64
            ? msg.operatorKey
            : undefined,
        );
        break;
      case 'ob_operator_leave':
        if (this.operator?.clientId === clientId) {
          this.operator = null;
          this.markStateDirty();
        }
        break;
      case 'ob_operator_cmd': {
        const cmd = parseObCommand(msg.cmd);
        if (!cmd) {
          this.sendError(clientId, 'bad_action', 'Unreadable command.');
          break;
        }
        const r = this.operate(cmd, 'operator');
        if (!r.ok) this.sendError(clientId, r.code, r.message);
        break;
      }
      case 'ob_cam_join':
        this.joinCam(clientId, msg);
        break;
      case 'ob_cam_request':
        void this.startCamera(clientId, dimsOf(msg));
        break;
      case 'ob_cam_stop': {
        const cam = this.cams.byClient(clientId);
        if (cam) {
          this.retireCamInput(cam);
          this.afterCamsChanged();
        }
        break;
      }
      case 'ob_cam_leave': {
        const cam = this.cams.byClient(clientId);
        if (cam) this.removeCam(cam, 'left');
        break;
      }
      default:
        break;
    }
  }

  handleDisconnect(clientId: string): void {
    const cam = this.cams.byClient(clientId);
    if (cam) {
      this.cams.detach(cam, this.now());
      this.pushLog({
        source: 'system',
        kind: 'cam',
        tone: 'amber',
        label: 'CAM',
        text: `CAM ${cam.number} · phone disconnected`,
        camId: cam.id,
      });
      this.markStateDirty();
    }
    if (this.operator?.clientId === clientId) {
      this.operator = null;
      this.markStateDirty();
    }
  }

  private sendError(
    clientId: string,
    code: ObErrorCode,
    message: string,
  ): void {
    this.deps.sendTo(clientId, { type: 'ob_error', code, message });
  }

  spectate(clientId: string): void {
    this.deps.sendTo(clientId, {
      type: 'ob_state',
      state: this.stateSnapshot(),
    });
    this.deps.sendTo(clientId, {
      type: 'ob_log',
      entries: this.log.snapshot(),
      reset: true,
    });
    this.deps.sendTo(clientId, {
      type: 'ob_signals',
      atMs: this.now(),
      signals: this.signals.summary(),
    });
  }

  private joinOperator(clientId: string, rawName: string, key?: string): void {
    this.engage();
    const name = cleanName(rawName, 'Operator');
    const previous = this.operator;
    this.operator = { clientId, name, key: key ?? randomUUID() };
    this.deps.sendTo(clientId, {
      type: 'ob_operator_joined',
      operatorKey: this.operator.key,
      name,
    });
    this.pushLog({
      source: 'operator',
      kind: 'note',
      tone: 'chalk',
      label: 'DESK',
      text:
        previous && previous.clientId !== clientId
          ? `${name} took the desk from ${previous.name}`
          : `${name} at the desk`,
    });
    this.markStateDirty();
  }

  // ── Cameras ───────────────────────────────────────────────────────────

  private joinCam(clientId: string, msg: Record<string, unknown>): void {
    this.engage();
    const role: ObCamRole = isObCamRole(msg.role) ? msg.role : 'wide';
    const joined = this.cams.join(
      clientId,
      {
        name: typeof msg.name === 'string' ? msg.name : '',
        role,
        ...(msg.talent === null || typeof msg.talent === 'string'
          ? { talent: msg.talent }
          : {}),
        ...(typeof msg.camKey === 'string' && msg.camKey.length <= 64
          ? { camKey: msg.camKey }
          : {}),
      },
      this.now(),
    );
    if (!joined) {
      this.sendError(clientId, 'room_full', 'All camera seats are taken.');
      return;
    }
    const { cam, adopted } = joined;
    const tally = this.tallies()[cam.id] ?? 'off';
    this.lastTally.set(cam.id, tally);
    this.deps.sendTo(clientId, {
      type: 'ob_cam_joined',
      camId: cam.id,
      camKey: cam.camKey,
      number: cam.number,
      role: cam.role,
      name: cam.name,
      talent: cam.talent,
      tally,
      phase: this.phase,
      camInputActive: cam.inputId != null,
    });
    this.pushLog({
      source: 'system',
      kind: 'cam',
      tone: 'good',
      label: 'CAM',
      text: `CAM ${cam.number} · ${cam.name} ${adopted ? 'back' : 'joined'} · ${roleLabel(cam.role)}`,
      camId: cam.id,
    });
    this.markStateDirty();
  }

  /** Signal-worker registration of a camera with `role` (captions → 8 s everywhere). */
  camSignalOpts(role: ObCamRole): ObCamSignalOpts {
    const captions = this.config.captions;
    return {
      enabled: true,
      delayMs: captions
        ? CAPTIONS_SIDE_CHANNEL_DELAY_MS
        : WHIP_SIDE_CHANNEL_DELAY_MS,
      transcription: captions && TRANSCRIBED_ROLES.has(role),
      params: obVanParamsForRole(role, this.config.presetId),
    };
  }

  private async startCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const cam = this.cams.byClient(clientId);
    if (!cam) {
      this.sendError(clientId, 'not_joined', 'Join as a camera first.');
      return;
    }
    this.retireCamInput(cam);
    const gen = ++cam.gen;
    if (dims) {
      cam.width = dims.width;
      cam.height = dims.height;
    }
    const opts = this.camSignalOpts(cam.role);
    let offer: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      offer = await this.deps.registerGameCam(cam.name, dims, opts);
    } catch (err) {
      console.error(`[ob] camera input register failed for ${clientId}`, err);
      this.sendError(
        clientId,
        'bad_action',
        'Camera slot could not be created — try again.',
      );
      return;
    }
    // The phone may have left, re-requested or been kicked while we awaited.
    if (
      this.disposed ||
      this.cams.get(cam.id) !== cam ||
      cam.gen !== gen ||
      cam.clientId !== clientId
    ) {
      void this.deps.removeInput(offer.inputId).catch(() => {});
      return;
    }
    cam.inputId = offer.inputId;
    cam.live = false;
    cam.delayMs =
      this.deps.getSideChannelDelayMs?.(offer.inputId) ?? opts.delayMs;
    this.deps.sendTo(clientId, {
      type: 'ob_cam_offer',
      camId: cam.id,
      inputId: offer.inputId,
      whipUrl: offer.whipUrl,
      bearerToken: offer.bearerToken,
    });
    this.afterCamsChanged();
  }

  private retireCamInput(cam: ObCamRecord): void {
    if (cam.inputId == null) return;
    const inputId = cam.inputId;
    cam.gen++;
    cam.inputId = null;
    cam.live = false;
    this.lastVolumes.delete(inputId);
    this.leaving.delete(inputId);
    this.dropCamFromShots(cam.id);
    void this.deps.removeInput(inputId).catch(() => {});
  }

  /** A local mp4 (connected by RoomState) becomes a camera. */
  attachFileCam(input: {
    role: ObCamRole;
    inputId: string;
    fileName: string;
    width?: number;
    height?: number;
    name?: string;
    talent?: string | null;
    subtitle?: string | null;
  }): { ok: true; camId: string } | ObCommandError {
    return this.addInputCam('file', input);
  }

  /** An existing connected room input becomes a camera (it leaves the room's own layers). */
  adoptInput(input: {
    role: ObCamRole;
    inputId: string;
    width?: number;
    height?: number;
    name?: string;
    talent?: string | null;
    subtitle?: string | null;
    fileName?: string;
  }): { ok: true; camId: string } | ObCommandError {
    return this.addInputCam('adopted', input);
  }

  private addInputCam(
    kind: 'file' | 'adopted',
    input: {
      role: ObCamRole;
      inputId: string;
      fileName?: string;
      width?: number;
      height?: number;
      name?: string;
      talent?: string | null;
      subtitle?: string | null;
    },
  ): { ok: true; camId: string } | ObCommandError {
    this.engage();
    const existing = this.cams.byInput(input.inputId);
    if (existing) return { ok: true, camId: existing.id };
    const fallbackName =
      input.fileName
        ?.split('/')
        .pop()
        ?.replace(/\.mp4$/i, '') ?? roleLabel(input.role);
    const cam = this.cams.create({
      kind,
      role: input.role,
      name: input.name?.trim() ? input.name : fallbackName,
      talent: input.talent ?? null,
      subtitle: input.subtitle ?? null,
      inputId: input.inputId,
      width: input.width ?? null,
      height: input.height ?? null,
      fileName: input.fileName ?? null,
      delayMs: this.deps.getSideChannelDelayMs?.(input.inputId) ?? 0,
    });
    if (!cam)
      return {
        ok: false,
        code: 'room_full',
        message: 'All camera seats are taken.',
      };
    cam.live = this.deps.isInputConnected(input.inputId);
    this.pushLog({
      source: 'system',
      kind: 'cam',
      tone: 'good',
      label: 'CAM',
      text: `CAM ${cam.number} · ${cam.name} · ${roleLabel(cam.role)} · ${kind}`,
      camId: cam.id,
    });
    this.afterCamsChanged();
    return { ok: true, camId: cam.id };
  }

  /** Inputs of the file cams (the clip sync / restart action). */
  fileCamInputIds(): { role: string; inputId: string }[] {
    return this.cams
      .list()
      .filter((c) => c.kind === 'file' && c.inputId != null)
      .map((c) => ({ role: c.role, inputId: c.inputId as string }));
  }

  /**
   * The file cams are about to restart (sync / loop resync). What the worker
   * has already heard of them — up to a side-channel delay ahead — will never
   * air, so their signals, the decisions scheduled from them and the brain's
   * memory go; their samples are ignored until each clip is back.
   */
  fileCamsResyncing(): void {
    if (this.disposed) return;
    this.cancelScheduled((c) => c.source !== 'operator');
    this.brain.reset();
    for (const cam of this.cams.list()) {
      if (cam.kind !== 'file') continue;
      this.signals.removeCam(cam.id);
      this.settleUntil.set(cam.id, Infinity);
    }
    this.markStateDirty();
  }

  /** One file cam's clip is registered again (or failed to be). */
  fileCamRestarted(inputId: string): void {
    const cam = this.cams.byInput(inputId);
    if (!cam) return;
    this.signals.removeCam(cam.id);
    this.settleUntil.set(cam.id, this.now() + FILE_CAM_SETTLE_MS);
  }

  private removeCam(cam: ObCamRecord, why: string): void {
    this.retireCamInput(cam);
    this.cams.remove(cam.id);
    this.signals.removeCam(cam.id);
    this.settleUntil.delete(cam.id);
    this.lastTally.delete(cam.id);
    if (this.preferCam?.camId === cam.id) this.preferCam = null;
    if (this.config.audio.mode === 'master' && this.config.audio.cam === cam.id)
      this.config.audio = { mode: 'follow' };
    this.pushLog({
      source: 'system',
      kind: 'cam',
      tone: 'amber',
      label: 'CAM',
      text: `CAM ${cam.number} · ${cam.name} ${why}`,
      camId: cam.id,
    });
    this.afterCamsChanged();
    this.maybeStop();
  }

  /** A camera lost its input: rebuild program / preview / pending without it. */
  private dropCamFromShots(camId: string): void {
    this.cancelScheduled((c) =>
      c.change.shot ? obShotCams(c.change.shot).includes(camId) : false,
    );
    if (this.prog.preview && obShotCams(this.prog.preview).includes(camId))
      this.prog = {
        ...this.prog,
        preview: this.shotWithout(this.prog.preview, camId),
      };
    if (this.prog.program && obShotCams(this.prog.program).includes(camId)) {
      const next = this.shotWithout(this.prog.program, camId);
      this.finishLiveTransition();
      if (next) {
        this.changeProgram(
          next,
          { type: 'cut', durationMs: 0 },
          'system',
          false,
        );
      } else {
        this.prog = {
          ...this.prog,
          program: null,
          sinceMs: this.now(),
          source: 'system',
        };
        this.shownShot = null;
      }
      this.pushLog({
        source: 'system',
        kind: 'cut',
        tone: 'amber',
        label: 'FALLBACK',
        text: describeShot(next, this.logCams()),
      });
    }
  }

  /** `shot` without `camId`; a single survivor becomes a solo; else the first live camera. */
  private shotWithout(shot: ObShot, camId: string): ObShot | null {
    const alive = (id: string) => {
      const c = this.cams.get(id);
      return id !== camId && c?.inputId != null;
    };
    const rest = obShotCams(shot).filter(alive);
    if (shot.kind === 'grid' && shot.cams.length === 0) {
      return this.liveCams().some((c) => c.id !== camId) ? shot : null;
    }
    if (rest.length >= 2 && (shot.kind === 'quad' || shot.kind === 'grid'))
      return { kind: shot.kind, cams: rest };
    if (rest.length >= 1 && shot.kind !== 'solo' && shot.kind !== 'virtual')
      return { kind: 'solo', cam: rest[0] };
    const first = this.liveCams().find((c) => c.id !== camId);
    return first ? { kind: 'solo', cam: first.id } : null;
  }

  private liveCams(): ObCamRecord[] {
    return this.cams.list().filter((c) => c.inputId != null && c.live);
  }

  private afterCamsChanged(): void {
    this.restage();
    this.applyAudio();
    this.pushTally();
    this.publishHud();
    this.markStateDirty();
  }

  onInputsRemoved(inputIds: string[]): void {
    if (this.disposed) return;
    const gone = new Set(inputIds);
    let changed = false;
    for (const cam of this.cams.list()) {
      if (cam.inputId == null || !gone.has(cam.inputId)) continue;
      changed = true;
      const inputId = cam.inputId;
      cam.inputId = null;
      cam.live = false;
      this.lastVolumes.delete(inputId);
      this.leaving.delete(inputId);
      this.dropCamFromShots(cam.id);
      // A file / adopted input never comes back: free the seat.
      if (cam.kind !== 'whip') {
        this.cams.remove(cam.id);
        this.signals.removeCam(cam.id);
      }
    }
    if (!changed) return;
    this.afterCamsChanged();
  }

  notifyRecordingChanged(): void {
    this.deps.broadcast({ type: 'ob_state', state: this.stateSnapshot() });
  }

  // ── Config / control ─────────────────────────────────────────────────

  setConfig(patch: ObConfigPatch): ObConfig {
    this.engage();
    const c = this.config;
    let rulesChanged = false;
    if (typeof patch.eventName === 'string')
      c.eventName =
        patch.eventName.trim().slice(0, OB_CONFIG_LIMITS.eventName.max) ||
        c.eventName;
    if (
      patch.presetId !== undefined &&
      (patch.presetId === 'custom' ||
        (OB_PRESET_IDS as readonly string[]).includes(patch.presetId)) &&
      patch.presetId !== c.presetId
    ) {
      c.presetId = patch.presetId;
      if (patch.ruleset === undefined && c.ruleset) {
        c.ruleset = null;
        this.pushLog({
          source: 'system',
          kind: 'ruleset',
          tone: 'amber',
          label: 'RULES',
          text: 'custom ruleset discarded (preset changed)',
        });
      }
      rulesChanged = true;
    }
    if (patch.ruleset === null) {
      c.ruleset = null;
      rulesChanged = true;
    } else if (patch.ruleset !== undefined) {
      const parsed = parseObRuleset(patch.ruleset, obPresetRuleset(c.presetId));
      if (parsed.ruleset) {
        c.ruleset = parsed.ruleset;
        rulesChanged = true;
      }
    }
    if (patch.pacingDial && patch.pacingDial in OB_PACING_DIAL_FACTOR)
      c.pacingDial = patch.pacingDial;
    if (typeof patch.autoPilot === 'boolean')
      this.setAutoPilot(patch.autoPilot, 'operator');
    if (
      typeof patch.resumeAfterMs === 'number' &&
      Number.isFinite(patch.resumeAfterMs)
    )
      c.resumeAfterMs = clamp(
        patch.resumeAfterMs,
        OB_CONFIG_LIMITS.resumeAfterMs,
      );
    if (patch.transition) {
      const t = this.mergeTransition(patch.transition);
      if (t) c.transition = t;
    }
    if (patch.audio) {
      const audio = parseAudioPolicy(patch.audio);
      if (audio && this.audioOk(audio)) c.audio = audio;
    }
    if (patch.effects) this.mergeEffects(patch.effects, true);
    if (
      typeof patch.lowerThirdMs === 'number' &&
      Number.isFinite(patch.lowerThirdMs)
    )
      c.lowerThirdMs = clamp(patch.lowerThirdMs, OB_CONFIG_LIMITS.lowerThirdMs);
    if (typeof patch.titleBugVisible === 'boolean')
      c.titleBugVisible = patch.titleBugVisible;
    if (typeof patch.brief === 'string')
      c.brief = patch.brief.slice(0, OB_CONFIG_LIMITS.brief.max);
    if (Array.isArray(patch.rundown)) {
      c.rundown = sanitizeRundown(patch.rundown);
      if (this.rundownIndex >= c.rundown.length)
        this.rundownIndex = c.rundown.length - 1;
      rulesChanged = true;
    }
    if (patch.llm) {
      if (
        typeof patch.llm.analystIntervalS === 'number' &&
        Number.isFinite(patch.llm.analystIntervalS)
      )
        c.llm.analystIntervalS = clamp(
          patch.llm.analystIntervalS,
          OB_CONFIG_LIMITS.analystIntervalS,
        );
      if (typeof patch.llm.analyst === 'boolean')
        c.llm.analyst = patch.llm.analyst;
      if (isObLlmModelId(patch.llm.model)) {
        c.llm.model = patch.llm.model;
        this.llm?.setModel(c.llm.model);
      }
      this.llm?.setAnalyst(c.llm.analyst, c.llm.analystIntervalS);
    }
    if (typeof patch.subtitles === 'boolean') c.subtitles = patch.subtitles;
    if (typeof patch.captions === 'boolean' && patch.captions !== c.captions) {
      c.captions = patch.captions;
      this.reconfigureCamSignals();
    }
    const url = patch.joinUrls?.cam;
    if (typeof url === 'string' && url && url !== this.joinUrl) {
      c.joinUrls = { ...c.joinUrls, cam: url };
      this.registerQr(url);
    }
    if (rulesChanged) this.refreshRuleset('config');
    this.afterProgramChange();
    return structuredClone(this.config);
  }

  private registerQr(url: string): void {
    this.joinUrl = url;
    this.qrImageId = null;
    void this.deps
      .registerJoinQr(url)
      .then((imageId) => {
        if (this.disposed || this.joinUrl !== url) return;
        this.qrImageId = imageId;
        this.publishHud();
      })
      .catch((err) => console.error('[ob] join QR registration failed', err));
  }

  /** Captions toggled: every camera needs the other side-channel delay. */
  private reconfigureCamSignals(): void {
    const configure = this.deps.configureCamSignals;
    let phones = 0;
    for (const cam of this.cams.list()) {
      if (!cam.inputId) continue;
      if (cam.kind === 'whip') {
        phones++;
        continue;
      }
      const inputId = cam.inputId;
      const opts = this.camSignalOpts(cam.role);
      cam.delayMs = opts.delayMs;
      configure?.(inputId, opts).catch((err) =>
        console.warn(`[ob] signal reconfigure failed for ${inputId}`, err),
      );
    }
    this.pushLog({
      source: 'operator',
      kind: 'note',
      tone: phones ? 'amber' : 'chalk',
      label: 'CAPTIONS',
      text: `${this.config.captions ? 'on · 8 s delay' : 'off · 3 s delay'}${phones ? ` · ${phones} phone(s) must re-publish` : ''}`,
    });
  }

  /** The ruleset in force: the segment's preset, else config.ruleset, else the preset's. */
  private effectiveRuleset(): ObRuleset {
    const item = this.config.rundown[this.rundownIndex];
    if (item?.preset) return obPresetRuleset(item.preset);
    return this.config.ruleset ?? obPresetRuleset(this.config.presetId);
  }

  private refreshRuleset(why: string): void {
    const next = this.effectiveRuleset();
    if (JSON.stringify(next) === JSON.stringify(this.ruleset)) return;
    this.ruleset = next;
    this.brain.setRuleset(next);
    this.signals.setKeywordGroups(next.keywords);
    this.pushLog({
      source: 'system',
      kind: 'ruleset',
      tone: 'ai',
      label: 'RULES',
      text: `${next.name} · ${next.rules.length} rules · ${why}`,
    });
  }

  /** Parse, normalise and install a ruleset (REST / editor RAW JSON). */
  setRuleset(
    raw: unknown,
  ): { ruleset: ObRuleset; warnings: string[] } | { errors: string[] } {
    this.engage();
    const parsed = parseObRuleset(raw, obPresetRuleset(this.config.presetId));
    if (!parsed.ruleset) return { errors: parsed.errors };
    this.config.ruleset = parsed.ruleset;
    this.refreshRuleset('applied');
    if (parsed.warnings.length) {
      // The panel truncates warnings; the WHY log and the server log keep
      // the full list of what was repaired or dropped.
      this.pushLog({
        source: 'system',
        kind: 'ruleset',
        tone: 'amber',
        label: 'RULES',
        text: `applied with ${parsed.warnings.length} warning(s)`,
        reasons: parsed.warnings,
      });
      console.warn('[ob] ruleset warnings', parsed.warnings);
    }
    this.markStateDirty();
    return {
      ruleset: structuredClone(parsed.ruleset),
      warnings: parsed.warnings,
    };
  }

  control(action: ObControlAction, camId?: string): ObCommandResult {
    this.engage();
    const now = this.now();
    switch (action) {
      case 'setup':
        if (this.phase === 'on-air')
          return {
            ok: false,
            code: 'bad_phase',
            message: 'Wrap the show first.',
          };
        this.setPhase('setup');
        break;
      case 'go_live':
        if (this.phase === 'wrap')
          return {
            ok: false,
            code: 'bad_phase',
            message: 'Reset before going live again.',
          };
        if (this.phase === 'on-air') break;
        this.stats = emptyStats();
        this.stats.startedAtMs = now;
        this.brain.reset();
        this.history = [];
        this.wrapNotes = null;
        if (!this.prog.program) {
          const first = this.liveCams()[0];
          if (first)
            this.changeProgram(
              { kind: 'solo', cam: first.id },
              { type: 'cut', durationMs: 0 },
              'system',
              false,
            );
        }
        this.prog = { ...this.prog, sinceMs: now };
        this.setPhase('on-air');
        break;
      case 'wrap':
        if (this.phase !== 'on-air')
          return { ok: false, code: 'bad_phase', message: 'Not on air.' };
        this.accountHold(now);
        this.stats.endedAtMs = now;
        this.cancelScheduled(() => true);
        this.lowerThird = null;
        this.setPhase('wrap');
        break;
      case 'reset':
        this.cancelScheduled(() => true);
        this.stats = emptyStats();
        this.lowerThird = null;
        this.rundownIndex = -1;
        this.titleSegment = null;
        this.autoPausedUntil = null;
        this.holdUntil = null;
        this.pacingOverride = null;
        this.preferCam = null;
        this.wrapNotes = null;
        this.closeReplay();
        this.refreshRuleset('reset');
        this.log.clear();
        this.deps.broadcast({ type: 'ob_log', entries: [], reset: true });
        this.setPhase('setup');
        break;
      case 'kick_cam': {
        const cam = camId ? this.cams.get(camId) : undefined;
        if (!cam)
          return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
        if (cam.clientId)
          this.sendError(
            cam.clientId,
            'bad_action',
            'The host removed this camera.',
          );
        this.removeCam(cam, 'kicked');
        break;
      }
    }
    this.afterProgramChange();
    return { ok: true };
  }

  private setPhase(phase: ObPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.llm?.setPhase(phase);
    this.pushLog({
      source: 'operator',
      kind: 'phase',
      tone: phase === 'on-air' ? 'bad' : 'chalk',
      label: phase === 'on-air' ? 'ON AIR' : phase.toUpperCase(),
      text: this.config.eventName,
    });
  }

  // ── The one command switch (panel WS, host REST, keyboard, LLM) ────────

  operate(
    cmd: ObOperatorCommand,
    source: ObActionSource = 'operator',
    reasons?: string[],
  ): ObCommandResult {
    this.engage();
    const r = this.runCommand(cmd, source, reasons);
    this.afterProgramChange();
    return r;
  }

  private runCommand(
    cmd: ObOperatorCommand,
    source: ObActionSource,
    reasons?: string[],
  ): ObCommandResult {
    const rs = reasons ? { reasons } : {};
    switch (cmd.op) {
      case 'preview': {
        const err = this.validateShot(cmd.shot, false);
        if (err) return err;
        this.prog = { ...this.prog, preview: cmd.shot };
        this.pushLog({
          source,
          kind: 'preview',
          tone: 'good',
          label: 'PVW',
          text: describeShot(cmd.shot, this.logCams()),
          ...rs,
        });
        return { ok: true };
      }
      case 'take':
      case 'cut': {
        const shot = this.prog.preview;
        if (!shot)
          return {
            ok: false,
            code: 'bad_action',
            message: 'Nothing on preview.',
          };
        const transition =
          cmd.op === 'cut'
            ? { type: 'cut' as const, durationMs: 0 }
            : cmd.transition
              ? this.mergeTransition(cmd.transition)
              : this.config.transition;
        if (!transition)
          return {
            ok: false,
            code: 'invalid_transition',
            message: 'Unknown transition.',
          };
        return this.applyDecision(
          { shot, transition, swapPreview: true, logKind: cmd.op, ...rs },
          source,
        );
      }
      case 'shot': {
        if (cmd.mode === 'preview')
          return this.runCommand(
            { op: 'preview', shot: cmd.shot },
            source,
            reasons,
          );
        const transition =
          cmd.mode === 'cut'
            ? { type: 'cut' as const, durationMs: 0 }
            : this.config.transition;
        return this.applyDecision(
          { shot: cmd.shot, transition, logKind: cmd.mode, ...rs },
          source,
        );
      }
      case 'transition': {
        const t = this.mergeTransition(cmd.transition);
        if (!t)
          return {
            ok: false,
            code: 'invalid_transition',
            message: 'Unknown transition.',
          };
        this.config.transition = t;
        this.pushLog({
          source,
          kind: 'transition',
          tone: 'chalk',
          label: 'TRANS',
          text: describeTransition(t),
          ...rs,
        });
        return { ok: true };
      }
      case 'fx':
        if (cmd.effects.grade !== undefined && !isGrade(cmd.effects.grade))
          return { ok: false, code: 'bad_action', message: 'Unknown grade.' };
        return this.applyDecision({ effects: cmd.effects, ...rs }, source);
      case 'lower_third':
        return this.lowerThirdCommand(cmd, source, reasons);
      case 'title_bug': {
        if (typeof cmd.event === 'string' && cmd.event.trim())
          this.config.eventName = cmd.event
            .trim()
            .slice(0, OB_CONFIG_LIMITS.eventName.max);
        if (cmd.segment !== undefined)
          this.titleSegment = cmd.segment?.trim().slice(0, 60) || null;
        if (typeof cmd.visible === 'boolean')
          this.config.titleBugVisible = cmd.visible;
        this.pushLog({
          source,
          kind: 'title',
          tone: 'chalk',
          label: 'TITLE',
          text: this.config.titleBugVisible
            ? `${this.config.eventName}${this.titleSegment ? ` · ${this.titleSegment}` : ''}`
            : 'hidden',
          ...rs,
        });
        return { ok: true };
      }
      case 'audio': {
        if (!this.audioOk(cmd.audio))
          return {
            ok: false,
            code: 'unknown_cam',
            message: 'Master camera not found.',
          };
        this.config.audio = cmd.audio;
        this.pushLog({
          source,
          kind: 'audio',
          tone: 'chalk',
          label: 'AUDIO',
          text:
            cmd.audio.mode === 'master'
              ? `master · ${camLabel(cmd.audio.cam, this.logCams())}`
              : cmd.audio.mode,
          ...rs,
        });
        return { ok: true };
      }
      case 'auto':
        this.setAutoPilot(cmd.enabled, source);
        return { ok: true };
      case 'dip': {
        const dip = standaloneDip(this.now(), cmd.holdMs);
        this.prog = { ...this.prog, dip };
        this.armTransitionTimer(dipEndsAt(dip) - this.now(), () =>
          this.settleNow(),
        );
        this.pushLog({
          source,
          kind: 'transition',
          tone: 'chalk',
          label: 'DIP',
          text: `to black · hold ${dip.holdMs} ms`,
          ...rs,
        });
        return { ok: true };
      }
      case 'segment':
        return this.segmentCommand(cmd, source);
      case 'replay': {
        const camId = cmd.camId ?? this.defaultReplayCam();
        if (!camId)
          return {
            ok: false,
            code: 'no_file_cam',
            message: 'Replay needs a file camera.',
          };
        return this.startReplay(camId, source, cmd.mediaMs);
      }
      case 'cam':
        return this.camCommand(cmd, source);
      case 'pacing': {
        if (cmd.clear) this.pacingOverride = null;
        else {
          const p: NonNullable<typeof this.pacingOverride> = {
            ...this.pacingOverride,
          };
          if (cmd.minHoldMs !== undefined)
            p.minHoldMs = clamp(cmd.minHoldMs, OB_RULESET_LIMITS.minHoldMs);
          if (cmd.maxHoldMs !== undefined)
            p.maxHoldMs = clamp(cmd.maxHoldMs, OB_RULESET_LIMITS.maxHoldMs);
          if (source === 'llm') p.untilMs = this.now() + OB_LLM_PACING_TTL_MS;
          else delete p.untilMs;
          this.pacingOverride = p;
        }
        this.pushLog({
          source,
          kind: 'pacing',
          tone: source === 'llm' ? 'ai' : 'chalk',
          label: 'PACING',
          text: this.pacingOverride
            ? `hold ${this.pacingOverride.minHoldMs ?? '–'} / ${this.pacingOverride.maxHoldMs ?? '–'} ms` +
              (this.pacingOverride.untilMs
                ? ` · ${Math.round(OB_LLM_PACING_TTL_MS / 1000)}s`
                : '')
            : 'ruleset pacing',
          ...rs,
        });
        return { ok: true };
      }
      case 'prefer_cam': {
        const cam = this.cams.get(cmd.camId);
        if (!cam)
          return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
        const forMs = clamp(cmd.forMs, { min: 1000, max: 120_000 });
        const boostCap = source === 'llm' ? OB_LLM_PREFER_BOOST_MAX : 3;
        const boostDefault = source === 'llm' ? OB_LLM_PREFER_BOOST_MAX : 1;
        this.preferCam = {
          camId: cam.id,
          untilMs: this.now() + forMs,
          boost: Math.min(boostCap, Math.max(0, cmd.boost ?? boostDefault)),
        };
        this.pushLog({
          source,
          kind: 'auto',
          tone: 'ai',
          label: 'PREFER',
          text: `${camLabel(cam.id, this.logCams())} · ${Math.round(forMs / 1000)} s`,
          camId: cam.id,
          ...rs,
        });
        return { ok: true };
      }
      case 'note':
        this.pushLog({
          source,
          kind: 'note',
          tone: source === 'llm' ? 'ai' : 'chalk',
          label: 'NOTE',
          text: cmd.text.slice(0, 240),
          ...rs,
        });
        return { ok: true };
    }
  }

  private lowerThirdCommand(
    cmd: Extract<ObOperatorCommand, { op: 'lower_third' }>,
    source: ObActionSource,
    reasons?: string[],
  ): ObCommandResult {
    if (cmd.clear) {
      this.lowerThird = null;
      this.pushLog({
        source,
        kind: 'lower_third',
        tone: 'dim',
        label: 'L3',
        text: 'cleared',
        ...(reasons ? { reasons } : {}),
      });
      return { ok: true };
    }
    const cam = cmd.camId ? this.cams.get(cmd.camId) : undefined;
    if (cmd.camId && !cam)
      return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
    const name = (cmd.name?.trim() || cam?.talent || cam?.name || '').slice(
      0,
      60,
    );
    if (!name)
      return {
        ok: false,
        code: 'bad_action',
        message: 'A lower third needs a name.',
      };
    const durationMs =
      cmd.ms === null
        ? null
        : clamp(
            cmd.ms ?? this.config.lowerThirdMs,
            OB_CONFIG_LIMITS.lowerThirdMs,
          );
    const subtitle =
      cmd.subtitle !== undefined
        ? cmd.subtitle?.trim().slice(0, 80) || null
        : cam
          ? (cam.subtitle ?? roleLabel(cam.role))
          : null;
    this.showLowerThird({ name, subtitle, durationMs }, cam?.id ?? null);
    this.pushLog({
      source,
      kind: 'lower_third',
      tone: source === 'llm' ? 'ai' : 'chalk',
      label: 'L3',
      text: `${name}${subtitle ? ` · ${subtitle}` : ''}`,
      ...(cam ? { camId: cam.id } : {}),
      ...(reasons ? { reasons } : {}),
    });
    return { ok: true };
  }

  private showLowerThird(
    lt: { name: string; subtitle: string | null; durationMs: number | null },
    camId: string | null,
  ): void {
    const now = this.now();
    this.lowerThird = {
      ...lt,
      camId,
      startedAtMs: now,
      untilMs: lt.durationMs == null ? null : now + lt.durationMs,
    };
  }

  private segmentCommand(
    cmd: Extract<ObOperatorCommand, { op: 'segment' }>,
    source: ObActionSource,
  ): ObCommandResult {
    const items = this.config.rundown;
    if (items.length === 0)
      return {
        ok: false,
        code: 'bad_action',
        message: 'The rundown is empty.',
      };
    let index = this.rundownIndex;
    if (cmd.action === 'next') index = Math.min(items.length - 1, index + 1);
    else if (cmd.action === 'prev') index = Math.max(0, index - 1);
    else {
      if (
        cmd.index == null ||
        cmd.index < 0 ||
        cmd.index >= items.length ||
        !Number.isInteger(cmd.index)
      )
        return { ok: false, code: 'bad_action', message: 'No such segment.' };
      index = cmd.index;
    }
    this.rundownIndex = index;
    const item = items[index];
    this.titleSegment = item.title;
    this.pushLog({
      source,
      kind: 'segment',
      tone: source === 'llm' ? 'ai' : 'chalk',
      label: `SEG ${index + 1}/${items.length}`,
      text: `${item.title}${item.preset ? ` · ${item.preset.toUpperCase()} rules` : ''}`,
    });
    this.refreshRuleset(`segment ${index + 1}`);
    return { ok: true };
  }

  private camCommand(
    cmd: Extract<ObOperatorCommand, { op: 'cam' }>,
    source: ObActionSource,
  ): ObCommandResult {
    const cam = this.cams.get(cmd.camId);
    if (!cam)
      return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
    switch (cmd.action) {
      case 'role':
        if (!isObCamRole(cmd.value))
          return { ok: false, code: 'bad_action', message: 'Unknown role.' };
        cam.role = cmd.value;
        break;
      case 'name':
        cam.name = cleanName(cmd.value ?? '', cam.name);
        break;
      case 'talent':
        cam.talent = cleanTalent(cmd.value ?? null);
        break;
      case 'subtitle':
        cam.subtitle = cleanTalent(cmd.value ?? null);
        break;
      case 'kick':
        if (cam.clientId)
          this.sendError(
            cam.clientId,
            'bad_action',
            'The operator removed this camera.',
          );
        this.removeCam(cam, 'kicked');
        return { ok: true };
    }
    this.pushLog({
      source,
      kind: 'cam',
      tone: 'chalk',
      label: `CAM ${cam.number}`,
      text: `${cmd.action} · ${cmd.value ?? ''}`,
      camId: cam.id,
    });
    return { ok: true };
  }

  private setAutoPilot(enabled: boolean, source: ObActionSource): void {
    if (this.config.autoPilot === enabled) return;
    this.config.autoPilot = enabled;
    this.autoPausedUntil = null;
    if (!enabled) this.cancelScheduled((c) => c.source === 'auto');
    this.pushLog({
      source,
      kind: 'auto',
      tone: enabled ? 'ai' : 'dim',
      label: 'AUTO',
      text: enabled ? `on · ${this.ruleset.name}` : 'off',
    });
  }

  private audioOk(audio: ObAudioPolicy): boolean {
    return audio.mode !== 'master' || this.cams.get(audio.cam) != null;
  }

  /** `patch` over the configured TAKE transition, validated and clamped. */
  private mergeTransition(patch: Partial<ObTransition>): ObTransition | null {
    const type = patch.type ?? this.config.transition.type;
    if (!isTransitionType(type)) return null;
    const out: ObTransition = {
      type,
      durationMs: clamp(
        patch.durationMs ?? this.config.transition.durationMs,
        OB_TRANSITION_LIMITS.durationMs,
      ),
    };
    const hold = patch.holdMs ?? this.config.transition.holdMs;
    if (hold !== undefined)
      out.holdMs = clamp(hold, OB_TRANSITION_LIMITS.holdMs);
    return out;
  }

  private mergeEffects(patch: Partial<ObEffects>, alsoConfig: boolean): void {
    const next = { ...this.effects };
    if (patch.grade !== undefined && isGrade(patch.grade))
      next.grade = patch.grade;
    if (typeof patch.spotlight === 'boolean') next.spotlight = patch.spotlight;
    if (typeof patch.softBackground === 'boolean')
      next.softBackground = patch.softBackground;
    this.effects = next;
    if (alsoConfig) this.config.effects = { ...next };
    this.restage();
  }

  /** Structural + roster check of a shot (`requireLive` for program changes). */
  private validateShot(
    shot: ObShot,
    requireLive: boolean,
  ): ObCommandError | null {
    const bad = (message: string): ObCommandError => ({
      ok: false,
      code: 'invalid_shot',
      message,
    });
    switch (shot.kind) {
      case 'split':
        if (shot.cams[0] === shot.cams[1])
          return bad('A split needs two cameras.');
        break;
      case 'pip':
        if (shot.main === shot.inset) return bad('PiP needs two cameras.');
        break;
      case 'speaker-slides':
        if (shot.speaker === shot.slides)
          return bad('Speaker and slides must differ.');
        break;
      case 'quad':
        if (shot.cams.length < 1 || shot.cams.length > 4)
          return bad('A quad takes 1–4 cameras.');
        break;
      case 'grid':
        if (
          shot.cams.length === 0 &&
          requireLive &&
          this.liveCams().length === 0
        )
          return {
            ok: false,
            code: 'cam_not_live',
            message: 'No live camera.',
          };
        break;
      default:
        break;
    }
    for (const id of obShotCams(shot)) {
      const cam = this.cams.get(id);
      if (!cam)
        return { ok: false, code: 'unknown_cam', message: `No camera ${id}.` };
      if (requireLive && (!cam.inputId || !cam.live))
        return {
          ok: false,
          code: 'cam_not_live',
          message: `CAM ${cam.number} is not live.`,
        };
    }
    return null;
  }

  // ── The one program path ────────────────────────────────────────────

  /**
   * Apply a change from any source. Operator program changes pause the auto
   * pilot for `resumeAfterMs` and drop pending auto / LLM cuts.
   */
  applyDecision(change: ObChange, source: ObActionSource): ObCommandResult {
    this.engage();
    const now = this.now();
    if (change.shot) {
      const err = this.validateShot(change.shot, true);
      if (err) {
        if (source !== 'operator')
          this.pushLog({
            source,
            kind: 'error',
            tone: 'bad',
            label: 'SKIP',
            text: err.message,
          });
        return err;
      }
    }
    if (source === 'operator' && change.shot) this.pauseAuto(now);
    const reasons = change.reasons ? { reasons: change.reasons } : {};
    if (change.shot) {
      const same =
        obShotsEqual(change.shot, this.prog.program) && !this.prog.transition;
      if (!same) {
        const transition = change.transition ?? this.defaultTransition(source);
        this.changeProgram(
          change.shot,
          transition,
          source,
          change.swapPreview ?? false,
        );
        this.pushLog({
          source,
          kind: change.logKind ?? (source === 'auto' ? 'auto' : 'take'),
          tone:
            source === 'operator'
              ? 'bad'
              : source === 'system'
                ? 'amber'
                : 'ai',
          label:
            source === 'operator'
              ? (change.logKind ?? 'take').toUpperCase()
              : source.toUpperCase(),
          text: `${describeShot(change.shot, this.logCams())} · ${describeTransition(transition)}${change.reason ? ` · ${change.reason}` : ''}`,
          camId: primaryCam(change.shot) || undefined,
          ...reasons,
        });
      }
    }
    if (change.effects) {
      this.mergeEffects(change.effects, false);
      this.pushLog({
        source,
        kind: 'fx',
        tone: source === 'operator' ? 'chalk' : 'ai',
        label: 'FX',
        text: Object.entries(change.effects)
          .map(([k, v]) => `${k} ${String(v)}`)
          .join(' · '),
        ...reasons,
      });
    }
    if (change.lowerThird) {
      const cam = this.cams.get(change.lowerThird.camId);
      if (change.lowerThird.mode === 'off') this.lowerThird = null;
      else if (cam && (cam.talent || cam.name)) {
        this.showLowerThird(
          {
            name: cam.talent ?? cam.name,
            subtitle: cam.subtitle ?? roleLabel(cam.role),
            durationMs: change.lowerThird.holdMs ?? this.config.lowerThirdMs,
          },
          cam.id,
        );
        this.pushLog({
          source,
          kind: 'lower_third',
          tone: 'ai',
          label: 'L3',
          text: `${cam.talent ?? cam.name} · ${cam.subtitle ?? roleLabel(cam.role)}`,
          camId: cam.id,
          ...reasons,
        });
      }
    }
    // Rule pacing patches live in the brain; the decision only reports them.
    if (change.pacing)
      this.pushLog({
        source,
        kind: 'pacing',
        tone: 'ai',
        label: 'PACING',
        text: Object.entries(change.pacing)
          .map(([k, v]) => `${k} ${String(v)}`)
          .join(' · '),
        ...reasons,
      });
    if (change.replay) this.startReplay(change.replay.camId, source);
    if ((change.shot || change.replay) && change.holdMs && change.holdMs > 0)
      this.holdUntil = now + change.holdMs;
    if (source === 'auto' || source === 'llm') this.lastDecisionAt = now;
    return { ok: true };
  }

  private defaultTransition(source: ObActionSource): ObTransition {
    if (source === 'auto' || source === 'llm') {
      const p = this.ruleset.pacing;
      return {
        type: p.transition,
        durationMs: p.transitionMs ?? this.config.transition.durationMs,
      };
    }
    return this.config.transition;
  }

  private pauseAuto(now: number): void {
    this.cancelScheduled((c) => c.source === 'auto' || c.source === 'llm');
    if (!this.config.autoPilot || this.config.resumeAfterMs <= 0) return;
    this.autoPausedUntil = now + this.config.resumeAfterMs;
    this.pushLog({
      source: 'operator',
      kind: 'auto',
      tone: 'amber',
      label: 'AUTO',
      text: `paused ${Math.round(this.config.resumeAfterMs / 1000)} s`,
    });
  }

  /** Put `shot` on program (the stage choreography of the transition). */
  private changeProgram(
    shot: ObShot,
    transition: ObTransition,
    source: ObActionSource,
    swapPreview: boolean,
  ): void {
    const now = this.now();
    this.finishLiveTransition();
    this.accountHold(now, source);
    const { state, live } = begin(this.prog, shot, transition, now, {
      source,
      swapPreview,
    });
    this.prog = state;
    this.history.push({ shot, atAirMs: now });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    if (live?.cutAtMs != null) {
      // fade / dip: the old picture stays until the black is full.
      const cutAt = live.cutAtMs;
      this.armTransitionTimer(cutAt - now, () => this.cutUnderDip(live));
    } else {
      this.showShot(shot, live);
    }
    if (live)
      this.armTransitionTimer(live.settleAtMs - now, () => this.settleNow());
    if (this.prog.dip)
      this.armTransitionTimer(dipEndsAt(this.prog.dip) - now, () =>
        this.settleNow(),
      );
  }

  /** Switch the stage to `shot` with the choreography of `live` (null = cut). */
  private showShot(shot: ObShot | null, live: ObLiveTransition | null): void {
    const now = this.now();
    this.shownShot = shot;
    if (shot?.kind === 'virtual') this.stepVirtual(now, true);
    const to = this.stageFor(shot);
    const type = live && live.cutAtMs == null ? live.type : 'cut';
    const plan = transitionPlan(
      this.lastTiles,
      to,
      type,
      type === 'cut' ? 0 : (live?.durationMs ?? 0),
      this.fadingSet(now),
    );
    this.executePlan(plan, to, live?.settleAtMs ?? now);
  }

  private cutUnderDip(live: ObLiveTransition): void {
    if (this.disposed || this.prog.transition !== live) return;
    this.showShot(live.to, null);
    this.afterProgramChange();
  }

  private executePlan(
    plan: ObTransitionPlan,
    to: ObStage,
    settleAtMs: number,
  ): void {
    const now = this.now();
    for (const t of plan.transitions) {
      this.deps.runInputTransition(t.inputId, {
        type: t.type,
        durationMs: t.durationMs,
        direction: t.direction,
      });
      if (t.direction === 'out')
        this.fadingUntil.set(t.inputId, now + t.durationMs);
      else this.fadingUntil.delete(t.inputId);
    }
    for (const id of plan.leaving) this.leaving.set(id, settleAtMs);
    this.lastStage = to;
    this.armParkTimer();
    void this.pushLayout(plan.tiles);
    const followUp = plan.followUp;
    if (followUp)
      this.armTransitionTimer(
        PUNCH_STEP_MS,
        () => void this.pushLayout(followUp),
      );
  }

  private fadingSet(now: number): Set<string> {
    const out = new Set<string>();
    for (const [id, until] of this.fadingUntil) {
      if (until > now) out.add(id);
      else this.fadingUntil.delete(id);
    }
    return out;
  }

  /** A transition in flight ends now: its pending cut lands, leaving tiles park. */
  private finishLiveTransition(): void {
    const live = this.prog.transition;
    for (const t of this.transitionTimers) clearTimeout(t);
    this.transitionTimers.clear();
    if (!live) return;
    if (live.cutAtMs != null && this.shownShot !== live.to)
      this.showShot(live.to, null);
    this.prog = finishTransition(this.prog);
    if (this.leaving.size > 0) this.commitParks(true);
  }

  private settleNow(): void {
    if (this.disposed) return;
    const before = this.prog;
    this.prog = settle(this.prog, this.now());
    if (before === this.prog) return;
    this.afterProgramChange();
  }

  private armTransitionTimer(ms: number, fn: () => void): void {
    const timer = setTimeout(
      () => {
        this.transitionTimers.delete(timer);
        if (!this.disposed) fn();
      },
      Math.max(0, ms),
    );
    this.transitionTimers.add(timer);
  }

  private armParkTimer(): void {
    if (this.parkTimer) {
      clearTimeout(this.parkTimer);
      this.parkTimer = null;
    }
    if (this.leaving.size === 0) return;
    const at = Math.min(...this.leaving.values()) - PARK_LEAD_MS;
    this.parkTimer = setTimeout(
      () => {
        this.parkTimer = null;
        this.commitParks(false);
      },
      Math.max(0, at - this.now()),
    );
  }

  /** Park the leaving tiles whose fade is (nearly) over (`all` = every one). */
  private commitParks(all: boolean): void {
    if (this.disposed || !this.lastStage) return;
    const now = this.now();
    let parked = false;
    for (const [id, until] of this.leaving) {
      if (all || until - PARK_LEAD_MS <= now) {
        this.leaving.delete(id);
        parked = true;
      }
    }
    if (!parked) {
      this.armParkTimer();
      return;
    }
    const remaining = new Map(
      this.lastTiles.map((t) => [t.inputId, t] as const),
    );
    // The target layout, with the tiles still leaving kept on top at their rect.
    const tiles = this.withLeaving(
      this.lastStage.tiles.map((t) => ({ ...t, transitionDurationMs: 0 })),
      remaining,
    );
    this.armParkTimer();
    void this.pushLayout(tiles);
  }

  /** Target tiles + the still-leaving ones (at their on-screen rect, drawn last). */
  private withLeaving(
    target: ObStageTile[],
    onScreen: Map<string, ObStageTile>,
  ): ObStageTile[] {
    if (this.leaving.size === 0) return target;
    const top: ObStageTile[] = [];
    const rest: ObStageTile[] = [];
    for (const t of target) {
      const cur = onScreen.get(t.inputId);
      if (this.leaving.has(t.inputId) && cur) {
        top.push({
          inputId: t.inputId,
          x: cur.x,
          y: cur.y,
          width: cur.width,
          height: cur.height,
          transitionDurationMs: 0,
        });
      } else rest.push(t);
    }
    const visible = rest.filter((t) => t.width > 1);
    const parked = rest.filter((t) => t.width <= 1);
    return [...visible, ...top, ...parked];
  }

  /** Re-lay the current shot (cameras / looks changed; no program change). */
  private restage(): void {
    if (this.disposed || !this.engaged) return;
    const now = this.now();
    const stage = this.stageFor(this.shownShot);
    this.lastStage = stage;
    const onScreen = new Map(
      this.lastTiles.map((t) => [t.inputId, t] as const),
    );
    const plan = transitionPlan(
      this.lastTiles,
      stage,
      'cut',
      0,
      this.fadingSet(now),
    );
    for (const t of plan.transitions)
      this.deps.runInputTransition(t.inputId, {
        type: t.type,
        durationMs: t.durationMs,
        direction: t.direction,
      });
    void this.pushLayout(this.withLeaving(plan.tiles, onScreen));
  }

  private async pushLayout(tiles: ObStageTile[]): Promise<void> {
    if (this.disposed) return;
    this.lastTiles = tiles.map((t) => ({ ...t }));
    try {
      await this.deps.layoutTiles(tiles);
    } catch (err) {
      console.error('[ob] layoutTiles failed', err);
    }
  }

  private sceneCams(): ObSceneCam[] {
    return this.cams.list().map((c) => ({
      id: c.id,
      inputId: c.inputId,
      width: c.width,
      height: c.height,
      live: c.live,
    }));
  }

  private stageFor(shot: ObShot | null): ObStage {
    const crop =
      shot?.kind === 'virtual' ? this.virtualCam.current(shot.cam) : null;
    return buildStage(
      shot,
      this.sceneCams(),
      this.deps.getResolution(),
      this.effects,
      crop,
    );
  }

  // ── Virtual camera ──────────────────────────────────────────────────

  /** One spring step of the virtual shot on stage; `force` = a fresh shot (no glide). */
  private stepVirtual(now: number, force = false): void {
    const shot = this.shownShot;
    if (!shot || shot.kind !== 'virtual') return;
    const cam = this.cams.get(shot.cam);
    if (!cam?.inputId || !cam.width || !cam.height) return;
    const res = this.deps.getResolution();
    const target = shot.target ?? 'speaker';
    const crop = this.virtualCam.step({
      camId: cam.id,
      cam: { width: cam.width, height: cam.height },
      aspect: res.width / Math.max(1, res.height),
      zoom: shot.zoom ?? 'normal',
      target,
      box: this.factories.attention(this.signals.view()[cam.id], target),
      now,
      force,
    });
    if (!crop || force || this.prog.transition || this.leaving.size > 0) return;
    void this.applyVirtualTile(cam.inputId);
  }

  /** Move the virtual shot's tile only, one linear glide per tick. */
  private async applyVirtualTile(inputId: string): Promise<void> {
    if (this.virtualApplying || this.disposed) return;
    const stage = this.stageFor(this.shownShot);
    const tile = stage.tiles.find((t) => t.inputId === inputId);
    if (
      !tile ||
      !this.lastTiles.some((t) => t.inputId === inputId && t.width > 1)
    )
      return;
    this.lastStage = stage;
    const tiles = this.lastTiles.map((t) =>
      t.inputId === inputId
        ? {
            inputId,
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height,
            transitionDurationMs: OB_VIRTUAL_GLIDE_MS,
          }
        : { ...t, transitionDurationMs: 0 },
    );
    this.virtualApplying = true;
    try {
      await this.pushLayout(tiles);
    } finally {
      this.virtualApplying = false;
    }
  }

  // ── Auto pilot ──────────────────────────────────────────────────────

  private autoStep(now: number): void {
    if (!this.config.autoPilot || this.phase !== 'on-air') return;
    if (this.autoPausedUntil != null) {
      if (now < this.autoPausedUntil) return;
      this.autoPausedUntil = null;
      this.pushLog({
        source: 'auto',
        kind: 'auto',
        tone: 'ai',
        label: 'AUTO',
        text: 'resumed',
      });
      this.markStateDirty();
    }
    // Stepped every tick, a cut pending or not: the brain keeps its speech
    // turns and rule timers current and plans after the last scheduled shot
    // (brainContext). It only holds off while a transition runs.
    const decision = this.brain.step(this.brainContext());
    if (!decision) return;
    this.lastDecisionAt = now;
    this.schedule(decision, 'auto');
  }

  /** The last scheduled shot change: the program the brain plans after. */
  private plannedShot(): ScheduledChange | null {
    let last: ScheduledChange | null = null;
    for (const c of this.scheduled.values())
      if (c.change.shot && (!last || c.applyAtMs > last.applyAtMs)) last = c;
    return last;
  }

  private brainContext(): ObBrainContext {
    const factor = OB_PACING_DIAL_FACTOR[this.config.pacingDial];
    const overrides: ObBrainContext['overrides'] = {};
    if (this.preferCam)
      overrides.preferCam = {
        camId: this.preferCam.camId,
        untilAirMs: this.preferCam.untilMs,
        boost: this.preferCam.boost,
      };
    if (this.pacingOverride)
      overrides.pacing = {
        minHoldMs: this.pacingOverride.minHoldMs,
        maxHoldMs: this.pacingOverride.maxHoldMs,
      };
    const plan = this.plannedShot();
    const planHoldUntil = plan?.change.holdMs
      ? plan.applyAtMs + plan.change.holdMs
      : null;
    return {
      nowAir: this.clock.nowAir(),
      lookaheadMs: this.clock.lookaheadMs(),
      cams: this.cams.list().map((c) => ({
        camId: c.id,
        number: c.number,
        role: c.role,
        name: c.name,
        talent: c.talent,
        live: c.live && c.inputId != null,
      })),
      signals: this.signals.view(),
      program: {
        shot: plan?.change.shot ?? this.prog.program,
        sinceAirMs: plan?.applyAtMs ?? this.prog.sinceMs,
        history: this.history.map((h) => ({ ...h })),
        pending: this.prog.transition !== null,
        manualUntilAirMs: this.autoPausedUntil,
        holdUntilAirMs:
          planHoldUntil !== null &&
          planHoldUntil > (this.holdUntil ?? -Infinity)
            ? planHoldUntil
            : this.holdUntil,
      },
      ruleset: this.ruleset,
      segment: this.segment(),
      pacingFactor: factor,
      overrides,
    };
  }

  /** Queue a decision for its air time (auto / LLM). */
  schedule(decision: ObDecision, source: ObActionSource): boolean {
    const now = this.now();
    const at = scheduleAt(decision.atAirMs, now, this.prog.lastApplyAtMs);
    if (!at) {
      this.pushLog({
        source,
        kind: 'late',
        tone: 'amber',
        label: 'LATE',
        text: `skipped · ${Math.round(now - decision.atAirMs)} ms behind · ${decision.reason}`,
        reasons: decision.reasons,
      });
      return false;
    }
    if (at.late)
      this.pushLog({
        source,
        kind: 'late',
        tone: 'amber',
        label: 'LATE',
        text: `${Math.round(now - decision.atAirMs)} ms behind · applied now`,
      });
    const id = ++this.scheduleSeq;
    const change: ObChange = {
      ...(decision.shot ? { shot: decision.shot } : {}),
      ...(decision.transition ? { transition: decision.transition } : {}),
      ...(decision.effects ? { effects: decision.effects } : {}),
      ...(decision.lowerThird ? { lowerThird: decision.lowerThird } : {}),
      ...(decision.replay ? { replay: decision.replay } : {}),
      ...(decision.pacing ? { pacing: decision.pacing } : {}),
      holdMs: decision.holdMs,
      reason: decision.reason,
      reasons: decision.reasons,
    };
    const timer = setTimeout(
      () => {
        this.scheduled.delete(id);
        if (this.disposed) return;
        this.applyDecision(change, source);
        this.afterProgramChange();
      },
      Math.max(0, at.applyAtMs - now),
    );
    this.scheduled.set(id, {
      id,
      timer,
      change,
      source,
      applyAtMs: at.applyAtMs,
    });
    this.prog = { ...this.prog, lastApplyAtMs: at.applyAtMs };
    this.markStateDirty();
    return true;
  }

  private cancelScheduled(match: (c: ScheduledChange) => boolean): void {
    let removed = false;
    for (const c of [...this.scheduled.values()]) {
      if (!match(c)) continue;
      clearTimeout(c.timer);
      this.scheduled.delete(c.id);
      removed = true;
    }
    if (!removed) return;
    // New decisions queue after what is still scheduled, not after the dropped.
    let last = Math.min(this.prog.lastApplyAtMs, this.now());
    for (const c of this.scheduled.values()) last = Math.max(last, c.applyAtMs);
    this.prog = { ...this.prog, lastApplyAtMs: last };
  }

  private nextScheduled(): ObState['autoPilot']['next'] {
    let best: ScheduledChange | null = null;
    for (const c of this.scheduled.values())
      if (!best || c.applyAtMs < best.applyAtMs) best = c;
    if (!best) return null;
    return {
      shot: best.change.shot ?? null,
      atMs: best.applyAtMs,
      reason: best.change.reason ?? '',
    };
  }

  private segment(): { index: number; title: string } | null {
    const item = this.config.rundown[this.rundownIndex];
    return item ? { index: this.rundownIndex, title: item.title } : null;
  }

  // ── Replay (file cams) ──────────────────────────────────────────────

  private defaultReplayCam(): string | null {
    const prog = this.prog.program;
    const main = prog ? this.cams.get(primaryCam(prog)) : undefined;
    if (main?.kind === 'file') return main.id;
    return (
      this.cams.list().find((c) => c.kind === 'file' && c.inputId)?.id ?? null
    );
  }

  private startReplay(
    camId: string,
    source: ObActionSource,
    mediaMs?: number,
  ): ObCommandResult {
    const cam = this.cams.get(camId);
    if (!cam)
      return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
    const cut = this.deps.cutReplayClip;
    const clock = cam.inputId ? this.deps.getFileClock?.(cam.inputId) : null;
    if (cam.kind !== 'file' || !cam.fileName || !cut || !clock)
      return {
        ok: false,
        code: 'no_file_cam',
        message: 'Replay works on file cameras only.',
      };
    if (this.replay && !this.replay.dropped)
      return {
        ok: false,
        code: 'replay_busy',
        message: 'A replay is already running.',
      };
    const now = this.now();
    const media = mediaMs ?? airMediaMs(clock, now);
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const r: ReplayState = {
      id,
      camId: cam.id,
      camName: `CAM ${cam.number} ${cam.talent ?? cam.name}`,
      file: null,
      inputId: null,
      durationMs: 0,
      requestedAt: now,
      clipStartAt: null,
      closeAt: null,
      dropped: false,
    };
    this.replay = r;
    this.pushLog({
      source,
      kind: 'replay',
      tone: source === 'operator' ? 'chalk' : 'ai',
      label: 'REPLAY',
      text: `${r.camName} · cutting @ ${(Math.max(0, media) / 1000).toFixed(1)} s`,
      camId: cam.id,
    });
    void cut(cam.fileName, Math.max(0, media), id)
      .then((clip) => this.onReplayCut(r, clip))
      .catch((err) => {
        console.warn('[ob] replay cut failed', err);
        this.dropReplay(r, 'cut failed');
      });
    this.armReplayTimer(REPLAY_OPEN_GRACE_MS);
    return { ok: true };
  }

  private onReplayCut(
    r: ReplayState,
    clip: { file: string; durationMs: number } | null,
  ): void {
    if (this.disposed || this.replay !== r || r.dropped) return;
    if (!clip || !(clip.durationMs > 0)) {
      this.dropReplay(r, 'empty clip');
      return;
    }
    r.file = clip.file;
    r.durationMs = clip.durationMs;
    const offsetMs = this.deps.getPipelineTimeMs();
    void this.deps
      .registerReplayClip(clip.file, offsetMs)
      .then((inputId) => {
        if (this.disposed || this.replay !== r || r.dropped) {
          if (inputId) this.deps.unregisterReplayClip(inputId, clip.file);
          return;
        }
        if (!inputId) {
          this.dropReplay(r, 'register failed');
          return;
        }
        const now = this.now();
        r.inputId = inputId;
        r.clipStartAt = now;
        r.closeAt =
          now +
          Math.max(REPLAY_CLOSE_LEAD_MS, r.durationMs - REPLAY_CLOSE_LEAD_MS);
        this.armReplayTimer(r.closeAt - now);
        this.pushLog({
          source: 'system',
          kind: 'replay',
          tone: 'good',
          label: 'REPLAY',
          text: `on air · ${(r.durationMs / 1000).toFixed(1)} s`,
          camId: r.camId,
        });
        this.afterProgramChange();
      })
      .catch((err) => {
        console.error('[ob] replay clip register failed', err);
        this.dropReplay(r, 'register failed');
      });
  }

  private armReplayTimer(ms: number): void {
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.replayTimer = setTimeout(
      () => {
        this.replayTimer = null;
        const r = this.replay;
        if (!r || this.disposed) return;
        if (r.closeAt != null) this.closeReplay();
        else this.dropReplay(r, 'clip never arrived');
      },
      Math.max(0, ms),
    );
  }

  private closeReplay(): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
    const { inputId, file } = r;
    if (inputId && file) {
      // The window fades with the HUD first; the clip input goes after.
      const t = setTimeout(() => {
        this.replayUnregisterTimers.delete(t);
        this.deps.unregisterReplayClip(inputId, file);
      }, REPLAY_UNREGISTER_MS);
      this.replayUnregisterTimers.add(t);
    }
    this.afterProgramChange();
  }

  private dropReplay(r: ReplayState, reason: string): void {
    if (this.replay !== r) return;
    r.dropped = true;
    this.pushLog({
      source: 'system',
      kind: 'replay',
      tone: 'bad',
      label: 'REPLAY',
      text: `dropped · ${reason}`,
      camId: r.camId,
    });
    if (r.inputId && r.file) this.deps.unregisterReplayClip(r.inputId, r.file);
    r.inputId = null;
    this.replay = null;
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
    this.afterProgramChange();
  }

  // ── Signals ─────────────────────────────────────────────────────────

  /** A worker result for a camera input (`{kind:'audio'|'video', …}`). */
  onWorkerResult(inputId: string, data: unknown, ptsNanos?: number): void {
    if (this.disposed) return;
    const cam = this.cams.byInput(inputId);
    if (!cam) return;
    const now = this.now();
    const settle = this.settleUntil.get(cam.id);
    if (settle !== undefined) {
      if (now < settle) return;
      this.settleUntil.delete(cam.id);
    }
    const sample = parseWorkerSample(data, now, ptsNanos);
    if (!sample) return;
    cam.lastSignalAt = now;
    this.signals.ingest(cam.id, sample);
  }

  /** Subtitles on a transcribed input: always, unless it is a camera and the show turned them off. */
  showsSubtitles(inputId: string): boolean {
    return this.config.subtitles || !this.cams.byInput(inputId);
  }

  /** A caption line that just aired on a camera input. */
  onTranscript(
    inputId: string,
    text: string,
    airMs: number,
    durationMs: number,
  ): void {
    if (this.disposed) return;
    const cam = this.cams.byInput(inputId);
    if (!cam || !text.trim()) return;
    this.signals.ingest(cam.id, {
      kind: 'transcript',
      airMs,
      text,
      durationMs,
    });
    this.llm?.onTranscript(cam.number, text, airMs);
  }

  /** OB_SIM: feed a fabricated sample as if the worker sent it now. */
  simulateSignal(camId: string, sample: ObSimSample): ObCommandResult {
    const cam = this.cams.get(camId);
    if (!cam)
      return { ok: false, code: 'unknown_cam', message: 'No such camera.' };
    this.engage();
    const now = this.now();
    cam.lastSignalAt = now;
    if (sample.kind === 'transcript') {
      this.signals.ingest(cam.id, {
        kind: 'transcript',
        airMs: now,
        text: sample.text,
        durationMs: 2000,
      });
      this.llm?.onTranscript(cam.number, sample.text, now);
    } else {
      this.signals.ingest(cam.id, { ...sample, arrivalMs: now, procMs: 0 });
    }
    return { ok: true };
  }

  // ── Situation (LLM) ─────────────────────────────────────────────────

  getSituation(): ObSituation {
    const now = this.now();
    const view = this.signals.view();
    const onProgram = new Set(onAirCams(this.prog));
    const onPreview = new Set(
      this.prog.preview ? obShotCams(this.prog.preview) : [],
    );
    const lt = this.lowerThird;
    const ltCam = lt?.camId ? this.cams.get(lt.camId) : undefined;
    return {
      atMs: now,
      phase: this.phase,
      eventName: this.config.eventName,
      brief: this.config.brief,
      presetId: this.config.presetId,
      segment: this.segment(),
      rundown: this.config.rundown.map((r) => r.title),
      cams: this.cams.list().map((c) => {
        const s = view[c.id];
        return {
          number: c.number,
          camId: c.id,
          name: c.name,
          role: c.role,
          talent: c.talent,
          live: c.live && c.inputId != null,
          onProgram: onProgram.has(c.id),
          onPreview: onPreview.has(c.id),
          signals: s
            ? {
                speechShare: s.speechShare10s,
                rmsDb: s.rmsEma,
                motion: s.motionEma,
                people: s.people.count,
              }
            : null,
        };
      }),
      program: {
        shot: this.prog.program,
        sinceMs: this.prog.sinceMs,
        source: this.prog.source,
      },
      pacing: this.pacing(),
      lowerThird: lt
        ? { name: lt.name, camNumber: ltCam?.number ?? null }
        : null,
      lastCuts: this.log
        .snapshot()
        .filter(
          (e) => e.kind === 'take' || e.kind === 'cut' || e.kind === 'auto',
        )
        .slice(0, 10),
    };
  }

  private pacing(): { minHoldMs: number; maxHoldMs: number } {
    const f = OB_PACING_DIAL_FACTOR[this.config.pacingDial];
    return {
      minHoldMs:
        this.pacingOverride?.minHoldMs ??
        Math.round(this.ruleset.pacing.minHoldMs * f),
      maxHoldMs:
        this.pacingOverride?.maxHoldMs ??
        Math.round(this.ruleset.pacing.maxHoldMs * f),
    };
  }

  // ── LLM forwards ────────────────────────────────────────────────────

  private requireLlm(): ObLlmModule {
    if (!this.llm)
      throw new ObLlmError(
        'llm_unavailable',
        'LLM is off — set ANTHROPIC_API_KEY on the server.',
      );
    return this.llm;
  }

  async llmBrief(brief?: string): Promise<ObBriefResult> {
    const llm = this.requireLlm();
    this.engage();
    const text = (brief ?? this.config.brief).slice(
      0,
      OB_CONFIG_LIMITS.brief.max,
    );
    if (brief !== undefined) this.config.brief = text;
    return llm.generateRuleset({
      brief: text,
      presetId: this.config.presetId,
      cams: this.getSituation().cams,
      // The room's ruleset in force (demo overrides included), so a brief
      // adapts what is running instead of resetting to the plain preset.
      base: structuredClone(this.effectiveRuleset()),
    });
  }

  llmAnalyst(
    enabled: boolean,
    intervalS?: number,
    model?: ObLlmModelId,
  ): ObLlmStatus {
    const llm = this.requireLlm();
    this.setConfig({
      llm: {
        analyst: enabled,
        ...(intervalS !== undefined ? { analystIntervalS: intervalS } : {}),
        ...(model !== undefined ? { model } : {}),
      },
    });
    return llm.status();
  }

  llmStatus(): ObLlmStatus {
    const status = this.llm?.status() ?? this.llmStatusCache;
    return status
      ? { ...status }
      : { ...OFFLINE_LLM, intervalS: this.config.llm.analystIntervalS };
  }

  async llmWrap(): Promise<string> {
    const llm = this.requireLlm();
    const notes = await llm.wrapNotes({
      stats: this.statsSnapshot(this.now()),
      log: this.log.snapshot(),
      brief: this.config.brief,
      eventName: this.config.eventName,
    });
    if (this.disposed) return notes;
    this.wrapNotes = notes;
    this.markStateDirty();
    return notes;
  }

  llmKill(): ObLlmStatus {
    const llm = this.requireLlm();
    llm.kill();
    this.config.llm.analyst = false;
    this.markStateDirty();
    return llm.status();
  }

  // ── Stats ───────────────────────────────────────────────────────────

  /** Close the current hold (a cut or the wrap). */
  private accountHold(now: number, source?: ObActionSource): void {
    if (this.phase !== 'on-air' || this.stats.startedAtMs == null) return;
    const shot = this.prog.program;
    if (shot) {
      const held = Math.max(
        0,
        now - Math.max(this.prog.sinceMs, this.stats.startedAtMs),
      );
      for (const c of obShotCams(shot))
        this.stats.onAirMsByCam[c] = (this.stats.onAirMsByCam[c] ?? 0) + held;
      this.stats.holdSumMs += held;
      this.stats.holds++;
    }
    if (source) {
      this.stats.cuts++;
      this.stats.bySource[source]++;
    }
  }

  private statsSnapshot(now: number): ObStats {
    const s = this.stats;
    const onAir = { ...s.onAirMsByCam };
    if (this.phase === 'on-air' && s.startedAtMs != null && this.prog.program) {
      const held = Math.max(
        0,
        now - Math.max(this.prog.sinceMs, s.startedAtMs),
      );
      for (const c of obShotCams(this.prog.program))
        onAir[c] = (onAir[c] ?? 0) + held;
    }
    return {
      startedAtMs: s.startedAtMs,
      endedAtMs: s.endedAtMs,
      cuts: s.cuts,
      bySource: { ...s.bySource },
      onAirMsByCam: onAir,
      avgHoldMs: s.holds ? Math.round(s.holdSumMs / s.holds) : 0,
    };
  }

  // ── Snapshots / publish ─────────────────────────────────────────────

  private tallies(): Record<string, ObTally> {
    return tallyOf(
      this.prog,
      this.cams.list().map((c) => c.id),
    );
  }

  private logCams() {
    return this.cams.list();
  }

  stateSnapshot(): ObState {
    const now = this.now();
    const tallies = this.tallies();
    const t = this.prog.transition;
    const r = this.replay;
    return {
      roomId: this.roomId,
      phase: this.phase,
      config: structuredClone(this.config),
      ruleset: structuredClone(this.ruleset),
      cams: this.cams
        .list()
        .map((c) =>
          toPublicCam(
            c,
            tallies[c.id] ?? 'off',
            c.lastSignalAt != null && now - c.lastSignalAt < SIGNAL_FRESH_MS,
          ),
        ),
      program: {
        shot: this.prog.program,
        sinceMs: this.prog.sinceMs,
        source: this.prog.source,
        transition: t
          ? {
              type: t.type,
              startedAtMs: t.startedAtMs,
              durationMs: t.durationMs,
            }
          : null,
      },
      preview: this.prog.preview,
      autoPilot: {
        on: this.config.autoPilot,
        pausedUntilMs: this.autoPausedUntil,
        next: this.nextScheduled(),
        lastDecisionAtMs: this.lastDecisionAt,
      },
      effects: { ...this.effects },
      lowerThird: this.lowerThird ? { ...this.lowerThird } : null,
      titleBug: this.titleBug(),
      audio: { ...this.config.audio },
      replay:
        r && !r.dropped
          ? {
              camId: r.camId,
              untilMs: r.closeAt ?? r.requestedAt + REPLAY_OPEN_GRACE_MS,
            }
          : null,
      rundown: {
        items: structuredClone(this.config.rundown),
        index: this.rundownIndex,
      },
      operator: this.operator ? { name: this.operator.name } : null,
      overrides: {
        pacing: this.pacingOverride ? { ...this.pacingOverride } : null,
        preferCam: this.preferCam
          ? {
              camId: this.preferCam.camId,
              untilMs: this.preferCam.untilMs,
              boost: this.preferCam.boost,
            }
          : null,
      },
      llm: this.llmStatus(),
      stats: this.statsSnapshot(now),
      wrapNotes: this.wrapNotes,
      isRecording: this.deps.hasActiveRecording?.() ?? false,
      log: this.log.tail(LOG_TAIL),
    };
  }

  private titleBug(): ObTitleBug {
    return {
      event: this.config.eventName,
      segment: this.titleSegment,
      visible: this.config.titleBugVisible,
    };
  }

  /** Everything that follows a change: audio, tally, HUD, state. */
  private afterProgramChange(): void {
    if (this.disposed) return;
    this.applyAudio();
    this.pushTally();
    this.publishHud();
    this.markStateDirty();
  }

  private applyAudio(): void {
    const map = audioMap(
      this.config.audio,
      onAirCams(this.prog),
      this.sceneCams(),
    );
    for (const [inputId, v] of map) {
      if (this.lastVolumes.get(inputId) === v) continue;
      this.lastVolumes.set(inputId, v);
      this.deps.setInputVolume(inputId, v);
    }
  }

  private pushTally(): void {
    const tallies = this.tallies();
    for (const cam of this.cams.list()) {
      const tally = tallies[cam.id] ?? 'off';
      if (this.lastTally.get(cam.id) === tally) continue;
      this.lastTally.set(cam.id, tally);
      if (cam.clientId)
        this.deps.sendTo(cam.clientId, {
          type: 'ob_tally',
          camId: cam.id,
          tally,
          number: cam.number,
        });
    }
  }

  /** `ob_state` on change, at most every STATE_MIN_INTERVAL_MS. */
  private markStateDirty(): void {
    if (this.disposed || this.stateTimer) return;
    const now = this.now();
    const wait = this.lastStateAt + STATE_MIN_INTERVAL_MS - now;
    if (wait <= 0) {
      this.broadcastState(now);
      return;
    }
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (!this.disposed) this.broadcastState(this.now());
    }, wait);
  }

  private broadcastState(now: number): void {
    this.lastStateAt = now;
    this.flushLog();
    this.deps.broadcast({ type: 'ob_state', state: this.stateSnapshot() });
  }

  private hudState(): ObHudState {
    const stage = this.lastStage;
    const r = this.replay;
    const lt = this.lowerThird;
    const onAir = this.phase === 'on-air';
    const preset = OB_PRESET_META.find((p) => p.id === this.config.presetId);
    return {
      stage: {
        phase: this.phase,
        dip: this.prog.dip ? { ...this.prog.dip } : null,
        replay:
          r && r.inputId && !r.dropped
            ? { inputId: r.inputId, camName: r.camName }
            : null,
        backdrop: stage?.backdrop ?? null,
        tiles: stage ? { ...stage.looks } : {},
      },
      lowerThird:
        onAir && lt
          ? {
              name: lt.name,
              subtitle: lt.subtitle,
              startedAtMs: lt.startedAtMs,
              untilMs: lt.untilMs,
            }
          : null,
      titleBug:
        onAir && this.config.titleBugVisible
          ? { event: this.config.eventName, segment: this.titleSegment }
          : null,
      setup:
        this.phase === 'setup'
          ? {
              eventName: this.config.eventName,
              presetLabel: preset
                ? `${preset.label} · ${preset.sub}`
                : presetLabel(this.config.presetId),
              qr: { imageId: this.qrImageId, label: shortUrl(this.joinUrl) },
              cams: this.cams.list().map((c) => ({
                number: c.number,
                name: c.talent ? `${c.name} · ${c.talent}` : c.name,
                role: roleLabel(c.role),
                kind: c.kind,
                live: c.live && c.inputId != null,
              })),
            }
          : null,
      wrap: this.phase === 'wrap' ? this.wrapCard() : null,
    };
  }

  private wrapCard(): NonNullable<ObHudState['wrap']> {
    const s = this.statsSnapshot(this.now());
    const total = Object.values(s.onAirMsByCam).reduce((a, b) => a + b, 0);
    const shares = this.cams
      .list()
      .map((c) => ({
        number: c.number,
        name: c.talent ?? c.name,
        pct:
          total > 0
            ? Math.round(((s.onAirMsByCam[c.id] ?? 0) / total) * 100)
            : 0,
      }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
    return {
      eventName: this.config.eventName,
      durationMs:
        s.startedAtMs != null ? (s.endedAtMs ?? this.now()) - s.startedAtMs : 0,
      cuts: s.cuts,
      avgHoldMs: s.avgHoldMs,
      bySource: s.bySource,
      shares,
    };
  }

  private publishHud(): void {
    if (this.disposed || !this.engaged) return;
    const state = this.hudState();
    const key = JSON.stringify(state);
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;
    this.deps.publishHud(state);
  }

  private pushLog(entry: Omit<ObLogEntry, 'id' | 'atMs'>): void {
    this.log.push(entry, this.now());
  }

  private flushLog(): void {
    if (this.disposed) return;
    const entries = this.log.drain();
    if (entries.length) this.deps.broadcast({ type: 'ob_log', entries });
  }

  private broadcastSignals(now: number): void {
    if (now - this.lastSignalsAt < SIGNALS_MIN_INTERVAL_MS) return;
    const signals = this.signals.summary();
    const key = JSON.stringify(signals);
    if (key === this.lastSignalsKey) return;
    this.lastSignalsAt = now;
    this.lastSignalsKey = key;
    this.deps.broadcast({ type: 'ob_signals', atMs: now, signals });
  }

  // ── Loop ────────────────────────────────────────────────────────────

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
      this.phase === 'setup' &&
      this.cams.size === 0 &&
      !this.operator &&
      this.scheduled.size === 0 &&
      !this.replay
    )
      this.stop();
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    this.pollCams(now);
    this.reapCams(now);
    this.settleNow();
    this.expire(now);
    this.signals.expire(this.clock.nowAir());
    this.checkFileCamLoop(now);
    this.stepVirtual(now);
    this.autoStep(now);
    this.broadcastSignals(now);
    this.publishHud();
    this.flushLog();
    this.maybeStop();
  }

  private pollCams(now: number): void {
    if (now - this.lastCamPoll < CAM_POLL_MS) return;
    this.lastCamPoll = now;
    let changed = false;
    for (const cam of this.cams.list()) {
      if (cam.inputId == null) continue;
      const live =
        cam.kind === 'whip'
          ? (this.deps.isInputLive?.(cam.inputId) ??
            this.deps.isInputConnected(cam.inputId))
          : this.deps.isInputConnected(cam.inputId);
      const delay = this.deps.getSideChannelDelayMs?.(cam.inputId);
      if (delay != null && delay !== cam.delayMs) {
        cam.delayMs = delay;
        changed = true;
      }
      if (live !== cam.live) {
        cam.live = live;
        changed = true;
        if (
          live &&
          this.shownShot &&
          obShotCams(this.shownShot).includes(cam.id)
        )
          this.restage();
      }
    }
    if (changed) {
      this.publishHud();
      this.markStateDirty();
    }
  }

  private reapCams(now: number): void {
    for (const cam of this.cams.expired(now)) this.removeCam(cam, 'gone');
  }

  private expire(now: number): void {
    if (this.lowerThird?.untilMs != null && now >= this.lowerThird.untilMs) {
      this.lowerThird = null;
      this.markStateDirty();
    }
    if (this.preferCam && now >= this.preferCam.untilMs) {
      this.preferCam = null;
      this.markStateDirty();
    }
    if (
      this.pacingOverride?.untilMs != null &&
      now >= this.pacingOverride.untilMs
    ) {
      this.pacingOverride = null;
      this.markStateDirty();
    }
    if (this.holdUntil != null && now >= this.holdUntil) this.holdUntil = null;
  }

  /**
   * Looping file cams: a joint restart just before the first clip wraps —
   * unless they loop together on their own (see fileCamsLoopTogether).
   */
  private checkFileCamLoop(now: number): void {
    const resync = this.deps.resyncFileCams;
    const get = this.deps.getFileClock;
    if (!resync || !get) return;
    const clocks: { inputId: string; clock: ObFileClock }[] = [];
    for (const cam of this.cams.list()) {
      if (cam.kind !== 'file' || cam.inputId == null) continue;
      const clock = get(cam.inputId);
      if (clock?.durationMs && clock.durationMs > 0)
        clocks.push({ inputId: cam.inputId, clock });
    }
    if (clocks.length === 0) return;
    const sig = clocks
      .map((c) => `${c.inputId}:${c.clock.anchorWallMs}:${c.clock.playFromMs}`)
      .join('|');
    if (sig === this.lastLoopResyncSig) return;
    const wrapping = clocks.some(
      ({ clock }) =>
        clock.playFromMs + (now - clock.anchorWallMs) >=
        (clock.durationMs ?? Infinity) - LOOP_RESYNC_LEAD_MS,
    );
    if (!wrapping) return;
    if (
      fileCamsLoopTogether(
        clocks.map((c) => c.clock),
        now,
      )
    )
      return;
    this.lastLoopResyncSig = sig;
    resync().catch((err) =>
      console.warn(
        `[ob] loop resync failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const t of this.transitionTimers) clearTimeout(t);
    this.transitionTimers.clear();
    for (const c of this.scheduled.values()) clearTimeout(c.timer);
    this.scheduled.clear();
    if (this.parkTimer) clearTimeout(this.parkTimer);
    this.parkTimer = null;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.replayTimer = null;
    for (const t of this.replayUnregisterTimers) clearTimeout(t);
    this.replayUnregisterTimers.clear();
    const r = this.replay;
    if (r?.inputId && r.file) this.deps.unregisterReplayClip(r.inputId, r.file);
    this.replay = null;
    this.llm?.dispose();
    this.cams.clear();
    this.operator = null;
    this.deps.publishHud(null);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function dimsOf(
  msg: Record<string, unknown>,
): { width: number; height: number } | undefined {
  const w = msg.nativeWidth;
  const h = msg.nativeHeight;
  if (typeof w !== 'number' || typeof h !== 'number') return undefined;
  if (!(w >= 16 && w <= 7680 && h >= 16 && h <= 7680)) return undefined;
  return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Equal-length file cams started together wrap on their own in the engine
 * (`loop: true`) — seamless on air — and stay aligned. A joint restart would
 * black them out for the side-channel delay and skip each clip's last
 * `delay` seconds, so it is only for clips of different lengths or start
 * phases, or ones whose small length differences have drifted apart.
 */
export function fileCamsLoopTogether(
  clocks: readonly ObFileClock[],
  now: number,
): boolean {
  if (clocks.length === 0) return false;
  const lengths = clocks.map((c) => c.durationMs ?? 0);
  if (lengths.some((d) => d <= 0)) return false;
  const lengthDiff = Math.max(...lengths) - Math.min(...lengths);
  if (lengthDiff > LOCKSTEP_MAX_LENGTH_DIFF_MS) return false;
  // Wall time at which each clip played media 0, compared around the loop.
  const period = lengths[0];
  const zero0 = clocks[0].anchorWallMs - clocks[0].playFromMs;
  for (const c of clocks) {
    const d =
      (((c.anchorWallMs - c.playFromMs - zero0) % period) + period) % period;
    if (Math.min(d, period - d) > LOCKSTEP_MAX_PHASE_DIFF_MS) return false;
  }
  const loops = Math.max(
    ...clocks.map(
      (c) => (c.playFromMs + now - c.anchorWallMs) / (c.durationMs as number),
    ),
  );
  return Math.floor(loops) * lengthDiff <= LOCKSTEP_MAX_DRIFT_MS;
}

/** Media time of the frame ON AIR at wall time `now` for a file cam. */
function airMediaMs(clock: ObFileClock, now: number): number {
  const t = clock.playFromMs + (now - clock.anchorWallMs);
  const media =
    clock.durationMs && clock.durationMs > 0 && t >= 0
      ? t % clock.durationMs
      : t;
  return media - clock.delayMs;
}

function sanitizeRundown(items: readonly ObRundownItem[]): ObRundownItem[] {
  const out: ObRundownItem[] = [];
  const seen = new Set<string>();
  for (const it of items.slice(0, OB_CONFIG_LIMITS.rundown.max)) {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) continue;
    let id =
      typeof it.id === 'string' && it.id
        ? it.id.slice(0, 40)
        : `seg-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    const item: ObRundownItem = { id, title: it.title.trim().slice(0, 60) };
    if (it.preset && (OB_PRESET_IDS as readonly string[]).includes(it.preset))
      item.preset = it.preset;
    out.push(item);
  }
  return out;
}

function presetLabel(id: ObPresetId): string {
  return id === 'custom' ? 'CUSTOM RULES' : id.toUpperCase();
}

function shortUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//, '').slice(0, 48);
}
