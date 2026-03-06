import React from 'react';
import { GameBoard } from './GameBoard';
import { registerInputRenderer } from '../inputs/rendererRegistry';

registerInputRenderer('game', (config, resolution) => {
  return (
    <GameBoard
      gameState={config.gameState!}
      resolution={resolution}
      snake1Shaders={config.snake1Shaders}
      snake2Shaders={config.snake2Shaders}
    />
  );
});
