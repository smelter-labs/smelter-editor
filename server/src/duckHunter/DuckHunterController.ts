import { randomUUID } from 'node:crypto';
import type {
  RoomEvent,
  ShooterErrorCode,
  ShooterHostCharacter,
  ShooterMatchConfig,
  ShooterMatchEvent,
  ShooterMatchMode,
  ShooterPlayer,
  ShooterStateEvent,
} from '@smelter-editor/types';
import type { StoreApi } from 'zustand';
import type {
  DogReveal,
  PersonBoxes,
  RoomStore,
  ShooterBurst,
  ShooterMatchOverlay,
} from '../app/store';
import { clamp, clamp01 } from '../core/mathUtils';
import type { DuckEntity, DuckFlightParams, DuckViewport } from './duckFlight';
import {
  DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  DEFAULT_DUCK_PAUSE_MS,
  DUCK_DEATH_MS,
  DUCK_HANG_MS,
  MAX_DUCKS,
  contentToPx,
  duckContentPos,
  duckSidePx,
  validViewport,
} from './duckFlight';

/**
 * How the controller talks to the room. Cameras go through InputManager (via
 * RoomState) so they get the WHIP heartbeat monitor, the stale-input sweep and
 * `onInputsRemoved` notifications — never through the engine directly. The
 * `now` hook makes the whole controller clock-controllable in tests.
 */
export type DuckHunterDeps = {
  broadcast: (event: RoomEvent) => void;
  sendTo: (clientId: string, event: RoomEvent) => void;
  /** Register a hidden WHIP camera input through InputManager. */
  registerShooterCam: (
    name: string,
    dims?: { width: number; height: number },
  ) => Promise<{ inputId: string; whipUrl: string; bearerToken: string }>;
  removeInput: (inputId: string) => Promise<void>;
  /** WHIP input is actually publishing (heartbeat-acked within the TTL). */
  isInputLive: (inputId: string) => boolean;
  now?: () => number;
};

type Player = {
  clientId: string;
  /** Resume token: minted on first join, replayed by the phone on reconnect. */
  playerKey: string;
  name: string;
  color: string;
  /** Control socket state; a disconnected player lingers through the grace. */
  connected: boolean;
  disconnectedAt: number | null;
  aimX: number;
  aimY: number;
  /** Eased, rendered crosshair position (smooths the broadcast crosshair). */
  dispX: number;
  dispY: number;
  score: number;
  /** Ammo: firing consumes one; the magazine regenerates one per reloadMs. */
  ammo: number;
  maxAmmo: number;
  reloadMs: number;
  /** When the current reload cycle started (ms), or null when the mag is full. */
  reloadStartedAt: number | null;
  /** Wall-clock ms of this player's last hit, for the streak window. */
  lastHitAt: number;
  /** Current run of consecutive hits (gaps < STREAK_WINDOW_MS keep it going). */
  streak: number;
  /**
   * Smelter WHIP input id carrying this player's live front camera, or null
   * when the camera is off. Registered on demand (shoot_cam_start) and drawn
   * live inside the player's avatar circle by the overlay renderer.
   */
  camInputId: string | null;
  /**
   * Bumped on every camera start/stop; an awaited registration only commits
   * when the generation it captured is still current, so a stop (or a second
   * start) during the in-flight register cancels it instead of leaking the
   * input and pinning a dead avatar tile.
   */
  camGen: number;
  /** The publish is heartbeat-live (flips via pollCameras, not registration). */
  camConnected: boolean;
};

/** Per-player ammo config sent from the phone (calibration screen). */
export type AmmoConfig = { maxAmmo?: number; reloadMs?: number };

/** Command from the arcade page's match endpoint. */
export type MatchCommand = {
  action: 'start' | 'stop' | 'reset' | 'lobby';
} & Partial<ShooterMatchConfig>;

/**
 * Server-authoritative arcade round layered on top of free-play. `null` means
 * no match (the classic dashboard flow) — scoring is then never gated.
 */
type MatchState = {
  phase: 'countdown' | 'playing' | 'ended';
  mode: ShooterMatchMode;
  durationMs: number | null;
  targetScore: number | null;
  /** Countdown end / first moment shots count. */
  startsAt: number;
  /** Time-mode deadline; null in points mode. */
  endsAt: number | null;
  character: ShooterHostCharacter | null;
  winner: ShooterPlayer | null;
  finalScores: ShooterPlayer[];
  lastBroadcastAt: number;
  /** Set on 'ended'; gates the loop-stop linger. */
  endedAt: number | null;
};

/** Distinct, bright crosshair colors (kept away from the ghost palette). */
const PLAYER_COLORS = [
  '#FFEB3B', // yellow
  '#00E5FF', // cyan
  '#FF4081', // pink
  '#76FF03', // green
  '#FF9100', // orange
  '#B388FF', // purple
];

const RESPAWN_MS = 3000; // how long a shot ghost stays down before returning
const BURST_MS = 600; // shot-effect lifetime
// Streak: two hits within this window trigger the Duck Hunt dog pop-up.
const STREAK_WINDOW_MS = 2000;
const DOG_REVEAL_MS = 6000; // how long the dog stays on screen per pop-up
const PUBLISH_MS = 33; // ~30Hz overlay refresh while the game is active
// Hit radius as a fraction of the visible sprite side. The sprite footprint
// itself comes from the shared duck model (duckSidePx), so the hitbox always
// tracks the drawn duck — across zoom levels and the operator's duckScale.
const HIT_FACTOR = 0.55;
const CROSSHAIR_SMOOTH = 0.5; // eases the broadcast crosshair toward the aim

// Ammo defaults + bounds (players tune within these on the calibration screen).
const DEFAULT_MAX_AMMO = 6;
const DEFAULT_RELOAD_MS = 3000;
const MAX_AMMO_CAP = 12;
const MIN_RELOAD_MS = 1000;
const MAX_RELOAD_MS = 30000;

// Arcade match bounds + pacing.
const MATCH_COUNTDOWN_MS = 3000;
const MATCH_MIN_DURATION_MS = 10_000;
const MATCH_MAX_DURATION_MS = 600_000;
const MATCH_DEFAULT_DURATION_MS = 60_000;
const MATCH_MIN_TARGET = 1;
const MATCH_MAX_TARGET = 200;
const MATCH_DEFAULT_TARGET = 10;
const MATCH_BROADCAST_MS = 1000; // clock tick rate for shooter_match events

// A dropped phone keeps its roster entry (score, color, camera) this long so
// a reconnect adopts it — but never reaped mid-round, where losing a row
// would corrupt the final scoreboard.
const DISCONNECT_REAP_MS = 120_000;
// After a match ends, keep ticking this long (game-over banner reaches the
// broadcast, final shooter_match goes out) before the loop is allowed to stop.
const ENDED_LINGER_MS = 5000;

function normalizeAmmoConfig(cfg?: AmmoConfig): {
  maxAmmo: number;
  reloadMs: number;
} {
  return {
    maxAmmo: Math.round(
      clamp(cfg?.maxAmmo ?? DEFAULT_MAX_AMMO, 1, MAX_AMMO_CAP),
    ),
    reloadMs: Math.round(
      clamp(cfg?.reloadMs ?? DEFAULT_RELOAD_MS, MIN_RELOAD_MS, MAX_RELOAD_MS),
    ),
  };
}

/**
 * Duck Hunter game logic for one room. Phones send aim (gyroscope) + fire
 * over the room WebSocket; this controller tracks players, hit-tests shots
 * against the live target boxes, manages shot-down/respawn, and publishes the
 * crosshair/scoreboard/hit overlay into the Smelter render store.
 *
 * The "target" is whichever input currently renders sprites (peopleBoxes.ghost).
 * Aim is in normalized content space [0,1] — the same space as the target boxes.
 */
export class DuckHunterController {
  private readonly players = new Map<string, Player>();
  /** ghostId -> respawnAt (ms) for the current target input. */
  private readonly deadGhosts = new Map<number, number>();
  /**
   * Bird-sprite mode: the authoritative live ducks, keyed by track id. A duck is
   * spawned the first time its detection appears, then flies a fixed trajectory
   * detached from the box (see duckFlight). The renderer draws these and the
   * hit-test shoots at them, so a shot always lands on the sprite.
   */
  private readonly ducks = new Map<number, DuckEntity>();
  /** Track ids whose duck already flew off; suppresses respawn until the id
   * leaves detection and re-enters as a fresh sighting. */
  private readonly departed = new Set<number>();
  private bursts: ShooterBurst[] = [];
  private nextBurstId = 1;
  private dogReveals: DogReveal[] = [];
  private nextDogId = 1;
  private colorSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCamPoll = 0;
  /** Real time of the previous tick, for lag-proof hit-stop advancement. */
  private lastTickAt = 0;
  // Room-wide ammo rules, set by the operator in the Duck Hunter panel and
  // applied to every player (current + future joiners).
  private roomMaxAmmo = DEFAULT_MAX_AMMO;
  private roomReloadMs = DEFAULT_RELOAD_MS;
  /** Arcade round state; null = free-play (classic dashboard behavior). */
  private match: MatchState | null = null;
  /**
   * The arcade host is on the lobby/config screens. With no match this is what
   * separates "wait for the host" from dashboard open range — on the wire both
   * are matchless with ducks flying, so phones can't tell them apart otherwise.
   */
  private lobbyArmed = false;
  /** Last targetActive broadcast, so lobby clients hear the flip. */
  private lastTargetActive = false;

  constructor(
    private readonly roomId: string,
    private readonly store: StoreApi<RoomStore>,
    private readonly deps: DuckHunterDeps,
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Register (or reconnect) a player. A join carrying a known playerKey
   * adopts that entry even when its old socket still looks open — a fast
   * refresh beats the stale socket's close, and forking the player would
   * split scores (the stale close later finds no player under its clientId
   * and no-ops). Without a key, a join whose name exactly matches a
   * *disconnected* player adopts it (legacy phones); a key that matches
   * nothing skips name adoption — that phone is a genuinely new entrant,
   * and adopting by name could hijack someone else's slot.
   */
  join(clientId: string, rawName: string, playerKey?: string): void {
    const name = rawName.slice(0, 24).trim() || 'Player';
    const existing = this.players.get(clientId);
    if (existing) {
      // Already joined (e.g. re-entering after the calibration screen): keep
      // the player but refresh the chosen name.
      existing.name = name;
      existing.connected = true;
      existing.disconnectedAt = null;
      this.sendJoined(clientId, existing);
      this.ensureRunning();
      this.publish();
      this.broadcastState();
      this.sendAmmo(clientId);
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
    let player: Player;
    if (orphan) {
      this.adoptPlayer(orphan, clientId);
      orphan.name = name;
      player = orphan;
    } else {
      if (this.players.size >= PLAYER_COLORS.length) {
        this.sendError(
          clientId,
          'room_full',
          `Room is full (${PLAYER_COLORS.length} hunters max)`,
        );
        return;
      }
      player = {
        clientId,
        playerKey: playerKey ?? randomUUID(),
        name,
        color: PLAYER_COLORS[this.colorSeq++ % PLAYER_COLORS.length],
        connected: true,
        disconnectedAt: null,
        aimX: 0.5,
        aimY: 0.5,
        dispX: 0.5,
        dispY: 0.5,
        score: 0,
        ammo: this.roomMaxAmmo,
        maxAmmo: this.roomMaxAmmo,
        reloadMs: this.roomReloadMs,
        reloadStartedAt: null,
        lastHitAt: 0,
        streak: 0,
        camInputId: null,
        camGen: 0,
        camConnected: false,
      };
      this.players.set(clientId, player);
    }
    this.sendJoined(clientId, player);
    this.ensureRunning();
    this.publish();
    this.broadcastState();
    this.sendAmmo(clientId);
  }

  /** The joiner's private ack (carries the bearer playerKey + restored score). */
  private sendJoined(clientId: string, p: Player): void {
    this.deps.sendTo(clientId, {
      type: 'shooter_joined',
      roomId: this.roomId,
      clientId,
      playerKey: p.playerKey,
      name: p.name,
      color: p.color,
      score: p.score,
      camInputActive: p.camInputId != null,
    });
  }

  /** A rejected request, addressed to the client that made it. */
  private sendError(
    clientId: string,
    code: ShooterErrorCode,
    message: string,
  ): void {
    this.deps.sendTo(clientId, {
      type: 'shooter_error',
      roomId: this.roomId,
      code,
      message,
    });
  }

  /** Re-key a (usually disconnected) player's whole trail onto the new clientId. */
  private adoptPlayer(orphan: Player, clientId: string): void {
    const oldId = orphan.clientId;
    this.players.delete(oldId);
    orphan.clientId = clientId;
    orphan.connected = true;
    orphan.disconnectedAt = null;
    this.players.set(clientId, orphan);
    const m = this.match;
    if (m) {
      if (m.winner?.clientId === oldId) m.winner.clientId = clientId;
      for (const row of m.finalScores) {
        if (row.clientId === oldId) row.clientId = clientId;
      }
    }
  }

  /**
   * Set the room-wide ammo rules (max magazine size / reload time) from the
   * Duck Hunter panel. Stored as the default for future joiners and applied
   * immediately to every connected player.
   */
  setRoomConfig(ammo: AmmoConfig): void {
    const { maxAmmo, reloadMs } = normalizeAmmoConfig({
      maxAmmo: ammo.maxAmmo ?? this.roomMaxAmmo,
      reloadMs: ammo.reloadMs ?? this.roomReloadMs,
    });
    this.roomMaxAmmo = maxAmmo;
    this.roomReloadMs = reloadMs;
    for (const p of this.players.values()) {
      p.maxAmmo = maxAmmo;
      p.reloadMs = reloadMs;
      if (p.ammo > maxAmmo) p.ammo = maxAmmo;
      if (p.ammo >= maxAmmo) p.reloadStartedAt = null;
      else if (p.reloadStartedAt == null) p.reloadStartedAt = this.now();
      this.sendAmmo(p.clientId);
    }
  }

  /** Current room-wide ammo rules (for the panel to read back). */
  getRoomConfig(): { maxAmmo: number; reloadMs: number } {
    return { maxAmmo: this.roomMaxAmmo, reloadMs: this.roomReloadMs };
  }

  /**
   * Drive the arcade match from the /duck-hunter page:
   * - start: reset all scores/ammo, 3s countdown, then shots count until the
   *   clock runs out (time mode) or someone reaches the target (points mode).
   * - stop: end the round now (winner = current leader).
   * - reset: back to free-play; the game-over banner clears.
   * - lobby: the host opened the arcade lobby — clear any finished match and
   *   tell phones to hold on the briefing screen until start.
   */
  controlMatch(cmd: MatchCommand): ShooterMatchEvent {
    const now = this.now();
    switch (cmd.action) {
      case 'start': {
        const mode: ShooterMatchMode =
          cmd.mode === 'points' ? 'points' : 'time';
        this.match = {
          phase: 'countdown',
          mode,
          durationMs:
            mode === 'time'
              ? Math.round(
                  clamp(
                    cmd.durationMs ?? MATCH_DEFAULT_DURATION_MS,
                    MATCH_MIN_DURATION_MS,
                    MATCH_MAX_DURATION_MS,
                  ),
                )
              : null,
          targetScore:
            mode === 'points'
              ? Math.round(
                  clamp(
                    cmd.targetScore ?? MATCH_DEFAULT_TARGET,
                    MATCH_MIN_TARGET,
                    MATCH_MAX_TARGET,
                  ),
                )
              : null,
          startsAt: now + MATCH_COUNTDOWN_MS,
          endsAt: null,
          character: cmd.character ?? null,
          winner: null,
          finalScores: [],
          lastBroadcastAt: now,
          endedAt: null,
        };
        // A fresh round starts from zero for everyone, magazines full.
        for (const p of this.players.values()) {
          p.score = 0;
          p.streak = 0;
          p.lastHitAt = 0;
          p.ammo = p.maxAmmo;
          p.reloadStartedAt = null;
          this.sendAmmo(p.clientId);
        }
        this.bursts = [];
        this.dogReveals = [];
        this.lobbyArmed = false;
        this.ensureRunning();
        break;
      }
      case 'stop': {
        if (this.match && this.match.phase !== 'ended') this.endMatch(now);
        break;
      }
      case 'reset': {
        this.match = null;
        this.lobbyArmed = false;
        this.maybeStop();
        break;
      }
      case 'lobby': {
        this.match = null;
        this.lobbyArmed = true;
        this.maybeStop();
        break;
      }
    }
    const snapshot = this.getMatchSnapshot();
    this.deps.broadcast(snapshot);
    this.publish();
    this.broadcastState();
    return snapshot;
  }

  /** Current match state as a wire event ('idle'/'lobby' when matchless). */
  getMatchSnapshot(): ShooterMatchEvent {
    const m = this.match;
    if (!m) {
      return {
        type: 'shooter_match',
        roomId: this.roomId,
        phase: this.lobbyArmed ? 'lobby' : 'idle',
      };
    }
    const now = this.now();
    return {
      type: 'shooter_match',
      roomId: this.roomId,
      phase: m.phase,
      mode: m.mode,
      targetScore: m.targetScore ?? undefined,
      startsAtMs: m.startsAt,
      endsAtMs: m.endsAt ?? undefined,
      remainingMs:
        m.phase === 'countdown'
          ? Math.max(0, m.startsAt - now)
          : m.phase === 'playing' && m.endsAt != null
            ? Math.max(0, m.endsAt - now)
            : undefined,
      character: m.character ?? undefined,
      winner: m.phase === 'ended' ? m.winner : undefined,
      finalScores: m.phase === 'ended' ? m.finalScores : undefined,
    };
  }

  /**
   * Subscribe-only handshake for the arcade page: reply with the current state
   * + match snapshots without creating a player. The socket already receives
   * all broadcasts (every room WS is subscribed to the event bus), so this only
   * fills the gap of an initial snapshot on connect.
   */
  spectate(clientId: string): void {
    this.deps.sendTo(clientId, this.stateSnapshot());
    this.deps.sendTo(clientId, this.getMatchSnapshot());
  }

  leave(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p || !this.players.delete(clientId)) return;
    this.retireCameraInput(p);
    this.publish();
    this.broadcastState();
    this.maybeStop();
  }

  /**
   * Turn the player's live camera on: register a dedicated WHIP input through
   * InputManager (hidden — composited only inside the player's avatar circle
   * by the overlay renderer, never as a layout tile) and reply with the
   * endpoint + bearer token so the phone can publish its front camera.
   *
   * Idempotent-ish: an existing camera input is torn down first so a reconnect
   * (or a rapid off→on toggle) always gets a fresh WHIP session/token.
   */
  async startCamera(
    clientId: string,
    dims?: { width: number; height: number },
  ): Promise<void> {
    const p = this.players.get(clientId);
    if (!p) return;
    // Drop any previous session so the phone always publishes into a fresh input.
    this.retireCameraInput(p);

    const gen = ++p.camGen;
    let cam: { inputId: string; whipUrl: string; bearerToken: string };
    try {
      cam = await this.deps.registerShooterCam(p.name, dims);
    } catch (err) {
      console.error(
        `[duck-hunter] camera input register failed for ${clientId}`,
        err,
      );
      if (this.players.get(clientId) === p) {
        this.sendError(clientId, 'camera_failed', 'Camera slot failed — retry');
      }
      return;
    }
    // The player may have left, toggled the camera off, or re-requested while
    // we awaited — only the registration matching the current generation may
    // commit; anything else must clean up its now-orphaned input.
    if (
      this.players.get(clientId) !== p ||
      p.camGen !== gen ||
      p.camInputId != null
    ) {
      void this.deps.removeInput(cam.inputId).catch(() => {});
      return;
    }
    p.camInputId = cam.inputId;
    p.camConnected = false; // flips true once the publish acks (pollCameras)
    this.deps.sendTo(clientId, {
      type: 'shooter_cam_offer',
      roomId: this.roomId,
      clientId,
      inputId: cam.inputId,
      whipUrl: cam.whipUrl,
      bearerToken: cam.bearerToken,
    });
    this.publish();
  }

  /** Turn the player's live camera off and tear down its WHIP input. */
  stopCamera(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    // Bump even with no committed input — this cancels an in-flight register
    // (its generation check fails on resolve), the exact window the old
    // `camInputId == null` early-return leaked.
    p.camGen++;
    if (p.camInputId == null) return;
    this.retireCameraInput(p);
    this.publish();
  }

  /** Remove the player's camera WHIP input (if any) and clear it. */
  private retireCameraInput(p: Player): void {
    if (p.camInputId == null) return;
    const inputId = p.camInputId;
    p.camInputId = null;
    p.camConnected = false;
    void this.deps.removeInput(inputId).catch(() => {});
  }

  /**
   * The room reaped inputs behind our back (stale-WHIP sweep). Drop every
   * reference so the avatar tile stops rendering a dead input and the phone
   * learns its cam is gone on the next state broadcast. No deps.removeInput
   * here — the inputs are already gone from the engine.
   */
  onInputsRemoved(inputIds: string[]): void {
    const gone = new Set(inputIds);
    let changed = false;
    for (const p of this.players.values()) {
      if (p.camInputId != null && gone.has(p.camInputId)) {
        p.camInputId = null;
        p.camConnected = false;
        changed = true;
      }
    }
    if (!changed) return;
    this.publish();
    this.broadcastState();
  }

  /** 1 Hz: reflect WHIP ack liveness into camLive on the wire + HUD. */
  private pollCameras(now: number): void {
    if (now - this.lastCamPoll < 1000) return;
    this.lastCamPoll = now;
    let changed = false;
    for (const p of this.players.values()) {
      const live = p.camInputId != null && this.deps.isInputLive(p.camInputId);
      if (live !== p.camConnected) {
        p.camConnected = live;
        changed = true;
      }
    }
    if (changed) {
      this.publish();
      this.broadcastState();
    }
  }

  aim(clientId: string, x: number, y: number): void {
    const p = this.players.get(clientId);
    if (!p) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const content = this.outputToContent(x, y);
    p.aimX = clamp01(content.x);
    p.aimY = clamp01(content.y);
    // Rendered on the next publish tick (coalesced to ~30Hz).
  }

  /**
   * Convert an aim point from output-normalized space [0,1] (where the phone
   * touches the live output video) into the target input's content space
   * (normalized source-frame coords used for hit-testing / crosshair render).
   *
   * This inverts the rescale 'fill' (cover) transform and assumes the ghost
   * input fills the output (broadcast/solo). Without a target we pass through.
   */
  private outputToContent(ox: number, oy: number): { x: number; y: number } {
    const state = this.store.getState();
    const targetId = this.getTargetInputId();
    const pb = targetId ? state.peopleBoxes[targetId] : undefined;
    if (!pb) return { x: ox, y: oy };
    const W = state.resolution.width;
    const H = state.resolution.height;
    const fw = pb.frameW;
    const fh = pb.frameH;
    if (!(W > 0 && H > 0 && fw > 0 && fh > 0)) return { x: ox, y: oy };
    const scale = Math.max(W / fw, H / fh);
    const dispW = fw * scale;
    const dispH = fh * scale;
    const offX = (W - dispW) / 2;
    const offY = (H - dispH) / 2;
    return {
      x: (ox * W - offX) / dispW,
      y: (oy * H - offY) / dispH,
    };
  }

  fire(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;

    // Match rounds only accept shots while 'playing' — the countdown and the
    // game-over screen swallow the trigger silently (no ammo spend, no click).
    // Aim stays live so crosshairs keep moving on the broadcast.
    if (this.match && this.match.phase !== 'playing') return;

    // Out of ammo: no shot, just tell the phone to click empty.
    if (p.ammo <= 0) {
      this.deps.sendTo(clientId, {
        type: 'shooter_empty',
        roomId: this.roomId,
        clientId,
      });
      this.sendAmmo(clientId);
      return;
    }
    // Spend a round (starts the reload cycle if the mag was full).
    p.ammo -= 1;
    if (p.reloadStartedAt == null) p.reloadStartedAt = this.now();
    this.sendAmmo(clientId);

    const targetId = this.getTargetInputId();
    const pb = targetId
      ? this.store.getState().peopleBoxes[targetId]
      : undefined;
    if (!pb || pb.boxes.length === 0) {
      this.sendMiss(clientId);
      return;
    }

    // Fire at the crosshair the player actually SEES on the broadcast, not the
    // raw latest aim. The rendered crosshair is eased (CROSSHAIR_SMOOTH) and so
    // lags the raw aim while the phone moves — using aimX/aimY here would land
    // the shot ahead of the visible crosshair (in the direction of motion), the
    // "shot appears above/beside the crosshair" bug.
    const shotX = p.dispX;
    const shotY = p.dispY;

    // Bird sprites fly a trajectory detached from the detection box, so we must
    // hit-test the ducks at their *current* drawn position (the same shared
    // model the renderer uses). Pac-Man ghosts stay glued to the box, so those
    // hit-test against the live box directly.
    const best =
      pb.sprite === 'bird'
        ? this.hitTestDucks(shotX, shotY)
        : this.hitTestBoxes(pb, shotX, shotY);

    if (!best) {
      // Miss: show an "✕" where the player fired (at the visible crosshair).
      this.bursts.push({
        id: this.nextBurstId++,
        x: shotX,
        y: shotY,
        at: Date.now(),
        kind: 'miss',
      });
      this.publish();
      this.sendMiss(clientId);
      return;
    }

    const now = this.now();
    this.deadGhosts.set(best.id, now + RESPAWN_MS);
    // Bird mode: mark the duck shot so it plays its death beat (hang → fall)
    // from where it was hit, and drops out of the live flock / hit-test.
    const duck = this.ducks.get(best.id);
    if (duck && duck.diedAt == null) duck.diedAt = now;
    p.score += 1;
    // Streak: hits within STREAK_WINDOW_MS chain; the moment it reaches two,
    // the Duck Hunt dog pops up (holding two ducks) tinted to this player.
    p.streak = now - p.lastHitAt < STREAK_WINDOW_MS ? p.streak + 1 : 1;
    p.lastHitAt = now;
    if (p.streak === 2) {
      this.dogReveals.push({
        id: this.nextDogId++,
        color: p.color,
        x: best.cx,
        at: now,
      });
    }
    this.bursts.push({
      id: this.nextBurstId++,
      x: best.cx,
      y: best.cy,
      at: now,
      kind: 'hit',
    });
    this.ensureRunning();
    this.deps.sendTo(clientId, {
      type: 'shooter_hit',
      roomId: this.roomId,
      clientId,
      ghostId: best.id,
      score: p.score,
    });
    // Points mode: first to the target ends the round on the winning shot.
    if (
      this.match &&
      this.match.mode === 'points' &&
      this.match.targetScore != null &&
      p.score >= this.match.targetScore
    ) {
      this.endMatch(now);
    }
    this.publish();
    this.broadcastState();
  }

  /**
   * Handle WS disconnect for a client (may or may not be a player). The
   * player entry is NOT removed: score, color and camera survive so a
   * reconnect (playerKey or name) adopts them. The WHIP publish also outlives
   * the control socket — a phone whose WS blipped keeps streaming; a truly
   * dead camera is reaped by the stale-input sweep. Idle disconnected entries
   * are reaped in tick() after DISCONNECT_REAP_MS.
   */
  handleDisconnect(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    this.publish();
    this.broadcastState();
  }

  /** Remove long-disconnected players — but never mid-round. */
  private reapDisconnected(now: number): void {
    if (this.match?.phase === 'countdown' || this.match?.phase === 'playing') {
      return;
    }
    for (const p of [...this.players.values()]) {
      if (
        !p.connected &&
        p.disconnectedAt != null &&
        now - p.disconnectedAt >= DISCONNECT_REAP_MS
      ) {
        this.leave(p.clientId);
      }
    }
  }

  /**
   * Keep the game loop running while a bird target is active, so ducks fly on
   * the broadcast even before any player joins. Called by RoomState whenever it
   * refreshes the bird detections.
   */
  ensureActive(): void {
    if (this.hasBirdTarget()) this.ensureRunning();
  }

  dispose(): void {
    this.stop();
    this.match = null;
    for (const p of this.players.values()) {
      this.retireCameraInput(p);
    }
    this.players.clear();
    this.deadGhosts.clear();
    this.ducks.clear();
    this.departed.clear();
    this.bursts = [];
    this.dogReveals = [];
    this.store.getState().setShooter(null);
  }

  // --- internals ---

  private getTargetInputId(): string | null {
    const boxes = this.store.getState().peopleBoxes;
    for (const [inputId, pb] of Object.entries(boxes)) {
      if (pb.ghost) return inputId;
    }
    return null;
  }

  /** The current sprite target (ghost-enabled input) with its boxes, or null. */
  private getTargetPb(): { id: string; pb: PersonBoxes } | null {
    const boxes = this.store.getState().peopleBoxes;
    for (const [id, pb] of Object.entries(boxes)) {
      if (pb.ghost) return { id, pb };
    }
    return null;
  }

  private hasBirdTarget(): boolean {
    const t = this.getTargetPb();
    return !!t && t.pb.sprite === 'bird';
  }

  /**
   * Bird mode: shoot at the ducks where they are actually drawn right now. Each
   * duck's position comes from the shared free-flight model (duckContentPos) —
   * the same one the renderer draws with — so the hitbox tracks the sprite even
   * after it has flown off its detection box. Returns the closest duck within
   * its (sprite-sized) radius, in output pixels so the hitbox is a screen-circle.
   */
  private hitTestDucks(
    shotX: number,
    shotY: number,
  ): { id: number; cx: number; cy: number } | null {
    const target = this.getTargetPb();
    if (!target) return null;
    const v = duckViewport(this.store.getState().resolution, target.pb);
    if (!validViewport(v)) return null;
    const params = flightParams(target.pb);
    const now = this.now();
    const scale = Math.max(v.width / v.frameW, v.height / v.frameH);
    const dispW = v.frameW * scale;
    const dispH = v.frameH * scale;
    let best: { id: number; cx: number; cy: number } | null = null;
    let bestDist = Infinity;
    for (const d of this.ducks.values()) {
      if (d.diedAt != null) continue;
      const pos = duckContentPos(d, now, params, v);
      const dx = (shotX - pos.x) * dispW;
      const dy = (shotY - pos.y) * dispH;
      const dist = Math.hypot(dx, dy);
      const radius = HIT_FACTOR * d.sideFrac * v.width;
      if (dist <= radius && dist < bestDist) {
        best = { id: d.id, cx: pos.x, cy: pos.y };
        bestDist = dist;
      }
    }
    return best;
  }

  /** Ghost mode: sprites stay glued to the detection box, so hit-test the box
   * center with a radius matching the drawn sprite footprint (output pixels). */
  private hitTestBoxes(
    pb: PersonBoxes,
    shotX: number,
    shotY: number,
  ): { id: number; cx: number; cy: number } | null {
    const v = duckViewport(this.store.getState().resolution, pb);
    if (!validViewport(v)) return null;
    const mul = pb.duckScale ?? 1;
    const scale = Math.max(v.width / v.frameW, v.height / v.frameH);
    const dispW = v.frameW * scale;
    const dispH = v.frameH * scale;
    let best: { id: number; cx: number; cy: number } | null = null;
    let bestDist = Infinity;
    for (const b of pb.boxes) {
      if (this.deadGhosts.has(b.id)) continue;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const dx = (shotX - cx) * dispW;
      const dy = (shotY - cy) * dispH;
      const dist = Math.hypot(dx, dy);
      const radius = HIT_FACTOR * duckSidePx(b.w, b.h, mul, v);
      if (dist <= radius && dist < bestDist) {
        best = { id: b.id, cx, cy };
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Reconcile the live duck flock with the latest detections and advance each
   * duck's free-flight. Runs every tick (even with no players) so ducks keep
   * flying on the broadcast. New detection ids spawn a duck frozen at the box
   * center; a duck that flies off-screen is retired and its id suppressed until
   * it leaves detection and re-enters; a shot duck plays its death beat then is
   * dropped. This is the sole owner of duck state — the renderer only draws it.
   */
  private reconcileDucks(now: number, dt: number): void {
    const target = this.getTargetPb();
    if (!target || target.pb.sprite !== 'bird') {
      this.ducks.clear();
      this.departed.clear();
      return;
    }
    const { pb } = target;
    const v = duckViewport(this.store.getState().resolution, pb);
    const params = flightParams(pb);
    const mul = pb.duckScale ?? 1;
    const geomOk = validViewport(v);

    // Spawn a duck the first time each detection id appears.
    const detected = new Set<number>();
    if (geomOk) {
      for (const b of pb.boxes.slice(0, MAX_DUCKS)) {
        detected.add(b.id);
        if (
          this.ducks.has(b.id) ||
          this.departed.has(b.id) ||
          this.deadGhosts.has(b.id) ||
          // Cap the LIVE flock, not just this frame's detections — tracker id
          // churn otherwise accumulates ducks across ticks without bound.
          this.ducks.size >= MAX_DUCKS
        ) {
          continue;
        }
        this.ducks.set(b.id, {
          id: b.id,
          color: b.color,
          spawnAt: now,
          cx0: b.x + b.w / 2,
          cy0: b.y + b.h / 2,
          sideFrac: duckSidePx(b.w, b.h, mul, v) / v.width,
        });
      }
    }
    // An id that left detection can spawn a fresh duck if it comes back later.
    for (const id of [...this.departed]) {
      if (!detected.has(id)) this.departed.delete(id);
    }

    // Hit-stop: while any shot duck is still hanging, freeze the whole flock by
    // pushing its clock forward, so ducks resume in place after the beat.
    let hitStop = false;
    for (const d of this.ducks.values()) {
      if (d.diedAt != null && now - d.diedAt < DUCK_HANG_MS) {
        hitStop = true;
        break;
      }
    }
    for (const [id, d] of this.ducks) {
      if (d.diedAt != null) {
        if (now - d.diedAt >= DUCK_DEATH_MS) this.ducks.delete(id);
        continue;
      }
      if (hitStop) {
        d.spawnAt += dt;
        continue;
      }
      if (!geomOk) continue;
      const pos = duckContentPos(d, now, params, v);
      const { px, py } = contentToPx(pos.x, pos.y, v);
      const sidePx = d.sideFrac * v.width;
      // Fully off the top or right edge — the duck has flown away.
      if (px - sidePx / 2 > v.width || py + sidePx / 2 < 0) {
        this.ducks.delete(id);
        if (detected.has(id)) this.departed.add(id);
      }
    }
  }

  private sendMiss(clientId: string): void {
    this.deps.sendTo(clientId, {
      type: 'shooter_miss',
      roomId: this.roomId,
      clientId,
    });
  }

  private stateSnapshot(): ShooterStateEvent {
    return {
      type: 'shooter_state',
      roomId: this.roomId,
      players: [...this.players.values()].map((p) => ({
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        score: p.score,
        connected: p.connected,
        camLive: p.camConnected,
      })),
      targetActive: this.getTargetInputId() !== null,
    };
  }

  private broadcastState(): void {
    this.deps.broadcast(this.stateSnapshot());
  }

  /** Freeze the round: crown the top score (null on a draw) and broadcast. */
  private endMatch(now: number): void {
    const m = this.match;
    if (!m || m.phase === 'ended') return;
    const rows: ShooterPlayer[] = [...this.players.values()]
      .map((p) => ({
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        score: p.score,
      }))
      .sort((a, b) => b.score - a.score);
    const top = rows[0];
    // A lone zero-point player is not crowned — nothing was actually won.
    const isDraw =
      !top ||
      top.score === 0 ||
      (rows.length > 1 && rows[1].score === top.score);
    m.phase = 'ended';
    m.endedAt = now;
    m.finalScores = rows;
    m.winner = isDraw ? null : top;
    m.lastBroadcastAt = now;
    this.deps.broadcast(this.getMatchSnapshot());
  }

  private ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), PUBLISH_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private maybeStop(): void {
    // A live match keeps the loop ticking (countdown clock, 1 Hz match
    // broadcast); an ended one only through a short linger — the match object
    // itself stays (results screens read getMatchSnapshot on demand), so the
    // PLAY AGAIN path must not leave the 30 Hz loop running forever.
    const matchHoldsLoop =
      this.match != null &&
      (this.match.phase !== 'ended' ||
        this.match.endedAt == null ||
        this.now() - this.match.endedAt < ENDED_LINGER_MS);
    if (
      this.players.size === 0 &&
      this.deadGhosts.size === 0 &&
      this.bursts.length === 0 &&
      this.dogReveals.length === 0 &&
      this.ducks.size === 0 &&
      !this.hasBirdTarget() &&
      !matchHoldsLoop
    ) {
      this.stop();
      this.store.getState().setShooter(null);
    }
  }

  /** Advance the match clock: countdown → playing → (time mode) ended, plus
   * the 1 Hz shooter_match tick that keeps client countdowns honest. */
  private tickMatch(now: number): void {
    const m = this.match;
    if (!m) return;
    if (m.phase === 'countdown' && now >= m.startsAt) {
      m.phase = 'playing';
      if (m.mode === 'time' && m.durationMs != null) {
        m.endsAt = m.startsAt + m.durationMs;
      }
      m.lastBroadcastAt = now;
      this.deps.broadcast(this.getMatchSnapshot());
      return;
    }
    if (m.phase === 'playing' && m.endsAt != null && now >= m.endsAt) {
      this.endMatch(now);
      return;
    }
    if (m.phase !== 'ended' && now - m.lastBroadcastAt >= MATCH_BROADCAST_MS) {
      m.lastBroadcastAt = now;
      this.deps.broadcast(this.getMatchSnapshot());
    }
  }

  private tick(): void {
    const now = this.now();
    // Real elapsed time since the previous tick — under event-loop lag (GPU
    // encode stalls, sidecar spikes) this exceeds PUBLISH_MS, and anything
    // that "pushes clocks forward" must push by this, not the nominal rate.
    const dt = this.lastTickAt > 0 ? now - this.lastTickAt : PUBLISH_MS;
    this.lastTickAt = now;
    this.tickMatch(now);
    this.pollCameras(now);
    this.reapDisconnected(now);
    // Announce target availability flips (the YOLO sidecar warming up or the
    // ghost input going away) — lobby screens gate "start" on this and joins
    // are the only other trigger for a state broadcast.
    const targetActive = this.getTargetInputId() !== null;
    if (targetActive !== this.lastTargetActive) {
      this.lastTargetActive = targetActive;
      this.broadcastState();
    }
    for (const [id, respawnAt] of this.deadGhosts) {
      if (respawnAt <= now) this.deadGhosts.delete(id);
    }
    this.bursts = this.bursts.filter((b) => now - b.at <= BURST_MS);
    this.dogReveals = this.dogReveals.filter(
      (d) => now - d.at <= DOG_REVEAL_MS,
    );
    // Ease each crosshair toward its latest aim so the broadcast crosshair is
    // smooth even when aim updates arrive irregularly over the network.
    for (const p of this.players.values()) {
      p.dispX += (p.aimX - p.dispX) * CROSSHAIR_SMOOTH;
      p.dispY += (p.aimY - p.dispY) * CROSSHAIR_SMOOTH;
      // Regenerate one round per reloadMs while below the magazine size.
      if (p.reloadStartedAt != null && now - p.reloadStartedAt >= p.reloadMs) {
        p.ammo = Math.min(p.maxAmmo, p.ammo + 1);
        p.reloadStartedAt = p.ammo >= p.maxAmmo ? null : now;
        this.sendAmmo(p.clientId);
      }
    }
    // Advance the duck flock (bird mode) — the authoritative position both the
    // renderer and the hit-test read from.
    this.reconcileDucks(now, dt);
    this.publish();
    this.maybeStop();
  }

  private sendAmmo(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    const reloadRemainingMs =
      p.reloadStartedAt == null
        ? 0
        : Math.max(0, p.reloadMs - (this.now() - p.reloadStartedAt));
    this.deps.sendTo(clientId, {
      type: 'shooter_ammo',
      roomId: this.roomId,
      clientId,
      ammo: p.ammo,
      maxAmmo: p.maxAmmo,
      reloadMs: p.reloadMs,
      reloadRemainingMs,
    });
  }

  private publish(): void {
    const target = this.getTargetPb();
    if (!target) {
      this.store.getState().setShooter(null);
      return;
    }
    const isBird = target.pb.sprite === 'bird';
    // Ghost mode with nobody playing shows no overlay; bird mode keeps the ducks
    // flying on the broadcast even before anyone joins.
    if (this.players.size === 0 && !isBird) {
      this.store.getState().setShooter(null);
      return;
    }
    // Reload countdowns render on the broadcast HUD, so both the crosshair
    // badge and the scoreboard carry the full ammo state per player.
    const ammoState = (p: Player) => ({
      camInputId: p.camInputId ?? undefined,
      camLive: p.camConnected,
      ammo: p.ammo,
      maxAmmo: p.maxAmmo,
      reloadMs: p.reloadMs,
      reloadEndsAt:
        p.reloadStartedAt == null ? null : p.reloadStartedAt + p.reloadMs,
    });
    this.store.getState().setShooter({
      targetInputId: target.id,
      // A disconnected phone can't aim — its crosshair would sit frozen on
      // the broadcast, so only connected players render one. The scoreboard
      // keeps every row (scores survive the disconnect grace).
      crosshairs: [...this.players.values()]
        .filter((p) => p.connected)
        .map((p) => ({
          clientId: p.clientId,
          x: p.dispX,
          y: p.dispY,
          color: p.color,
          name: p.name,
          ...ammoState(p),
        })),
      scores: [...this.players.values()]
        .map((p) => ({
          clientId: p.clientId,
          name: p.name,
          color: p.color,
          score: p.score,
          ...ammoState(p),
        }))
        .sort((a, b) => b.score - a.score),
      bursts: this.bursts,
      dogReveals: this.dogReveals,
      deadGhostIds: [...this.deadGhosts.keys()],
      // deadGhosts stores respawnAt (= diedAt + RESPAWN_MS); recover diedAt so
      // the renderer can time the hang → fall death animation.
      deadGhosts: [...this.deadGhosts.entries()].map(([id, respawnAt]) => ({
        id,
        diedAt: respawnAt - RESPAWN_MS,
      })),
      ducks: isBird ? [...this.ducks.values()] : [],
      match: this.matchOverlay(),
    });
  }

  /** Match chrome for the on-stream HUD (null in free-play). */
  private matchOverlay(): ShooterMatchOverlay | null {
    const m = this.match;
    if (!m) return null;
    return {
      phase: m.phase,
      mode: m.mode,
      targetScore: m.targetScore,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      winner:
        m.phase === 'ended' && m.winner
          ? {
              name: m.winner.name,
              color: m.winner.color,
              score: m.winner.score,
            }
          : null,
      character: m.character
        ? { name: m.character.name, color: m.character.color }
        : null,
    };
  }
}

/** Free-flight timing for a target, with the shared defaults. */
function flightParams(pb: PersonBoxes): DuckFlightParams {
  return {
    pauseMs: pb.duckPauseMs ?? DEFAULT_DUCK_PAUSE_MS,
    flySpeed: pb.duckFlySpeed ?? DEFAULT_DUCK_FLY_FRAC_PER_SEC,
  };
}

/** Output geometry (cover mapping) for projecting duck flight to the screen. */
function duckViewport(
  res: { width: number; height: number },
  pb: PersonBoxes,
): DuckViewport {
  return {
    width: res.width,
    height: res.height,
    frameW: pb.frameW,
    frameH: pb.frameH,
  };
}

