import { paddleX } from '../constants';
import { predictAtX } from '../physics';
import type { DifficultyParams } from '../ai-difficulty';
import type { Ball, GameState, Side } from '../types';
import type { PaddleController, ExternalInputs, PaddleIntent } from './types';

// Deterministic small PRNG (mulberry32) — keeps AI noise reproducible in tests.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Sample = { t: number; ball: Ball };

export class AiController implements PaddleController {
  private history: Sample[] = [];
  private rng: () => number;
  private lastSeenBounceTime = -1;
  private cachedNoise = 0;

  constructor(
    private readonly diff: DifficultyParams,
    seed = 0xc0ffee,
  ) {
    this.rng = mulberry32(seed);
  }

  update(_dt: number, state: GameState, side: Side, _inputs: ExternalInputs): PaddleIntent {
    this.history.push({ t: state.now, ball: { ...state.ball } });
    while (
      this.history.length > 1 &&
      state.now - this.history[0]!.t > this.diff.reactionLagSec + 0.5
    ) {
      this.history.shift();
    }

    const targetTime = state.now - this.diff.reactionLagSec;
    let snapshot: Sample = this.history[0]!;
    for (const h of this.history) {
      if (h.t <= targetTime) snapshot = h;
      else break;
    }

    // Re-sample aim noise on each new bounce so the AI's "aim point" varies
    // between rally segments but stays steady within a segment (no jitter).
    if (state.lastBounce && state.lastBounce.time !== this.lastSeenBounceTime) {
      this.lastSeenBounceTime = state.lastBounce.time;
      this.cachedNoise = (this.rng() * 2 - 1) * this.diff.aimNoise;
    }

    const myX = paddleX(side);
    const predicted = predictAtX(snapshot.ball, myX, this.diff.predictBounces);

    return {
      kind: 'absolute',
      targetY: predicted + this.cachedNoise,
      maxSpeed: this.diff.maxSpeed,
    };
  }

  reset(): void {
    this.history = [];
    this.lastSeenBounceTime = -1;
    this.cachedNoise = 0;
  }
}
