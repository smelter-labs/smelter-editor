import type { GameState } from './types';
import { state } from '../server/serverState';

let globalGameState: GameState | null = null;

export function setGlobalGameState(gs: GameState) {
  globalGameState = gs;
}

export function getGlobalGameState(): GameState | null {
  return globalGameState;
}

// ── Map hex color → blessed color name for {<color>-bg} tags ──
const COLOR_MAP: Record<string, string> = {
  '#ef4444': 'red',
  '#84cc16': 'green',
  '#6ad3e5': 'cyan',
  '#047f94': 'blue',
  '#f59e0b': 'yellow',
  '#a855f7': 'magenta',
  '#ffffff': 'white',
  '#0a0a1a': 'black',
  '#1a1a2e': 'blue',
};

function hexToColorName(hex: string): string {
  const lower = hex.toLowerCase();
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];

  // Parse RGB and pick closest basic terminal color
  const r = parseInt(lower.slice(1, 3), 16) || 0;
  const g = parseInt(lower.slice(3, 5), 16) || 0;
  const b = parseInt(lower.slice(5, 7), 16) || 0;

  const colors: [string, number, number, number][] = [
    ['red', 239, 68, 68],
    ['green', 132, 204, 22],
    ['yellow', 245, 158, 11],
    ['blue', 59, 130, 246],
    ['magenta', 168, 85, 247],
    ['cyan', 106, 211, 229],
    ['white', 255, 255, 255],
  ];

  let best = 'white';
  let bestDist = Infinity;
  for (const [name, cr, cg, cb] of colors) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

export function renderSnakeBoard(gameState: GameState): string {
  const { boardWidth, boardHeight, cells, backgroundColor, gridLineColor } = gameState;

  const bgCol = hexToColorName(backgroundColor);
  const gridCol = hexToColorName(gridLineColor);

  // Build a 2D grid: each cell can hold multiple snake parts (interpolation can place
  // a snake between two grid positions). We pick the "strongest" one per cell.
  // With interpolation, a cell with progress < 1 also occupies its previous position.
  type CellInfo = { color: string; isHead?: boolean; strength: number };
  const cellMap = new Map<string, CellInfo>();

  const placeCell = (x: number, y: number, color: string, isHead: boolean | undefined, strength: number) => {
    if (x < 0 || x >= boardWidth || y < 0 || y >= boardHeight) return;
    const key = `${x},${y}`;
    const existing = cellMap.get(key);
    if (!existing || strength > existing.strength) {
      cellMap.set(key, { color, isHead, strength });
    }
  };

  for (const cell of cells) {
    const progress = cell.progress ?? 1;

    // Current position — full strength
    placeCell(cell.x, cell.y, cell.color, cell.isHead, 1);

    // Previous position (trail) — only if still interpolating
    if (progress < 1 && cell.direction) {
      const dx = cell.direction === 'left' ? 1 : cell.direction === 'right' ? -1 : 0;
      const dy = cell.direction === 'up' ? 1 : cell.direction === 'down' ? -1 : 0;
      const prevX = cell.x + dx;
      const prevY = cell.y + dy;
      // Trail fades as progress approaches 1
      placeCell(prevX, prevY, cell.color, false, 1 - progress);
    }
  }

  const lines: string[] = [];

  lines.push('┌' + '─'.repeat(boardWidth) + '┐');

  for (let y = 0; y < boardHeight; y++) {
    let row = '│';
    for (let x = 0; x < boardWidth; x++) {
      const cell = cellMap.get(`${x},${y}`);
      if (cell) {
        const col = hexToColorName(cell.color);
        if (cell.isHead) {
          row += `{${col}-fg}◆{/}`;
        } else if (cell.strength < 0.5) {
          // Fading trail — use lighter block
          row += `{${col}-fg}░{/}`;
        } else {
          row += `{${col}-fg}█{/}`;
        }
      } else {
        // Empty cell — show grid dot or background
        row += `{${gridCol}-fg}·{/}`;
      }
    }
    row += '│';
    lines.push(row);
  }

  lines.push('└' + '─'.repeat(boardWidth) + '┘');

  // Info line: bg + grid colors
  lines.push(`{${bgCol}-fg}■{/} bg  {${gridCol}-fg}·{/} grid`);

  // Player scores
  const playerMap = new Map<string, { color: string; count: number }>();
  for (const cell of cells) {
    const existing = playerMap.get(cell.color);
    if (existing) {
      existing.count++;
    } else {
      playerMap.set(cell.color, { color: cell.color, count: cell.isHead ? 0 : 1 });
    }
  }
  for (const [hex, info] of playerMap) {
    const col = hexToColorName(hex);
    lines.push(`{${col}-fg}█{/} ${info.count}`);
  }

  return lines.join('\n');
}

export function findFirstGameState(): GameState | null {
  // Prefer global game state (from POST /game-state)
  if (globalGameState && globalGameState.cells.length > 0) {
    return globalGameState;
  }
  // Fallback: scan room inputs
  for (const room of state.getRooms()) {
    for (const input of room.getInputs()) {
      if (input.type === 'game') {
        const gs = (input as any).gameState as GameState | undefined;
        if (gs && gs.cells && gs.cells.length > 0) {
          return gs;
        }
      }
    }
  }
  return null;
}
