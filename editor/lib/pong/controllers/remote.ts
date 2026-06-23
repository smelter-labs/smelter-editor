import { PADDLE_DEFAULT_MAX_SPEED } from '../constants';
import type { GameState, Side } from '../types';
import type { ExternalInputs, PaddleController, PaddleIntent } from './types';

export class RemotePaddleController implements PaddleController {
  private targetY = 0.5;

  setTargetY(y: number): void {
    this.targetY = y;
  }

  update(
    _dt: number,
    _state: GameState,
    _side: Side,
    _inputs: ExternalInputs,
  ): PaddleIntent {
    return {
      kind: 'absolute',
      targetY: this.targetY,
      maxSpeed: PADDLE_DEFAULT_MAX_SPEED,
    };
  }

  reset(): void {
    this.targetY = 0.5;
  }
}
