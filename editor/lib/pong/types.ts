export type Vec2 = { x: number; y: number };

export type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type Paddle = {
  y: number;
};

export type Side = 'left' | 'right';

export type BounceKind = 'wall' | 'paddle';

export type BounceEvent = {
  time: number;
  x: number;
  y: number;
  kind: BounceKind;
};

export type GamePhase = 'idle' | 'countdown' | 'playing' | 'pointScored' | 'matchOver';

export type Score = { left: number; right: number };

export type GameState = {
  ball: Ball;
  paddles: { left: Paddle; right: Paddle };
  score: Score;
  phase: GamePhase;
  phaseTime: number;
  now: number;
  servingSide: Side;
  lastWinner: Side | null;
  lastBounce: BounceEvent | null;
};

export type MatchConfig = {
  firstTo: number;
  countdownSec: number;
  pointScoredPauseSec: number;
};

export type Difficulty = 'easy' | 'medium' | 'hard';
