import type {
  GameState,
  SnakeEventShaderConfig,
  SnakeEventShaderMapping,
  SnakeEventType,
  ActiveSnakeEffect,
} from '../game/types';

function makeSnakeEffectMapping(
  effectType: number,
  color: string,
  intensity: number,
  durationMs: number,
  application: SnakeEventShaderMapping['application'] = { mode: 'all' },
): SnakeEventShaderMapping {
  return {
    enabled: true,
    shaderId: 'snake-event-highlight',
    params: [
      { paramName: 'effect_type', paramValue: effectType },
      { paramName: 'intensity', paramValue: intensity },
      { paramName: 'effect_color', paramValue: color },
      { paramName: 'progress', paramValue: 0 },
    ],
    application,
    effectDurationMs: durationMs,
  };
}

export const DEFAULT_SNAKE_EVENT_SHADERS: SnakeEventShaderConfig = {
  // speed_up: quick shake to convey acceleration
  speed_up: makeSnakeEffectMapping(3, '#00ccff', 0.5, 400),
  // cut_opponent: dramatic chromatic burst in red-orange
  cut_opponent: makeSnakeEffectMapping(7, '#ff4400', 0.8, 500),
  // got_cut: bright red flash — you got hit
  got_cut: makeSnakeEffectMapping(2, '#ff0000', 0.9, 600),
  // cut_self: dark vignette pulse in purple — self-harm
  cut_self: makeSnakeEffectMapping(6, '#8800ff', 0.7, 700),
  // eat_block: green pulse glow — reward feedback
  eat_block: makeSnakeEffectMapping(1, '#00ff66', 0.6, 350),
  // bounce_block: ripple distortion in yellow
  bounce_block: makeSnakeEffectMapping(5, '#ffcc00', 0.5, 400),
  // no_moves: slow pixelation fade in gray
  no_moves: makeSnakeEffectMapping(8, '#888888', 0.6, 800),
  // game_over: heavy dark vignette in deep red, long duration
  game_over: makeSnakeEffectMapping(6, '#cc0000', 1.0, 1500),
};

export function createDefaultGameInputState(title?: string) {
  return {
    gameState: {
      boardWidth: 20,
      boardHeight: 20,
      cellSize: 1,
      cells: [],
      smoothMove: false,
      smoothMoveSpeed: 1,
      smoothMoveAccel: 3.2,
      smoothMoveDecel: 1.18,
      backgroundColor: '#1e222c',
      cellGap: 2,
      boardBorderColor: '#000000',
      boardBorderWidth: 4,
      gridLineColor: '#000000',
      gridLineAlpha: 1.0,
    } satisfies GameState,
    snakeEventShaders: { ...DEFAULT_SNAKE_EVENT_SHADERS } as SnakeEventShaderConfig,
    activeEffects: [] as ActiveSnakeEffect[],
    effectTimers: [] as NodeJS.Timeout[],
    metadata: {
      title: title ?? 'Game',
      description: '',
    },
  };
}

export function buildUpdatedGameState(
  currentGameState: GameState,
  incomingGameState: {
    board: { width: number; height: number; cellSize: number; cellGap?: number };
    cells: { x: number; y: number; color: string; size?: number; isHead?: boolean; direction?: 'up' | 'down' | 'left' | 'right'; progress?: number }[];
    smoothMove?: boolean;
    smoothMoveSpeed?: number;
    smoothMoveAccel?: number;
    smoothMoveDecel?: number;
    backgroundColor: string;
    gameOverData?: { winnerName: string; reason: string; players: { name: string; score: number; eaten: number; cuts: number; color: string }[] };
  },
): GameState {
  return {
    boardWidth: incomingGameState.board.width,
    boardHeight: incomingGameState.board.height,
    cellSize: incomingGameState.board.cellSize,
    cells: incomingGameState.cells,
    smoothMove: incomingGameState.smoothMove === true,
    smoothMoveSpeed:
      typeof incomingGameState.smoothMoveSpeed === 'number' &&
      Number.isFinite(incomingGameState.smoothMoveSpeed) &&
      incomingGameState.smoothMoveSpeed > 0
        ? incomingGameState.smoothMoveSpeed
        : 1,
    smoothMoveAccel:
      typeof incomingGameState.smoothMoveAccel === 'number' &&
      Number.isFinite(incomingGameState.smoothMoveAccel) &&
      incomingGameState.smoothMoveAccel > 0
        ? incomingGameState.smoothMoveAccel
        : 3.2,
    smoothMoveDecel:
      typeof incomingGameState.smoothMoveDecel === 'number' &&
      Number.isFinite(incomingGameState.smoothMoveDecel) &&
      incomingGameState.smoothMoveDecel > 0
        ? incomingGameState.smoothMoveDecel
        : 1.18,
    backgroundColor: currentGameState.backgroundColor || incomingGameState.backgroundColor,
    cellGap: currentGameState.cellGap || incomingGameState.board.cellGap || 0,
    boardBorderColor: currentGameState.boardBorderColor ?? currentGameState.gridLineColor ?? '#000000',
    boardBorderWidth: currentGameState.boardBorderWidth ?? 4,
    gridLineColor: currentGameState.gridLineColor ?? '#000000',
    gridLineAlpha: currentGameState.gridLineAlpha ?? 1.0,
    gameOverData: incomingGameState.gameOverData,
  };
}

export type ProcessGameEventsResult = {
  updatedActiveEffects: ActiveSnakeEffect[];
  newTimers: NodeJS.Timeout[];
  needsStoreUpdate: boolean;
};

export function processGameEvents(
  events: { type: SnakeEventType }[],
  gameState: GameState,
  activeEffects: ActiveSnakeEffect[],
  config: SnakeEventShaderConfig | undefined,
  onStoreUpdate: () => void,
): ProcessGameEventsResult {
  if (!config) return { updatedActiveEffects: activeEffects, newTimers: [], needsStoreUpdate: false };

  const now = Date.now();
  let currentEffects = [...activeEffects];
  const newTimers: NodeJS.Timeout[] = [];

  for (const event of events) {
    const mapping = config[event.type];
    if (!mapping || !mapping.enabled) continue;

    const effectDurationMs = mapping.effectDurationMs || 600;

    let affectedCellIndices: number[] = [];
    const cells = gameState.cells;
    const totalCells = cells.length;

    // Build snake cell indices (cells belonging to a snake, identified by sharing color with a head)
    const snakeColorsSet = new Set<string>();
    for (const cell of cells) {
      if (cell.isHead) snakeColorsSet.add(cell.color);
    }
    const snakeCellIndices = cells
      .map((cell, i) => (cell.isHead || snakeColorsSet.has(cell.color)) ? i : -1)
      .filter(i => i !== -1);

    if (mapping.application.mode === 'all') {
      affectedCellIndices = Array.from({ length: totalCells }, (_, i) => i);
    } else if (mapping.application.mode === 'snake_cells') {
      affectedCellIndices = snakeCellIndices;
    } else if (mapping.application.mode === 'first_n') {
      const n = Math.min(mapping.application.n, snakeCellIndices.length);
      affectedCellIndices = snakeCellIndices.slice(0, n);
    } else if (mapping.application.mode === 'sequential') {
      affectedCellIndices = snakeCellIndices.length > 0 ? [snakeCellIndices[0]] : [];
    }

    const effect: ActiveSnakeEffect = {
      eventType: event.type,
      shaderId: mapping.shaderId,
      params: mapping.params,
      affectedCellIndices,
      startedAtMs: now,
      endsAtMs: now + effectDurationMs,
    };

    // Remove any existing effect of the same type
    currentEffects = currentEffects.filter(e => e.eventType !== event.type);
    currentEffects.push(effect);

    // Set cleanup timer
    const cleanupTimer = setTimeout(() => {
      currentEffects = currentEffects.filter(e => e !== effect);
      gameState.activeEffects = currentEffects.length > 0 ? [...currentEffects] : undefined;
      onStoreUpdate();
    }, effectDurationMs);
    newTimers.push(cleanupTimer);

    // For sequential mode, set up progression timers through snake cells
    if (mapping.application.mode === 'sequential') {
      const { durationMs, delayMs } = mapping.application;
      const stepMs = durationMs + delayMs;
      for (let i = 1; i < snakeCellIndices.length; i++) {
        const timer = setTimeout(() => {
          if (currentEffects.includes(effect)) {
            effect.affectedCellIndices = [snakeCellIndices[i]];
            gameState.activeEffects = [...currentEffects];
            onStoreUpdate();
          }
        }, stepMs * i);
        newTimers.push(timer);
      }
    }
  }

  // Update game state with active effects
  gameState.activeEffects = currentEffects.length > 0 ? [...currentEffects] : undefined;

  return {
    updatedActiveEffects: currentEffects,
    newTimers,
    needsStoreUpdate: true,
  };
}
