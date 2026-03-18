import type { SnakeEventType } from '../snakeGame/types';
import type { RoomInputState } from './types';
import {
  buildUpdatedSnakeGameState,
  processSnakeGameEvents,
} from '../snakeGame/snakeGameState';

type GameInput = RoomInputState & { type: 'game' };
type IncomingSnakeGameState = Parameters<typeof buildUpdatedSnakeGameState>[1];

export class SnakeGameController {
  updateGameState(
    input: GameInput,
    incomingState: IncomingSnakeGameState,
    events: { type: SnakeEventType }[] | undefined,
    onStoreUpdate: () => void,
  ): void {
    input.snakeGameState = buildUpdatedSnakeGameState(
      input.snakeGameState,
      incomingState,
    );
    console.log(
      `[game] Updated snake board: ${incomingState.cells.length} cells on ${incomingState.board.width}x${incomingState.board.height}`,
    );

    if (events && events.length > 0) {
      this.ingestGameEvents(input, events, onStoreUpdate);
    } else {
      onStoreUpdate();
    }
  }

  ingestGameEvents(
    input: GameInput,
    events: { type: SnakeEventType }[],
    onStoreUpdate: () => void,
  ): void {
    if (!events || events.length === 0) return;

    const result = processSnakeGameEvents(
      events,
      input.snakeGameState,
      input.activeEffects,
      input.snakeEventShaders,
      onStoreUpdate,
    );

    if (result.needsStoreUpdate) {
      input.activeEffects = result.updatedActiveEffects;
      input.effectTimers.push(...result.newTimers);
      onStoreUpdate();
    }
  }
}
