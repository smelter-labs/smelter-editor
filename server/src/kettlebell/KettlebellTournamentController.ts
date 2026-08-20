import type {
  KbtConfig,
  KbtExerciseKey,
  KbtHeatPhase,
  KbtHeatSummary,
  KbtMatchAction,
  KbtMatchEvent,
  KbtPlayer,
  KbtScoreBreakdown,
  KbtStateEvent,
  KbtTournamentPhase,
  KettlebellExercise,
  KettlebellIssueCode,
  RoomEvent,
} from '@smelter-editor/types';
import { KBT_DEFAULT_CONFIG, KBT_EXERCISE_KEYS } from '@smelter-editor/types';
import type {
  KbtBoardRow,
  KbtHudScene,
  KbtHudState,
  KbtHudTile,
} from '../app/store';
import { kbtCasterCamRect, kbtCasterVisible } from '../app/store';

/** Command from the arcade page's match endpoint. */
export type KbtMatchCommand = {
  action: KbtMatchAction;
  heatIndex?: number;
};

/**
 * Everything the controller needs from the room, injected so tests can fake
 * the world (same pattern as KettlebellCoachController's injected broadcast).
 * All camera/AI/layout calls are best-effort async — the controller never
 * blocks its tick on them.
 */
export type KbtControllerDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  /** Register a WHIP camera input through InputManager (side channel baked in). */
  registerPlayerCam: (
    name: string,
    dims?: { width: number; height: number },
  ) => Promise<{ inputId: string; whipUrl: string; bearerToken: string }>;
  removeInput: (inputId: string) => Promise<void>;
  /** Enable/disable the kettlebell-coach model on one input. */
  setKettlebellCoach: (
    inputId: string,
    enabled: boolean,
    params?: Record<string, number | string>,
  ) => Promise<void>;
  /** Replace the output layout with these tiles (manual positions). */
  layoutTiles: (
    tiles: {
      inputId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[],
  ) => Promise<void>;
  /** WHIP input is currently connected (receiving acks). */
  isInputConnected: (inputId: string) => boolean;
  /** Output resolution for tile math. */
  getResolution: () => { width: number; height: number };
  /** Write the burned-in HUD state (already hold-scheduled by the controller). */
  publishHud: (state: KbtHudState | null) => void;
  /**
   * Render `url` as a QR PNG and register it with the engine; resolves with
   * the image id the HUD can pass to <Image>. Re-registering for a changed
   * url must yield a fresh id (image content is immutable per id).
   */
  registerJoinQr: (url: string) => Promise<string>;
  now?: () => number;
};

type PlayerState = {
  clientId: string;
  name: string;
  color: string;
  connected: boolean;
  inputId: string | null;
  camConnected: boolean;
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
};

type ScoreState = {
  points: number;
  reps: Record<KbtExerciseKey, number>;
  incorrectReps: number;
  streak: number;
  bestStreak: number;
  name: string;
  color: string;
  exercise: KettlebellExercise;
  lastRepAt: number | null;
  lastRepVerdict: 'correct' | 'incorrect' | null;
  lastRepPoints: number;
  /** Timestamps of this heat's reps within the RPM window (pruned on read). */
  repTimes: number[];
};

/** One commentator per room — a WHIP input outside the players/heats world. */
type CommentatorState = {
  clientId: string;
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
  winner: { clientId: string; name: string; color: string; points: number } | null;
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
/** Debounce for pose visibility flips (raw results arrive ~12-16/s). */
const POSE_DEBOUNCE_MS = 700;
/** Roster camera mosaic is capped to keep tiles readable. */
const ROSTER_MOSAIC_MAX = 6;

/** Analysis rate by heat size — all heat players' inference shares one GPU. */
function analysisFpsFor(playerCount: number): number {
  if (playerCount <= 2) return 14;
  if (playerCount === 3) return 12;
  return 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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
  /** Last player-tile layout, so a scene flip can re-stage the caster cam. */
  private lastTiles: {
    inputId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  /** Monotonic clamp for held HUD applies (mirror of kettlebellApplyAt). */
  private hudApplyAt = 0;
  private readonly hudTimers = new Set<ReturnType<typeof setTimeout>>();
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
      nativeWidth?: unknown;
      nativeHeight?: unknown;
    };
    switch (msg.type) {
      case 'kbt_join':
        this.join(clientId, typeof msg.name === 'string' ? msg.name : 'Lifter');
        break;
      case 'kbt_cam_request': {
        const w = Number(msg.nativeWidth);
        const h = Number(msg.nativeHeight);
        const dims =
          Number.isFinite(w) && Number.isFinite(h) &&
          w >= 16 && w <= 8192 && h >= 16 && h <= 8192
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
        );
        break;
      case 'kbt_commentator_cam_request': {
        const w = Number(msg.nativeWidth);
        const h = Number(msg.nativeHeight);
        const dims =
          Number.isFinite(w) && Number.isFinite(h) &&
          w >= 16 && w <= 8192 && h >= 16 && h <= 8192
            ? { width: Math.round(w), height: Math.round(h) }
            : undefined;
        void this.startCommentatorCamera(clientId, dims);
        break;
      }
      case 'kbt_commentator_leave':
        this.leaveCommentator(clientId);
        break;
      default:
        break;
    }
  }

  /**
   * Register (or reconnect) a player. A join whose name exactly matches a
   * disconnected player adopts that entry — scores and the heat slot survive a
   * phone dying mid-tournament (the reconnecting socket has a new clientId).
   */
  join(clientId: string, rawName: string): void {
    const name = rawName.slice(0, 20).trim() || 'Lifter';
    const existing = this.players.get(clientId);
    if (existing) {
      existing.name = name;
      existing.connected = true;
    } else {
      const orphan = [...this.players.values()].find(
        (p) => !p.connected && p.name === name,
      );
      if (orphan) {
        this.adoptPlayer(orphan, clientId);
      } else {
        this.players.set(clientId, {
          clientId,
          name,
          color: PLAYER_COLORS[this.colorSeq++ % PLAYER_COLORS.length],
          connected: true,
          inputId: null,
          camConnected: false,
          poseTracked: false,
          briefed: false,
          fullBody: true,
          camWidth: null,
          camHeight: null,
          bestScore: 0,
          finalScore: null,
          heatIndex: null,
        });
      }
    }
    this.ensureRunning();
    this.broadcastState();
  }

  /** Re-key a disconnected player's whole trail onto the new clientId. */
  private adoptPlayer(orphan: PlayerState, clientId: string): void {
    const oldId = orphan.clientId;
    this.players.delete(oldId);
    orphan.clientId = clientId;
    orphan.connected = true;
    this.players.set(clientId, orphan);
    for (const heat of this.heats) {
      heat.playerIds = heat.playerIds.map((id) => (id === oldId ? clientId : id));
      const score = heat.scores.get(oldId);
      if (score) {
        heat.scores.delete(oldId);
        heat.scores.set(clientId, score);
      }
      if (heat.winner?.clientId === oldId) heat.winner.clientId = clientId;
    }
    if (this.leaderId === oldId) this.leaderId = clientId;
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
    if (!p) return;
    this.retireCamera(p);
    if (dims) {
      p.camWidth = dims.width;
      p.camHeight = dims.height;
    }
    let cam: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      cam = await this.deps.registerPlayerCam(p.name, dims);
    } catch (err) {
      console.error(
        `[kbt] camera input register failed for ${clientId}`,
        err,
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
    if (this.phase === 'roster') void this.layoutRosterMosaic();
    this.broadcastState();
  }

  /**
   * Not cleared in retireCamera(): startCamera() retires on every cam
   * re-request, and on reconnect the re-sent kbt_briefed can land before the
   * cam re-request — clearing there would wipe a briefing that still holds.
   */
  private setBriefed(clientId: string, briefed: boolean): void {
    const p = this.players.get(clientId);
    if (!p || p.briefed === briefed) return;
    p.briefed = briefed;
    this.broadcastState();
  }

  private retireCamera(p: PlayerState): void {
    if (p.inputId == null) return;
    const inputId = p.inputId;
    p.inputId = null;
    p.camConnected = false;
    p.poseTracked = false;
    p.fullBody = true;
    void this.deps.setKettlebellCoach(inputId, false).catch(() => {});
    void this.deps.removeInput(inputId).catch(() => {});
  }

  // ── Commentator ───────────────────────────────────────────────────────────

  /**
   * Register (or reconnect) the room's single commentator. Like players, a
   * join whose name matches the disconnected commentator adopts the slot (the
   * running WHIP input survives a phone reconnect); a different name replaces
   * the commentator outright.
   */
  joinCommentator(clientId: string, rawName: string): void {
    const name = rawName.slice(0, 20).trim() || 'Commentator';
    const c = this.commentator;
    if (c && (c.clientId === clientId || (!c.connected && c.name === name))) {
      c.clientId = clientId;
      c.name = name;
      c.connected = true;
    } else {
      if (c) this.retireCommentatorCam(c);
      this.commentator = {
        clientId,
        name,
        connected: true,
        inputId: null,
        camConnected: false,
        camWidth: null,
        camHeight: null,
      };
    }
    this.ensureRunning();
    this.broadcastState();
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
      cam = await this.deps.registerPlayerCam(`🎙 ${c.name}`, dims);
    } catch (err) {
      console.error(`[kbt] commentator cam register failed for ${clientId}`, err);
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

    score.reps[key] += 1;
    score.points += points;
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
    score.repTimes.push(now);

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
    });

    if (
      score.streak > 0 &&
      score.streak % STREAK_MILESTONE_EVERY === 0
    ) {
      this.deps.broadcast({
        type: 'kbt_streak',
        roomId: this.roomId,
        clientId: player.clientId,
        name: player.name,
        count: score.streak,
      });
      this.setBanner('streak', `${player.name} ×${score.streak} CLEAN!`, player.color);
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
    kind: 'lead_change' | 'streak',
    text: string,
    color: string,
  ): void {
    this.banner = { kind, text, color, at: this.now() };
  }

  // ── Config + match control (REST) ─────────────────────────────────────────

  setConfig(cfg: {
    scoring?: Partial<Record<KbtExerciseKey, Partial<{ enabled: boolean; points: number }>>>;
    strictTechnique?: boolean;
    heatDurationMs?: number;
    heatSize?: number;
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
    this.broadcastState();
    return structuredClone(this.config);
  }

  getConfig(): KbtConfig {
    return structuredClone(this.config);
  }

  controlMatch(cmd: KbtMatchCommand): {
    state: KbtStateEvent;
    match: KbtMatchEvent;
  } {
    switch (cmd.action) {
      case 'roster':
        this.phase = 'roster';
        this.currentHeatIndex = null;
        void this.layoutRosterMosaic();
        break;
      case 'assign_heats':
        this.assignHeats();
        break;
      case 'start_heat':
        void this.startHeat(cmd.heatIndex);
        break;
      case 'begin_heat':
        this.beginHeat();
        break;
      case 'stop_heat':
        this.stopHeat();
        break;
      case 'next_heat':
        this.nextHeat();
        break;
      case 'start_final':
        this.startFinal();
        break;
      case 'podium':
        this.phase = 'podium';
        break;
      case 'reset':
        this.resetTournament();
        break;
    }
    this.ensureRunning();
    this.broadcastState();
    const match = this.getMatchSnapshot();
    this.deps.broadcast(match);
    return { state: this.stateSnapshot(), match };
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
      this.heats.push(this.blankHeat(index, false, chunk.map((p) => p.clientId)));
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
      incorrectReps: 0,
      streak: 0,
      bestStreak: 0,
      name: p.name,
      color: p.color,
      exercise: 'idle',
      lastRepAt: null,
      lastRepVerdict: null,
      lastRepPoints: 0,
      repTimes: [],
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
  private tileRow(
    cams: { inputId: string; aspect: number }[],
  ): { inputId: string; x: number; y: number; width: number; height: number }[] {
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
  private async applyLayout(
    tiles: {
      inputId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[],
  ): Promise<void> {
    this.lastTiles = tiles;
    const all = [...tiles];
    const casterInput = this.commentator?.inputId;
    if (casterInput) {
      all.push({
        inputId: casterInput,
        ...kbtCasterCamRect(
          this.deps.getResolution(),
          kbtCasterVisible(this.stagedScene),
        ),
      });
    }
    try {
      await this.deps.layoutTiles(all);
    } catch (err) {
      console.error('[kbt] layoutTiles failed', err);
    }
  }

  /** Re-apply the last layout (scene flip moved the caster cam rect, or the
   * commentator input appeared/vanished). */
  private async restage(): Promise<void> {
    await this.applyLayout(this.lastTiles);
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
    const fps = analysisFpsFor(heat.playerIds.length);
    for (const p of staged) {
      void this.deps
        .setKettlebellCoach(p.inputId!, true, { analysisFps: fps })
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

  /** intro → countdown; the AMRAP clock arms at countdown end. */
  private beginHeat(): void {
    const heat = this.activeHeat();
    if (!heat || heat.phase !== 'intro') return;
    if (!this.heatReady(heat)) return;
    const now = this.now();
    heat.phase = 'countdown';
    heat.startsAt = now + COUNTDOWN_MS;
    heat.endsAt = heat.startsAt + this.config.heatDurationMs;
    heat.lastBroadcastAt = now;
    this.publishHud();
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
  private startFinal(): void {
    const ranked = [...this.players.values()]
      .filter((p) => p.bestScore > 0 || p.heatIndex != null)
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, this.config.heatSize);
    if (ranked.length < 2) return;
    const index = this.heats.length;
    this.heats.push(
      this.blankHeat(index, true, ranked.map((p) => p.clientId)),
    );
    this.phase = 'final';
    this.currentHeatIndex = index;
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
      heat && (heat.phase === 'intro' || heat.phase === 'countdown' || heat.phase === 'playing');
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
      if (withinLinger || this.stagedScene !== this.computeScene()) {
        this.publishHud();
      }
    }
    this.maybeStop();
  }

  private tickHeat(now: number): void {
    const heat = this.activeHeat();
    if (!heat) return;
    if (heat.phase === 'countdown' && heat.startsAt != null && now >= heat.startsAt) {
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
      (heat.phase === 'countdown' || heat.phase === 'playing' || heat.phase === 'intro') &&
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
      } else {
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
    let changed = false;
    for (const p of this.players.values()) {
      const connected =
        p.inputId != null && this.deps.isInputConnected(p.inputId);
      if (connected !== p.camConnected) {
        p.camConnected = connected;
        changed = true;
      }
    }
    const c = this.commentator;
    if (c) {
      const connected =
        c.inputId != null && this.deps.isInputConnected(c.inputId);
      if (connected !== c.camConnected) {
        c.camConnected = connected;
        changed = true;
      }
    }
    if (changed) this.broadcastState();
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
    };
  }

  private publicPlayer(p: PlayerState): KbtPlayer {
    return {
      clientId: p.clientId,
      name: p.name,
      color: p.color,
      camConnected: p.camConnected,
      poseTracked: p.poseTracked,
      briefed: p.briefed,
      bestScore: p.bestScore,
      finalScore: p.finalScore,
      heatIndex: p.heatIndex,
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
      winner: heat.phase === 'ended' && heat.finalized ? heat.winner : undefined,
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
          points: p.rankPoints,
          reps,
          rpm: Math.round((reps * 60_000) / this.config.heatDurationMs),
        };
      });
  }

  /**
   * Publish the burned-in HUD, held by HUD_HOLD_MS with a monotonic clamp so
   * snapshots land in order on the ~3s-delayed video (see HUD_HOLD_MS docs).
   * Builds the full scene snapshot (kb_design): lobby / solo / grid / board /
   * podium plus the commentator lower-third.
   */
  private publishHud(): void {
    if (this.disposed) return;
    const now = this.now();
    const scene = this.computeScene();
    if (scene !== this.stagedScene) {
      this.stagedScene = scene;
      // The caster cam rect is scene-dependent; move it with the scene.
      void this.restage();
    }

    const heat = this.activeHeat();
    const tiles: Record<string, KbtHudTile> = {};
    let match: KbtHudState['match'] = null;
    let heatLabel: string | null = null;
    let leader: KbtHudState['leader'] = null;

    if (heat && (scene === 'solo' || scene === 'grid')) {
      heatLabel = this.heatLabelFor(heat);
      const ranked = [...heat.scores.entries()].sort(
        (a, b) => b[1].points - a[1].points,
      );
      const rankOf = new Map(ranked.map(([id], i) => [id, i + 1]));
      for (const id of heat.playerIds) {
        const p = this.players.get(id);
        const s = heat.scores.get(id);
        if (!p?.inputId || !s) continue;
        tiles[p.inputId] = {
          clientId: id,
          name: s.name,
          color: s.color,
          points: s.points,
          reps: s.reps.swing + s.reps.clean + s.reps.snatch,
          repsByExercise: { ...s.reps },
          rpm: this.rpmFor(s, heat, now),
          rank: rankOf.get(id) ?? heat.playerIds.length,
          streak: s.streak,
          exercise: s.exercise,
          flash: s.lastRepAt != null && now - s.lastRepAt <= REP_FLASH_MS,
          lastRepVerdict: s.lastRepVerdict,
          lastRepPoints: s.lastRepPoints,
          signalLost: !p.camConnected && heat.phase !== 'intro',
        };
      }
      match = {
        phase: heat.phase === 'idle' ? 'intro' : heat.phase,
        heatIndex: heat.index,
        final: heat.final,
        startsAt: heat.startsAt,
        endsAt: heat.endsAt,
        remainingMs:
          heat.phase === 'countdown' && heat.startsAt != null
            ? Math.max(0, heat.startsAt - now)
            : heat.phase === 'playing' && heat.endsAt != null
              ? Math.max(0, heat.endsAt - now)
              : heat.phase === 'ended'
                ? 0
                : null,
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
                })),
            }
          : null,
      commentator: this.commentator
        ? {
            name: this.commentator.name,
            camConnected: this.commentator.camConnected,
            inputId: this.commentator.inputId,
          }
        : null,
      leader,
      banner,
    };
    this.applyHudHeld(snapshot);
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
    for (const p of this.players.values()) {
      if (p.inputId != null) {
        // Room teardown removes inputs itself; just drop our references.
        p.inputId = null;
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
