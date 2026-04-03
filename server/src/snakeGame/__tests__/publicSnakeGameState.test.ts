import { describe, it, expect } from 'vitest';
import { toPublicSnakeGameInputState } from '../publicSnakeGameState';

function makeGameInput(
  cells: Array<{ color: string; isHead?: boolean }> = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    snakeGameState: {
      backgroundColor: '#111',
      cellGap: 2,
      boardBorderColor: '#fff',
      boardBorderWidth: 1,
      gridLineColor: '#333',
      gridLineAlpha: 0.5,
      cells,
      ...overrides,
    },
    snakeEventShaders: undefined,
    snake1Shaders: [{ shaderId: 's1' }],
    snake2Shaders: [{ shaderId: 's2' }],
  };
}

describe('toPublicSnakeGameInputState', () => {
  it('maps snakeGameState fields to public fields', () => {
    const input = makeGameInput();
    const result = toPublicSnakeGameInputState(input as any);

    expect(result.gameBackgroundColor).toBe('#111');
    expect(result.gameCellGap).toBe(2);
    expect(result.gameBoardBorderColor).toBe('#fff');
    expect(result.gameBoardBorderWidth).toBe(1);
    expect(result.gameGridLineColor).toBe('#333');
    expect(result.gameGridLineAlpha).toBe(0.5);
    expect(result.snakeEventShaders).toBeUndefined();
    expect(result.snake1Shaders).toEqual([{ shaderId: 's1' }]);
    expect(result.snake2Shaders).toEqual([{ shaderId: 's2' }]);
  });

  it('extracts head cell colors for player colors', () => {
    const cells = [
      { color: 'red', isHead: true },
      { color: 'red' },
      { color: 'blue', isHead: true },
      { color: 'blue' },
    ];
    const result = toPublicSnakeGameInputState(makeGameInput(cells) as any);
    expect(result.snakePlayerColors).toEqual(['red', 'blue']);
  });

  it('deduplicates head colors', () => {
    const cells = [
      { color: 'green', isHead: true },
      { color: 'green', isHead: true },
    ];
    const result = toPublicSnakeGameInputState(makeGameInput(cells) as any);
    expect(result.snakePlayerColors).toEqual(['green']);
  });

  it('falls back to unique cell colors when no heads exist', () => {
    const cells = [
      { color: 'red' },
      { color: 'blue' },
      { color: 'red' },
      { color: 'green' },
    ];
    const result = toPublicSnakeGameInputState(makeGameInput(cells) as any);
    expect(result.snakePlayerColors).toEqual(['red', 'blue', 'green']);
  });

  it('returns empty array for empty cells', () => {
    const result = toPublicSnakeGameInputState(makeGameInput([]) as any);
    expect(result.snakePlayerColors).toEqual([]);
  });

  it('ignores cells with isHead=false when heads exist', () => {
    const cells = [
      { color: 'yellow', isHead: false },
      { color: 'purple', isHead: true },
      { color: 'yellow' },
    ];
    const result = toPublicSnakeGameInputState(makeGameInput(cells) as any);
    expect(result.snakePlayerColors).toEqual(['purple']);
  });
});
