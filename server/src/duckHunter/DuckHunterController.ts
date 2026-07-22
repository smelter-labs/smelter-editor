import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoreApi } from 'zustand';
import type {
  DogReveal,
  PersonBoxes,
  RoomStore,
  ShooterBurst,
} from '../app/store';
import { roomEventBus } from '../core/roomEventBus';
import { DATA_DIR } from '../dataDir';
import { SmelterInstance } from '../smelter';
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

type Player = {
  clientId: string;
  name: string;
  color: string;
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
  /** Latest camera snapshot registered in Smelter (shown next to the name). */
  avatar: { imageId: string; filePath: string } | null;
  /** Wall-clock ms of the last accepted avatar snapshot (rate limit). */
  lastAvatarAt: number;
};

/** Per-player ammo config sent from the phone (calibration screen). */
export type AmmoConfig = { maxAmmo?: number; reloadMs?: number };

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
const DOG_REVEAL_MS = 1500; // how long the dog stays on screen per pop-up
const PUBLISH_MS = 33; // ~30Hz overlay refresh while the game is active
// Hit radius as a fraction of the visible sprite side. The sprite footprint
// itself comes from the shared duck model (duckSidePx), so the hitbox always
// tracks the drawn duck — across zoom levels and the operator's duckScale.
const HIT_FACTOR = 0.55;
const CROSSHAIR_SMOOTH = 0.5; // eases the broadcast crosshair toward the aim

// Ammo defaults + bounds (players tune within these on the calibration screen).
const DEFAULT_MAX_AMMO = 3;
const DEFAULT_RELOAD_MS = 5000;
const MAX_AMMO_CAP = 12;
const MIN_RELOAD_MS = 1000;
const MAX_RELOAD_MS = 30000;

// Avatar snapshots (phone camera → broadcast): accept at most one every
// AVATAR_MIN_INTERVAL_MS per player and cap the decoded JPEG size.
const AVATAR_MIN_INTERVAL_MS = 1500;
const AVATAR_MAX_BYTES = 256 * 1024;
// A replaced avatar image stays registered briefly so an in-flight frame that
// still references the old imageId can't hit a missing Smelter resource.
const AVATAR_UNREGISTER_DELAY_MS = 3000;

/** Keep ids/filenames to safe characters (clientId is a uuid, but be strict). */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

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
  private nextAvatarSeq = 1;
  private colorSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Room-wide ammo rules, set by the operator in the Duck Hunter panel and
  // applied to every player (current + future joiners).
  private roomMaxAmmo = DEFAULT_MAX_AMMO;
  private roomReloadMs = DEFAULT_RELOAD_MS;

  constructor(
    private readonly roomId: string,
    private readonly store: StoreApi<RoomStore>,
  ) {}

  join(clientId: string, name: string): void {
    if (!this.players.has(clientId)) {
      this.players.set(clientId, {
        clientId,
        name: name.slice(0, 24) || 'Player',
        color: PLAYER_COLORS[this.colorSeq++ % PLAYER_COLORS.length],
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
        avatar: null,
        lastAvatarAt: 0,
      });
    } else {
      // Already joined (e.g. re-entering after the calibration screen): keep the
      // player but refresh the chosen name.
      const p = this.players.get(clientId)!;
      p.name = name.slice(0, 24) || p.name;
    }
    this.ensureRunning();
    this.publish();
    this.broadcastState();
    this.sendAmmo(clientId);
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
      else if (p.reloadStartedAt == null) p.reloadStartedAt = Date.now();
      this.sendAmmo(p.clientId);
    }
  }

  /** Current room-wide ammo rules (for the panel to read back). */
  getRoomConfig(): { maxAmmo: number; reloadMs: number } {
    return { maxAmmo: this.roomMaxAmmo, reloadMs: this.roomReloadMs };
  }

  leave(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p || !this.players.delete(clientId)) return;
    if (p.avatar) {
      this.retireAvatar(p.avatar);
      p.avatar = null;
    }
    this.publish();
    this.broadcastState();
    this.maybeStop();
  }

  /**
   * Camera snapshot from the phone (small JPEG data URL). Saved to disk and
   * registered as a Smelter image so the HUD can draw it next to the player's
   * name; the previous snapshot is retired after a grace period.
   */
  async setAvatar(clientId: string, dataUrl: string): Promise<void> {
    const p = this.players.get(clientId);
    if (!p) return;
    // Empty payload = the player turned their camera off; drop the avatar.
    if (dataUrl === '') {
      if (p.avatar) {
        this.retireAvatar(p.avatar);
        p.avatar = null;
        this.publish();
      }
      return;
    }
    const now = Date.now();
    if (now - p.lastAvatarAt < AVATAR_MIN_INTERVAL_MS) return;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return;
    const bytes = Buffer.from(m[1], 'base64');
    if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return;
    p.lastAvatarAt = now;

    const seq = this.nextAvatarSeq++;
    const dir = path.join(DATA_DIR, 'shooter-avatars', sanitizeId(this.roomId));
    const filePath = path.join(dir, `${sanitizeId(clientId)}-${seq}.jpg`);
    const imageId = `shooter-avatar::${this.roomId}::${clientId}::${seq}`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, bytes);
      await SmelterInstance.registerImage(imageId, {
        serverPath: filePath,
        assetType: 'jpeg',
      });
    } catch (err) {
      console.error(`[duck-hunter] avatar register failed for ${clientId}`, err);
      await fs.rm(filePath, { force: true }).catch(() => {});
      return;
    }
    // The player may have left (or rejoined as a new entry) while we awaited.
    if (this.players.get(clientId) !== p) {
      this.retireAvatar({ imageId, filePath });
      return;
    }
    const prev = p.avatar;
    p.avatar = { imageId, filePath };
    if (prev) this.retireAvatar(prev);
    this.publish();
  }

  /** Unregister + delete a swapped-out avatar after the render grace period. */
  private retireAvatar(avatar: { imageId: string; filePath: string }): void {
    setTimeout(() => {
      SmelterInstance.unregisterImage(avatar.imageId).catch(() => {});
      void fs.rm(avatar.filePath, { force: true }).catch(() => {});
    }, AVATAR_UNREGISTER_DELAY_MS);
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

    // Out of ammo: no shot, just tell the phone to click empty.
    if (p.ammo <= 0) {
      roomEventBus.sendTo(this.roomId, clientId, {
        type: 'shooter_empty',
        roomId: this.roomId,
        clientId,
      });
      this.sendAmmo(clientId);
      return;
    }
    // Spend a round (starts the reload cycle if the mag was full).
    p.ammo -= 1;
    if (p.reloadStartedAt == null) p.reloadStartedAt = Date.now();
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

    const now = Date.now();
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
    roomEventBus.sendTo(this.roomId, clientId, {
      type: 'shooter_hit',
      roomId: this.roomId,
      clientId,
      ghostId: best.id,
      score: p.score,
    });
    this.publish();
    this.broadcastState();
  }

  /** Handle WS disconnect for a client (may or may not be a player). */
  handleDisconnect(clientId: string): void {
    this.leave(clientId);
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
    for (const p of this.players.values()) {
      if (p.avatar) this.retireAvatar(p.avatar);
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
    const now = Date.now();
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
  private reconcileDucks(now: number): void {
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
          this.deadGhosts.has(b.id)
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
        d.spawnAt += PUBLISH_MS;
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
    roomEventBus.sendTo(this.roomId, clientId, {
      type: 'shooter_miss',
      roomId: this.roomId,
      clientId,
    });
  }

  private broadcastState(): void {
    roomEventBus.broadcast(this.roomId, {
      type: 'shooter_state',
      roomId: this.roomId,
      players: [...this.players.values()].map((p) => ({
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        score: p.score,
      })),
      targetActive: this.getTargetInputId() !== null,
    });
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
    if (
      this.players.size === 0 &&
      this.deadGhosts.size === 0 &&
      this.bursts.length === 0 &&
      this.dogReveals.length === 0 &&
      this.ducks.size === 0 &&
      !this.hasBirdTarget()
    ) {
      this.stop();
      this.store.getState().setShooter(null);
    }
  }

  private tick(): void {
    const now = Date.now();
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
    this.reconcileDucks(now);
    this.publish();
    this.maybeStop();
  }

  private sendAmmo(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    const reloadRemainingMs =
      p.reloadStartedAt == null
        ? 0
        : Math.max(0, p.reloadMs - (Date.now() - p.reloadStartedAt));
    roomEventBus.sendTo(this.roomId, clientId, {
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
      avatarImageId: p.avatar?.imageId,
      ammo: p.ammo,
      maxAmmo: p.maxAmmo,
      reloadMs: p.reloadMs,
      reloadEndsAt:
        p.reloadStartedAt == null ? null : p.reloadStartedAt + p.reloadMs,
    });
    this.store.getState().setShooter({
      targetInputId: target.id,
      crosshairs: [...this.players.values()].map((p) => ({
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
    });
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
