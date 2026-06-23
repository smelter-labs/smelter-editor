import type { PongNetGameState } from '@smelter-editor/types';
import type { GameState } from './types';

export function toNetGameState(state: GameState): PongNetGameState {
  return {
    ball: { ...state.ball },
    paddles: {
      left: { y: state.paddles.left.y },
      right: { y: state.paddles.right.y },
    },
    score: { ...state.score },
    phase: state.phase,
    phaseTime: state.phaseTime,
    now: state.now,
    servingSide: state.servingSide,
    lastWinner: state.lastWinner,
    lastBounce: state.lastBounce ? { ...state.lastBounce } : null,
  };
}

export function fromNetGameState(state: PongNetGameState): GameState {
  return {
    ball: { ...state.ball },
    paddles: {
      left: { y: state.paddles.left.y },
      right: { y: state.paddles.right.y },
    },
    score: { ...state.score },
    phase: state.phase,
    phaseTime: state.phaseTime,
    now: state.now,
    servingSide: state.servingSide,
    lastWinner: state.lastWinner,
    lastBounce: state.lastBounce ? { ...state.lastBounce } : null,
  };
}
