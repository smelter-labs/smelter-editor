import type { ShaderConfig } from '../shaders/shaders';
import type { SnakeEventShaderConfig, GameState } from './types';

export type GameInputState = {
  gameState: GameState;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
};

export function extractSnakePlayerColors(
  cells: Array<{ color: string; isHead?: boolean }>,
): string[] {
  const orderedHeadColors: string[] = [];
  for (const cell of cells) {
    if (!cell.isHead) continue;
    if (!orderedHeadColors.includes(cell.color)) {
      orderedHeadColors.push(cell.color);
    }
  }

  if (orderedHeadColors.length > 0) {
    return orderedHeadColors;
  }

  const fallbackUniqueColors: string[] = [];
  for (const cell of cells) {
    if (!fallbackUniqueColors.includes(cell.color)) {
      fallbackUniqueColors.push(cell.color);
    }
  }
  return fallbackUniqueColors;
}

export function toPublicGameInputState(input: GameInputState) {
  return {
    gameBackgroundColor: input.gameState.backgroundColor,
    gameCellGap: input.gameState.cellGap,
    gameBoardBorderColor: input.gameState.boardBorderColor,
    gameBoardBorderWidth: input.gameState.boardBorderWidth,
    gameGridLineColor: input.gameState.gridLineColor,
    gameGridLineAlpha: input.gameState.gridLineAlpha,
    snakeEventShaders: input.snakeEventShaders,
    snake1Shaders: input.snake1Shaders,
    snake2Shaders: input.snake2Shaders,
    snakePlayerColors: extractSnakePlayerColors(input.gameState.cells),
  };
}
