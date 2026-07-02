import type { StoreApi } from 'zustand';
import type { RoomStore, ShooterBurst } from '../app/store';
import { roomEventBus } from '../core/roomEventBus';

type Player = {
  clientId: string;
  name: string;
  color: string;
  aimX: number;
  aimY: number;
  score: number;
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
const BURST_MS = 600; // hit-effect lifetime
const PUBLISH_MS = 33; // ~30Hz overlay refresh while the game is active
const HIT_FACTOR = 1.2; // hitbox radius ~ visible (scaled-up) ghost size

/**
 * Ghost Shooter game logic for one room. Phones send aim (gyroscope) + fire
 * over the room WebSocket; this controller tracks players, hit-tests shots
 * against the live ghost boxes, manages shot-down/respawn, and publishes the
 * crosshair/scoreboard/hit overlay into the Smelter render store.
 *
 * The "target" is whichever input currently renders ghosts (peopleBoxes.ghost).
 * Aim is in normalized content space [0,1] — the same space as the ghost boxes.
 */
export class GhostShooterController {
  private readonly players = new Map<string, Player>();
  /** ghostId -> respawnAt (ms) for the current target input. */
  private readonly deadGhosts = new Map<number, number>();
  private bursts: ShooterBurst[] = [];
  private nextBurstId = 1;
  private colorSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

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
        score: 0,
      });
    }
    this.ensureRunning();
    this.publish();
    this.broadcastState();
  }

  leave(clientId: string): void {
    if (!this.players.delete(clientId)) return;
    this.publish();
    this.broadcastState();
    this.maybeStop();
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

    const targetId = this.getTargetInputId();
    const pb = targetId
      ? this.store.getState().peopleBoxes[targetId]
      : undefined;
    if (!pb || pb.boxes.length === 0) {
      this.sendMiss(clientId);
      return;
    }

    let best: { id: number; cx: number; cy: number; dist: number } | null =
      null;
    for (const b of pb.boxes) {
      if (this.deadGhosts.has(b.id)) continue;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      // Work in pixels so the hitbox is a screen-circle, not an ellipse.
      const dxPx = (p.aimX - cx) * pb.frameW;
      const dyPx = (p.aimY - cy) * pb.frameH;
      const dist = Math.hypot(dxPx, dyPx);
      const radius = HIT_FACTOR * Math.max(b.w * pb.frameW, b.h * pb.frameH);
      if (dist <= radius && (!best || dist < best.dist)) {
        best = { id: b.id, cx, cy, dist };
      }
    }

    if (!best) {
      this.sendMiss(clientId);
      return;
    }

    const now = Date.now();
    this.deadGhosts.set(best.id, now + RESPAWN_MS);
    p.score += 1;
    this.bursts.push({ id: this.nextBurstId++, x: best.cx, y: best.cy, at: now });
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

  dispose(): void {
    this.stop();
    this.players.clear();
    this.deadGhosts.clear();
    this.bursts = [];
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
      this.bursts.length === 0
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
    this.publish();
    this.maybeStop();
  }

  private publish(): void {
    const targetId = this.getTargetInputId();
    if (!targetId || this.players.size === 0) {
      this.store.getState().setShooter(null);
      return;
    }
    this.store.getState().setShooter({
      targetInputId: targetId,
      crosshairs: [...this.players.values()].map((p) => ({
        clientId: p.clientId,
        x: p.aimX,
        y: p.aimY,
        color: p.color,
        name: p.name,
      })),
      scores: [...this.players.values()]
        .map((p) => ({ name: p.name, color: p.color, score: p.score }))
        .sort((a, b) => b.score - a.score),
      bursts: this.bursts,
      deadGhostIds: [...this.deadGhosts.keys()],
    });
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
