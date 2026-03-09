import React from 'react';
import { SnakeGameBoard } from './SnakeGameBoard';
import { registerInputRenderer } from '../inputs/rendererRegistry';

registerInputRenderer('game', (config, resolution) => {
  return (
    <SnakeGameBoard
      snakeGameState={config.snakeGameState!}
      resolution={resolution}
      snake1Shaders={config.snake1Shaders}
      snake2Shaders={config.snake2Shaders}
    />
  );
});
