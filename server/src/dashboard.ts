import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { state } from './server/serverState';
import { config } from './config';
import type { GameState } from './app/store';

const MAX_LOG_LINES = 500;

let screen: blessed.Widgets.Screen;
let grid: any;
let serverBox: blessed.Widgets.BoxElement;
let roomsTable: any;
let inputsTable: any;
let logBox: blessed.Widgets.Log;
let sysLogBox: blessed.Widgets.Log;
let snakeBox: blessed.Widgets.BoxElement;

const requestLog: string[] = [];
const sysLog: string[] = [];
let requestCount = 0;
let startTime = Date.now();
let globalGameState: GameState | null = null;

export function setGlobalGameState(gs: GameState) {
  globalGameState = gs;
}

export function getGlobalGameState(): GameState | null {
  return globalGameState;
}

// ── Capture console output ──
function pushSysLog(level: string, args: unknown[]) {
  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const msg = args
    .map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
    .join(' ')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');

  const colorTag =
    level === 'ERR' ? '{red-fg}' :
    level === 'WRN' ? '{yellow-fg}' :
    '{white-fg}';

  const line = `${time}  ${colorTag}${level}{/}  ${msg}`;
  sysLog.push(line);
  if (sysLog.length > MAX_LOG_LINES) {
    sysLog.shift();
  }
  if (sysLogBox) {
    sysLogBox.setContent(sysLog.join('\n'));
    sysLogBox.setScrollPerc(100);
    screen?.render();
  }
}

// Saved original write functions — blessed will use these via patchStdout()
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

// Matches blessed/TUI cursor-control sequences (move, clear, show/hide cursor, scroll region)
// but NOT simple SGR color codes like \x1b[32m that pino-pretty uses.
const BLESSED_CSI_RE = /\x1b\[\??[\d;]*[A-HJKSTfhlmnsu]|\x1b\(|\x1b\[\d*[ABCDEFGHIJKLMPXZ@`ade]/;

function interceptStream(
  stream: NodeJS.WriteStream,
  origWrite: typeof process.stdout.write,
  level: string,
) {
  stream.write = ((chunk: any, encodingOrCb?: any, cb?: any): boolean => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    // Let blessed TUI control sequences through (cursor moves, screen clears, etc.)
    // but capture everything else (including pino-pretty colored logs) into the sys log panel.
    if (BLESSED_CSI_RE.test(str)) {
      return origWrite(chunk, encodingOrCb, cb);
    }
    // Strip ANSI color codes before pushing to sys log
    const stripped = str.replace(/\x1b\[[\d;]*m/g, '');
    for (const line of stripped.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) pushSysLog(level, [trimmed]);
    }
    return true;
  }) as any;
}

export function hijackConsole() {
  console.log = (...args: unknown[]) => {
    pushSysLog('LOG', args);
  };
  console.error = (...args: unknown[]) => {
    pushSysLog('ERR', args);
  };
  console.warn = (...args: unknown[]) => {
    pushSysLog('WRN', args);
  };

  interceptStream(process.stdout, origStdoutWrite, 'OUT');
  interceptStream(process.stderr, origStderrWrite, 'ERR');
}

export function logRequest(method: string, route: string, status: number) {
  requestCount++;
  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const statusColor = status < 400 ? '{green-fg}' : '{red-fg}';
  const line = `${time}  ${statusColor}${status}{/}  ${method.padEnd(6)} ${route}`;
  requestLog.push(line);
  if (requestLog.length > MAX_LOG_LINES) {
    requestLog.shift();
  }
  if (logBox) {
    logBox.setContent(requestLog.join('\n'));
    logBox.setScrollPerc(100);
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
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

function renderSnakeBoard(gameState: GameState): string {
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

function findFirstGameState(): GameState | null {
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

function updateDashboard() {
  if (!screen) return;

  // ── Panel 1: Server Info ──
  const env = process.env.ENVIRONMENT ?? 'development';
  const port = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
  const rooms = state.getRooms();
  const totalInputs = rooms.reduce((sum, r) => sum + r.getInputs().length, 0);
  const uptime = formatUptime(Date.now() - startTime);

  const serverLines = [
    `{bold}SMELTER SERVER{/bold}`,
    ``,
    ` Environment   ${env === 'production' ? '{red-fg}PRODUCTION{/}' : '{green-fg}development{/}'}`,
    ` Port          ${port}`,
    ` Uptime        ${uptime}`,
    ` Decoder       ${config.h264Decoder}`,
    ` Encoder       ${config.h264Encoder.type}`,
    ``,
    ` Rooms         {yellow-fg}${rooms.length}{/}`,
    ` Total inputs  {yellow-fg}${totalInputs}{/}`,
    ` Requests      {cyan-fg}${requestCount}{/}`,
  ];
  serverBox.setContent(serverLines.join('\n'));

  // ── Panel 2: Rooms ──
  const roomRows = rooms.map(room => {
    const inputs = room.getInputs();
    const [, layout] = room.getState();
    const res = room.getResolution();
    const recording = room.hasActiveRecording() ? '{red-fg}● REC{/}' : '{green-fg}—{/}';
    const age = formatUptime(Date.now() - room.creationTimestamp);
    const roomStatus = room.pendingDelete ? '{red-fg}DELETING{/}' : '{green-fg}ACTIVE{/}';
    return [
      room.idPrefix.slice(0, 8),
      roomStatus,
      String(layout),
      `${res.width}×${res.height}`,
      String(inputs.length),
      recording,
      age,
    ];
  });

  roomsTable.setData({
    headers: ['Room ID', 'Status', 'Layout', 'Resolution', 'Inputs', 'Rec', 'Age'],
    data: roomRows.length > 0 ? roomRows : [['—', '—', '—', '—', '—', '—', '—']],
  });

  // ── Panel 3: Snake Board ──
  const gameState = findFirstGameState();
  if (gameState) {
    snakeBox.setContent(renderSnakeBoard(gameState));
  } else {
    // Show diagnostic: how many game inputs exist (even without cells)
    let gameInputCount = 0;
    for (const room of rooms) {
      for (const input of room.getInputs()) {
        if (input.type === 'game') gameInputCount++;
      }
    }
    snakeBox.setContent(`\n  {white-fg}No active game{/}\n  {white-fg}Game inputs: ${gameInputCount}{/}`);
  }

  // ── Panel 4: Inputs ──
  const inputRows: string[][] = [];
  for (const room of rooms) {
    for (const input of room.getInputs()) {
      const typeColors: Record<string, string> = {
        'twitch-channel': '{magenta-fg}twitch{/}',
        'kick-channel': '{green-fg}kick{/}',
        'whip': '{cyan-fg}whip{/}',
        'local-mp4': '{blue-fg}mp4{/}',
        'image': '{yellow-fg}image{/}',
        'text-input': '{white-fg}text{/}',
        'game': '{red-fg}game{/}',
      };
      const statusIcon =
        input.status === 'connected' ? '{green-fg}●{/}' :
        input.status === 'pending' ? '{yellow-fg}◌{/}' :
        '{red-fg}○{/}';
      inputRows.push([
        room.idPrefix.slice(0, 8),
        typeColors[input.type] ?? input.type,
        statusIcon,
        input.metadata.title.slice(0, 40),
        input.hidden ? '{red-fg}hidden{/}' : '{green-fg}visible{/}',
        `${Math.round(input.volume * 100)}%`,
      ]);
    }
  }

  inputsTable.setData({
    headers: ['Room', 'Type', 'St', 'Title', 'Vis', 'Vol'],
    data: inputRows.length > 0 ? inputRows : [['—', '—', '—', '—', '—', '—']],
  });

  screen.render();
}

export function initDashboard() {
  startTime = Date.now();

  screen = blessed.screen({
    smartCSR: true,
    title: 'Smelter Dashboard',
    tags: true,
  });

  // Layout (12×6 grid):
  //  Row 0-2:  Server Info (2 cols) | Rooms (4 cols)
  //  Row 3-7:  🐍 Snake (3 cols)   | Inputs (3 cols)
  //  Row 8-11: Requests (3 cols)   | System Logs (3 cols)
  grid = new contrib.grid({ rows: 12, cols: 6, screen });

  // Top-left: Server Info
  serverBox = grid.set(0, 0, 3, 2, blessed.box, {
    label: ' ⚙ Server ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      label: { fg: 'cyan', bold: true },
    },
    padding: { left: 1, top: 0 },
  });

  // Top-right: Rooms
  roomsTable = grid.set(0, 2, 3, 4, contrib.table, {
    label: ' 🏠 Rooms ',
    tags: true,
    keys: true,
    interactive: false,
    border: { type: 'line' },
    style: {
      border: { fg: 'yellow' },
      label: { fg: 'yellow', bold: true },
      header: { fg: 'white', bold: true },
      cell: { fg: 'white' },
    },
    columnSpacing: 2,
    columnWidth: [10, 10, 18, 12, 7, 7, 10],
  });

  // Middle-left: Snake Board (wider + taller)
  snakeBox = grid.set(3, 0, 5, 3, blessed.box, {
    label: ' 🐍 Snake ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'green' },
      label: { fg: 'green', bold: true },
    },
    padding: { left: 1, top: 0 },
  });

  // Middle-right: Inputs
  inputsTable = grid.set(3, 3, 5, 3, contrib.table, {
    label: ' 📺 Inputs ',
    tags: true,
    keys: true,
    interactive: false,
    border: { type: 'line' },
    style: {
      border: { fg: 'magenta' },
      label: { fg: 'magenta', bold: true },
      header: { fg: 'white', bold: true },
      cell: { fg: 'white' },
    },
    columnSpacing: 2,
    columnWidth: [10, 10, 4, 30, 8, 6],
  });

  // Bottom-left: Request Log
  logBox = grid.set(8, 0, 4, 3, blessed.log, {
    label: ' 📡 Requests ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'green' },
      label: { fg: 'green', bold: true },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: 'green' },
    },
    padding: { left: 1 },
  });

  // Bottom-right: System Logs
  sysLogBox = grid.set(8, 3, 4, 3, blessed.log, {
    label: ' 🔧 System Logs ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'red' },
      label: { fg: 'red', bold: true },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: 'red' },
    },
    padding: { left: 1 },
  });

  // Render buffered sys logs
  if (sysLog.length > 0) {
    sysLogBox.setContent(sysLog.join('\n'));
    sysLogBox.setScrollPerc(100);
  }

  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  setInterval(updateDashboard, 200);
  updateDashboard();
}
