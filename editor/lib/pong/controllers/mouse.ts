import { PADDLE_DEFAULT_MAX_SPEED } from '../constants';
import type { GameState, Side } from '../types';
import type { PaddleController, ExternalInputs, PaddleIntent } from './types';

export class MouseController implements PaddleController {
  constructor(private readonly maxSpeed: number = PADDLE_DEFAULT_MAX_SPEED) {}

  update(_dt: number, state: GameState, side: Side, inputs: ExternalInputs): PaddleIntent {
    const y = inputs.mouse.y;
    if (y == null) {
      // No mouse → hold position.
      return { kind: 'absolute', targetY: state.paddles[side].y, maxSpeed: this.maxSpeed };
    }
    return { kind: 'absolute', targetY: y, maxSpeed: this.maxSpeed };
  }
}
