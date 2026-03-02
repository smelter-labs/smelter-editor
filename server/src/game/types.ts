import type { ShaderParamConfig } from '../shaders/shaders';

export type GameCell = {
  x: number;
  y: number;
  color: string;
  size?: number;
  isHead?: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Interpolation progress 0→1 from previous grid position to current (x,y). */
  progress?: number;
};

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

export type SnakeEventShaderConfig = Partial<Record<SnakeEventType, SnakeEventShaderMapping>>;

export type ActiveSnakeEffect = {
  eventType: SnakeEventType;
  shaderId: string;
  params: ShaderParamConfig[];
  affectedCellIndices: number[];
  startedAtMs: number;
  endsAtMs: number;
};

export type GameState = {
  boardWidth: number;
  boardHeight: number;
  cellSize: number;
  cells: GameCell[];
  smoothMove?: boolean;
  smoothMoveSpeed?: number;
  smoothMoveAccel?: number;
  smoothMoveDecel?: number;
  backgroundColor: string;
  cellGap: number;
  boardBorderColor: string;
  boardBorderWidth: number;
  gridLineColor: string;
  gridLineAlpha: number;
  activeEffects?: ActiveSnakeEffect[];
  gameOverData?: GameOverData;
};

export type GameOverPlayer = {
  name: string;
  score: number;
  eaten: number;
  cuts: number;
  color: string;
};

export type GameOverData = {
  winnerName: string;
  reason: string;
  players: GameOverPlayer[];
};
