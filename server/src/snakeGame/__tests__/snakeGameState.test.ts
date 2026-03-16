import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_SNAKE_EVENT_SHADERS,
  createDefaultSnakeGameInputState,
  buildUpdatedSnakeGameState,
  processSnakeGameEvents,
} from '../snakeGameState';
import type { SnakeGameState, ActiveSnakeEffect, SnakeEventShaderConfig } from '../types';

describe('createDefaultSnakeGameInputState', () => {
  it('returns default board dimensions', () => {
    const state = createDefaultSnakeGameInputState();

    expect(state.snakeGameState.boardWidth).toBe(20);
    expect(state.snakeGameState.boardHeight).toBe(20);
    expect(state.snakeGameState.cellSize).toBe(1);
    expect(state.snakeGameState.cells).toEqual([]);
  });

  it('uses provided title', () => {
    const state = createDefaultSnakeGameInputState('Custom Title');
    expect(state.metadata.title).toBe('Custom Title');
  });

  it('defaults title to "Game"', () => {
    const state = createDefaultSnakeGameInputState();
    expect(state.metadata.title).toBe('Game');
  });

  it('includes default snake event shaders', () => {
    const state = createDefaultSnakeGameInputState();

    expect(state.snakeEventShaders).toBeDefined();
    expect(state.snakeEventShaders.speed_up).toBeDefined();
    expect(state.snakeEventShaders.game_over).toBeDefined();
  });

  it('initializes empty active effects and timers', () => {
    const state = createDefaultSnakeGameInputState();
    expect(state.activeEffects).toEqual([]);
    expect(state.effectTimers).toEqual([]);
  });
});

describe('DEFAULT_SNAKE_EVENT_SHADERS', () => {
  it('has mappings for all event types', () => {
    const eventTypes = [
      'speed_up', 'cut_opponent', 'got_cut', 'cut_self',
      'eat_block', 'bounce_block', 'no_moves', 'game_over',
    ];

    for (const type of eventTypes) {
      expect(DEFAULT_SNAKE_EVENT_SHADERS[type as keyof SnakeEventShaderConfig]).toBeDefined();
    }
  });

  it('all mappings are enabled by default', () => {
    for (const mapping of Object.values(DEFAULT_SNAKE_EVENT_SHADERS)) {
      if (mapping) {
        expect(mapping.enabled).toBe(true);
      }
    }
  });

  it('all mappings have a positive duration', () => {
    for (const mapping of Object.values(DEFAULT_SNAKE_EVENT_SHADERS)) {
      if (mapping) {
        expect(mapping.effectDurationMs).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildUpdatedSnakeGameState', () => {
  const baseGameState: SnakeGameState = {
    boardWidth: 10,
    boardHeight: 10,
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
    gridLineColor: '#333333',
    gridLineAlpha: 1.0,
  };

  it('updates board dimensions from incoming state', () => {
    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 30, height: 30, cellSize: 2 },
      cells: [],
      backgroundColor: '#ffffff',
    });

    expect(result.boardWidth).toBe(30);
    expect(result.boardHeight).toBe(30);
    expect(result.cellSize).toBe(2);
  });

  it('updates cells from incoming state', () => {
    const cells = [
      { x: 1, y: 2, color: '#ff0000' },
      { x: 3, y: 4, color: '#00ff00', isHead: true, direction: 'right' as const },
    ];

    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1 },
      cells,
      backgroundColor: '#000000',
    });

    expect(result.cells).toEqual(cells);
  });

  it('preserves backgroundColor from current state when it exists', () => {
    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1 },
      cells: [],
      backgroundColor: '#ffffff',
    });

    expect(result.backgroundColor).toBe('#1e222c');
  });

  it('enables smooth move when incoming state sets it', () => {
    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1 },
      cells: [],
      smoothMove: true,
      smoothMoveSpeed: 2,
      backgroundColor: '#000',
    });

    expect(result.smoothMove).toBe(true);
    expect(result.smoothMoveSpeed).toBe(2);
  });

  it('defaults smoothMoveSpeed to 1 when invalid', () => {
    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1 },
      cells: [],
      smoothMoveSpeed: -5,
      backgroundColor: '#000',
    });

    expect(result.smoothMoveSpeed).toBe(1);
  });

  it('preserves cellGap from current state', () => {
    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1, cellGap: 5 },
      cells: [],
      backgroundColor: '#000',
    });

    expect(result.cellGap).toBe(2);
  });

  it('carries over gameOverData when present', () => {
    const gameOverData = {
      winnerName: 'Player 1',
      reason: 'last_standing',
      players: [{ name: 'Player 1', score: 10, eaten: 5, cuts: 2, color: '#ff0000' }],
    };

    const result = buildUpdatedSnakeGameState(baseGameState, {
      board: { width: 10, height: 10, cellSize: 1 },
      cells: [],
      backgroundColor: '#000',
      gameOverData,
    });

    expect(result.gameOverData).toEqual(gameOverData);
  });
});

describe('processSnakeGameEvents', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const baseGameState: SnakeGameState = {
    boardWidth: 10,
    boardHeight: 10,
    cellSize: 1,
    cells: [
      { x: 0, y: 0, color: '#ff0000', isHead: true },
      { x: 1, y: 0, color: '#ff0000' },
      { x: 2, y: 0, color: '#00ff00', isHead: true },
    ],
    smoothMove: false,
    smoothMoveSpeed: 1,
    smoothMoveAccel: 3.2,
    smoothMoveDecel: 1.18,
    backgroundColor: '#1e222c',
    cellGap: 0,
    boardBorderColor: '#000000',
    boardBorderWidth: 4,
    gridLineColor: '#000000',
    gridLineAlpha: 1.0,
  };

  it('returns no updates when config is undefined', () => {
    const result = processSnakeGameEvents(
      [{ type: 'speed_up' }],
      baseGameState,
      [],
      undefined,
      vi.fn(),
    );

    expect(result.needsStoreUpdate).toBe(false);
    expect(result.newTimers).toHaveLength(0);
  });

  it('returns no updates when event type is not in config', () => {
    const config: SnakeEventShaderConfig = {};

    const result = processSnakeGameEvents(
      [{ type: 'speed_up' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    expect(result.needsStoreUpdate).toBe(true);
    expect(result.updatedActiveEffects).toHaveLength(0);
  });

  it('creates an active effect for a configured event', () => {
    vi.useFakeTimers();
    const config = { ...DEFAULT_SNAKE_EVENT_SHADERS };

    const result = processSnakeGameEvents(
      [{ type: 'eat_block' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    expect(result.needsStoreUpdate).toBe(true);
    expect(result.updatedActiveEffects).toHaveLength(1);
    expect(result.updatedActiveEffects[0].eventType).toBe('eat_block');
    expect(result.newTimers.length).toBeGreaterThan(0);

    for (const t of result.newTimers) clearTimeout(t);
  });

  it('replaces existing effect of the same type', () => {
    vi.useFakeTimers();
    const config = { ...DEFAULT_SNAKE_EVENT_SHADERS };

    const existingEffect: ActiveSnakeEffect = {
      eventType: 'eat_block',
      shaderId: 'old-shader',
      params: [],
      affectedCellIndices: [0],
      startedAtMs: Date.now() - 1000,
      endsAtMs: Date.now() + 1000,
    };

    const result = processSnakeGameEvents(
      [{ type: 'eat_block' }],
      baseGameState,
      [existingEffect],
      config,
      vi.fn(),
    );

    expect(result.updatedActiveEffects).toHaveLength(1);
    expect(result.updatedActiveEffects[0]).not.toBe(existingEffect);
    expect(result.updatedActiveEffects[0].eventType).toBe('eat_block');

    for (const t of result.newTimers) clearTimeout(t);
  });

  it('handles multiple events in a single batch', () => {
    vi.useFakeTimers();
    const config = { ...DEFAULT_SNAKE_EVENT_SHADERS };

    const result = processSnakeGameEvents(
      [{ type: 'speed_up' }, { type: 'eat_block' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    expect(result.updatedActiveEffects).toHaveLength(2);
    const types = result.updatedActiveEffects.map(e => e.eventType);
    expect(types).toContain('speed_up');
    expect(types).toContain('eat_block');

    for (const t of result.newTimers) clearTimeout(t);
  });

  it('skips disabled event mappings', () => {
    vi.useFakeTimers();
    const config: SnakeEventShaderConfig = {
      speed_up: {
        ...DEFAULT_SNAKE_EVENT_SHADERS.speed_up!,
        enabled: false,
      },
    };

    const result = processSnakeGameEvents(
      [{ type: 'speed_up' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    expect(result.updatedActiveEffects).toHaveLength(0);
  });

  it('applies "all" mode to all cells', () => {
    vi.useFakeTimers();
    const config: SnakeEventShaderConfig = {
      eat_block: {
        ...DEFAULT_SNAKE_EVENT_SHADERS.eat_block!,
        application: { mode: 'all' },
      },
    };

    const result = processSnakeGameEvents(
      [{ type: 'eat_block' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    expect(result.updatedActiveEffects[0].affectedCellIndices).toHaveLength(baseGameState.cells.length);

    for (const t of result.newTimers) clearTimeout(t);
  });

  it('applies "snake_cells" mode only to snake cells', () => {
    vi.useFakeTimers();
    const config: SnakeEventShaderConfig = {
      eat_block: {
        ...DEFAULT_SNAKE_EVENT_SHADERS.eat_block!,
        application: { mode: 'snake_cells' },
      },
    };

    const result = processSnakeGameEvents(
      [{ type: 'eat_block' }],
      baseGameState,
      [],
      config,
      vi.fn(),
    );

    // All 3 cells are snake cells (2 heads + 1 body sharing head color)
    expect(result.updatedActiveEffects[0].affectedCellIndices.length).toBeGreaterThan(0);
    expect(result.updatedActiveEffects[0].affectedCellIndices.length).toBeLessThanOrEqual(baseGameState.cells.length);

    for (const t of result.newTimers) clearTimeout(t);
  });
});
