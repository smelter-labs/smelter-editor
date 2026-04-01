import type {
  ShaderParamConfig,
  SnakeEventType,
  SnakeEventShaderConfig,
} from '@smelter-editor/types';

export type {
  SnakeEventType,
  
  SnakeEventShaderMapping,
  SnakeEventShaderConfig,
} from '@smelter-editor/types';

export type SnakeGameCell = {
  x: number;
  y: number;
  color: string;
  size?: number;
  isHead?: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Interpolation progress 0→1 from previous grid position to current (x,y). */
  progress?: number;
};

export type ActiveSnakeEffect = {
  eventType: SnakeEventType;
  shaderId: string;
  params: ShaderParamConfig[];
  affectedCellIndices: number[];
  startedAtMs: number;
  endsAtMs: number;
};

export type SnakeGameState = {
  boardWidth: number;
  boardHeight: number;
  cellSize: number;
  cells: SnakeGameCell[];
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
  gameOverData?: SnakeGameOverData;
};

export type SnakeGameOverPlayer = {
  name: string;
  score: number;
  eaten: number;
  cuts: number;
  color: string;
};

export type SnakeGameOverData = {
  winnerName: string;
  reason: string;
  players: SnakeGameOverPlayer[];
};
