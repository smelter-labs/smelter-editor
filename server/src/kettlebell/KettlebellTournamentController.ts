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
import type { KbtHudState, KbtHudTile } from '../app/store';

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
    const msg = raw as { type?: unknown; name?: unknown };
    switch (msg.type) {
      case 'kbt_join':
        this.join(clientId, typeof msg.name === 'string' ? msg.name : 'Lifter');
        break;
      case 'kbt_cam_request':
        void this.startCamera(clientId);
        break;
      case 'kbt_cam_stop':
        this.stopCamera(clientId);
        break;
      case 'kbt_leave':
        this.leave(clientId);
        break;
      case 'kbt_spectate':
        this.spectate(clientId);
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
  async startCamera(clientId: string): Promise<void> {
    const p = this.players.get(clientId);
    if (!p) return;
    this.retireCamera(p);
    let cam: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      cam = await this.deps.registerPlayerCam(p.name);
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
    this.retireCamera(p);
    if (this.phase === 'roster') void this.layoutRosterMosaic();
    this.broadcastState();
  }

  private retireCamera(p: PlayerState): void {
    if (p.inputId == null) return;
    const inputId = p.inputId;
    p.inputId = null;
    p.camConnected = false;
    p.poseTracked = false;
    void this.deps.setKettlebellCoach(inputId, false).catch(() => {});
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
    const p = this.players.get(clientId);
    if (!p) return;
    p.connected = false;
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
  onPoseSample(inputId: string, tracked: boolean): void {
    const p = [...this.players.values()].find((pl) => pl.inputId === inputId);
    if (!p || p.poseTracked === tracked) return;
    const now = this.now();
    const since = this.poseFlipAt.get(p.clientId) ?? 0;
    if (now - since < POSE_DEBOUNCE_MS) return;
    this.poseFlipAt.set(p.clientId, now);
    p.poseTracked = tracked;
    this.deps.sendTo(p.clientId, {
      type: 'kbt_pose',
      roomId: this.roomId,
      clientId: p.clientId,
      tracked,
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
  }): KbtConfig {
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
        this.publishHudNull();
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
        this.publishHudNull();
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
    };
  }

  /** Lay out the active heat's cams as full-height columns and arm their AI. */
  private async stageActiveHeat(): Promise<void> {
    const heat =
      this.currentHeatIndex != null ? this.heats[this.currentHeatIndex] : null;
    if (!heat || heat.phase === 'idle' || heat.phase === 'ended') return;
    const staged = heat.playerIds
      .map((id) => this.players.get(id))
      .filter((p): p is PlayerState => !!p && p.inputId != null);
    const { width, height } = this.deps.getResolution();
    const n = Math.max(1, staged.length);
    const tileW = Math.floor(width / n);
    try {
      await this.deps.layoutTiles(
        staged.map((p, i) => ({
          inputId: p.inputId!,
          x: i * tileW,
          y: 0,
          width: tileW,
          height,
        })),
      );
    } catch (err) {
      console.error('[kbt] layoutTiles failed', err);
    }
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
    const { width, height } = this.deps.getResolution();
    const n = Math.max(1, cams.length);
    const tileW = Math.floor(width / n);
    try {
      await this.deps.layoutTiles(
        cams.map((p, i) => ({
          inputId: p.inputId!,
          x: i * tileW,
          y: 0,
          width: tileW,
          height,
        })),
      );
    } catch (err) {
      console.error('[kbt] roster mosaic layout failed', err);
    }
  }

  /** intro → countdown; the AMRAP clock arms at countdown end. */
  private beginHeat(): void {
    const heat = this.activeHeat();
    if (!heat || heat.phase !== 'intro') return;
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
    if (!next) this.publishHudNull();
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
    this.publishHudNull();
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
    if (!live && !lingering && this.players.size === 0) {
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
      if (withinLinger) this.publishHud();
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
    };
  }

  private publicPlayer(p: PlayerState): KbtPlayer {
    return {
      clientId: p.clientId,
      name: p.name,
      color: p.color,
      camConnected: p.camConnected,
      poseTracked: p.poseTracked,
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
  }

  /**
   * Publish the burned-in HUD, held by HUD_HOLD_MS with a monotonic clamp so
   * snapshots land in order on the ~3s-delayed video (see HUD_HOLD_MS docs).
   */
  private publishHud(): void {
    if (this.disposed) return;
    const heat = this.activeHeat();
    if (!heat) return;
    const now = this.now();
    const tiles: Record<string, KbtHudTile> = {};
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
        streak: s.streak,
        exercise: s.exercise,
        lastRepAt: s.lastRepAt,
        lastRepVerdict: s.lastRepVerdict,
        lastRepPoints: s.lastRepPoints,
        signalLost: !p.camConnected && heat.phase !== 'intro',
      };
    }
    const banner =
      this.banner && now - this.banner.at <= BANNER_MS ? this.banner : null;
    const snapshot: KbtHudState = {
      tiles,
      match: {
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
      },
      leaderboard: [...this.players.values()]
        .filter((p) => p.bestScore > 0 || p.finalScore != null)
        .sort(
          (a, b) =>
            (b.finalScore ?? -1) - (a.finalScore ?? -1) ||
            b.bestScore - a.bestScore,
        )
        .slice(0, 4)
        .map((p) => ({
          name: p.name,
          color: p.color,
          points: p.finalScore ?? p.bestScore,
        })),
      banner,
    };
    this.applyHudHeld(snapshot);
  }

  private publishHudNull(): void {
    this.applyHudHeld(null);
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
    this.heats = [];
    this.deps.publishHud(null);
  }
}

export { KETTLEBELL_COACH_ID as KBT_COACH_MODEL_ID };
