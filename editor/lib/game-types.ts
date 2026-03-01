import type { ShaderParamConfig } from '@/app/actions/actions';

export type SnakeEventType =
  | 'speed_up'
  | 'cut_opponent'
  | 'got_cut'
  | 'cut_self'
  | 'eat_block'
  | 'bounce_block'
  | 'no_moves'
  | 'game_over';

export type SnakeEventApplicationMode =
  | { mode: 'all' }
  | { mode: 'snake_cells' }
  | { mode: 'first_n'; n: number }
  | { mode: 'sequential'; durationMs: number; delayMs: number };

export type SnakeEventShaderMapping = {
  enabled: boolean;
  shaderId: string;
  params: ShaderParamConfig[];
  application: SnakeEventApplicationMode;
  effectDurationMs: number;
};

export type SnakeEventShaderConfig = Partial<
  Record<SnakeEventType, SnakeEventShaderMapping>
>;
