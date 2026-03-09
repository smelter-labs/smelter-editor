import type { ShaderConfig } from '../types';
import type { SnakeEventShaderConfig, SnakeGameState } from './types';

export type SnakeGameInputState = {
  snakeGameState: SnakeGameState;
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

export function toPublicSnakeGameInputState(input: SnakeGameInputState) {
  return {
    gameBackgroundColor: input.snakeGameState.backgroundColor,
    gameCellGap: input.snakeGameState.cellGap,
    gameBoardBorderColor: input.snakeGameState.boardBorderColor,
    gameBoardBorderWidth: input.snakeGameState.boardBorderWidth,
    gameGridLineColor: input.snakeGameState.gridLineColor,
    gameGridLineAlpha: input.snakeGameState.gridLineAlpha,
    snakeEventShaders: input.snakeEventShaders,
    snake1Shaders: input.snake1Shaders,
    snake2Shaders: input.snake2Shaders,
    snakePlayerColors: extractSnakePlayerColors(input.snakeGameState.cells),
  };
}
