import type { ShaderConfig } from '@smelter-editor/types';
import type { GameState, MatchConfig } from './types';

export const PONG_SHADER_ID = 'pong';

// Sparse per-frame override map: mode + manual_* fields + live score + countdown.
// Sent over WS as a *partial* update — the server merges these into the shader's
// current params so user-driven slider edits (ball_radius, colors, etc.) aren't
// clobbered by our 30Hz pushes.
export function buildPongParamUpdates(
  gameState: GameState,
  mode: 0 | 1,
  matchConfig: MatchConfig,
): Record<string, number> {
  const lb = gameState.lastBounce;
  const countdownRemaining =
    gameState.phase === 'countdown'
      ? Math.max(0, matchConfig.countdownSec - gameState.phaseTime)
      : 0;
  return {
    mode,
    manual_ball_x: gameState.ball.x,
    manual_ball_y: gameState.ball.y,
    manual_vel_x: gameState.ball.vx,
    manual_vel_y: gameState.ball.vy,
    manual_paddle_l_y: gameState.paddles.left.y,
    manual_paddle_r_y: gameState.paddles.right.y,
    manual_last_bounce_time: lb?.time ?? -1000,
    manual_last_bounce_x: lb?.x ?? 0.5,
    manual_last_bounce_y: lb?.y ?? 0.5,
    manual_last_bounce_kind: lb?.kind === 'paddle' ? 1 : 0,
    manual_countdown_remaining: countdownRemaining,
    score_left: gameState.score.left,
    score_right: gameState.score.right,
  };
}

export function hasPongShader(shaders: ShaderConfig[]): boolean {
  return shaders.some((s) => s.shaderId === PONG_SHADER_ID);
}
