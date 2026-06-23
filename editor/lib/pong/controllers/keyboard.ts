import { PADDLE_DEFAULT_MAX_SPEED } from '../constants';
import type { PaddleController, ExternalInputs, PaddleIntent } from './types';

export class KeyboardController implements PaddleController {
  constructor(private readonly maxSpeed: number = PADDLE_DEFAULT_MAX_SPEED) {}

  update(_dt: number, _state: unknown, _side: unknown, inputs: ExternalInputs): PaddleIntent {
    const up = inputs.keyboard.upHeld;
    const down = inputs.keyboard.downHeld;
    const direction: -1 | 0 | 1 = up === down ? 0 : up ? -1 : 1;
    return { kind: 'relative', direction, maxSpeed: this.maxSpeed };
  }
}
