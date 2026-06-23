import { BALL_INITIAL_SPEED, BALL_RADIUS } from './constants';
import { collidePaddle, collideWalls, integrate, serveVelocity } from './physics';
import { applyIntent } from './controllers/types';
import type { PaddleIntent } from './controllers/types';
import type { GameState, MatchConfig, Side } from './types';

export function createInitialState(): GameState {
  return {
    ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: { left: { y: 0.5 }, right: { y: 0.5 } },
    score: { left: 0, right: 0 },
    phase: 'idle',
    phaseTime: 0,
    now: 0,
    servingSide: 'right',
    lastWinner: null,
    lastBounce: null,
  };
}

export function startMatch(state: GameState): GameState {
  return {
    ...state,
    score: { left: 0, right: 0 },
    phase: 'countdown',
    phaseTime: 0,
    lastWinner: null,
    lastBounce: null,
    ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
  };
}

export function resetMatch(): GameState {
  return createInitialState();
}

// Deterministic serve angle (no RNG) so tests can predict outcomes.
// Alternates sign with total points so consecutive serves diverge.
function serveAngle(state: GameState): number {
  const total = state.score.left + state.score.right;
  return total % 2 === 0 ? 0.2 : -0.2;
}

export function tick(
  state: GameState,
  dt: number,
  intents: { left: PaddleIntent; right: PaddleIntent },
  config: MatchConfig,
): GameState {
  let next: GameState = {
    ...state,
    now: state.now + dt,
    phaseTime: state.phaseTime + dt,
  };

  if (state.phase !== 'matchOver') {
    next.paddles = {
      left: applyIntent(state.paddles.left, intents.left, dt),
      right: applyIntent(state.paddles.right, intents.right, dt),
    };
  }

  switch (state.phase) {
    case 'idle':
    case 'matchOver':
      break;

    case 'countdown':
      next.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
      if (next.phaseTime >= config.countdownSec) {
        const v = serveVelocity(next.servingSide, BALL_INITIAL_SPEED, serveAngle(next));
        next = {
          ...next,
          phase: 'playing',
          phaseTime: 0,
          ball: { x: 0.5, y: 0.5, vx: v.vx, vy: v.vy },
        };
      }
      break;

    case 'playing': {
      let ball = integrate(next.ball, dt);

      const wallRes = collideWalls(ball, next.now);
      ball = wallRes.ball;
      if (wallRes.event) next.lastBounce = wallRes.event;

      const lRes = collidePaddle(ball, next.paddles.left, 'left', next.now);
      ball = lRes.ball;
      if (lRes.event) next.lastBounce = lRes.event;

      const rRes = collidePaddle(ball, next.paddles.right, 'right', next.now);
      ball = rRes.ball;
      if (rRes.event) next.lastBounce = rRes.event;

      next.ball = ball;

      // Goal check.
      let scoredBy: Side | null = null;
      if (ball.x < -BALL_RADIUS) scoredBy = 'right';
      else if (ball.x > 1 + BALL_RADIUS) scoredBy = 'left';

      if (scoredBy) {
        const newScore = {
          ...next.score,
          [scoredBy]: next.score[scoredBy] + 1,
        };
        const matchOver = newScore[scoredBy] >= config.firstTo;
        next = {
          ...next,
          score: newScore,
          phase: matchOver ? 'matchOver' : 'pointScored',
          phaseTime: 0,
          lastWinner: scoredBy,
          servingSide: scoredBy === 'left' ? 'right' : 'left',
          ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        };
      }
      break;
    }

    case 'pointScored':
      if (next.phaseTime >= config.pointScoredPauseSec) {
        next = { ...next, phase: 'countdown', phaseTime: 0 };
      }
      break;
  }

  return next;
}
