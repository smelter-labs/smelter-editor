import { state } from './core/serverState';
import { config } from './config';
// import { renderSnakeBoard, findFirstSnakeGameState } from './snakeGame/snakeGameDashboard';
const isBoxed = process.env.LAYOUT === 'boxed';

// Lazy-loaded blessed modules — only imported when LAYOUT=boxed
let blessed: any;
let contrib: any;

const MAX_LOG_LINES = 500;

let screen: any;
let grid: any;
let serverBox: any;
let roomsTable: any;
let inputsTable: any;
let logBox: any;
let sysLogBox: any;
let timelineBox: any;

const requestLog: string[] = [];
const sysLog: string[] = [];
const timelineLog: string[] = [];
const MAX_TIMELINE_LOG_LINES = 50;
let requestCount = 0;
let startTime = Date.now();

// ── Structured log streaming (SSE) ──

interface LogEntry {
  timestamp: string;
  level: 'LOG' | 'ERR' | 'WRN' | 'OUT' | 'REQ';
  message: string;
}

const structuredLogBuffer: LogEntry[] = [];
const logListeners = new Set<(entry: LogEntry) => void>();

function emitLogEntry(level: LogEntry['level'], message: string) {
  const timestamp = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const entry: LogEntry = { timestamp, level, message };
  structuredLogBuffer.push(entry);
  if (structuredLogBuffer.length > MAX_LOG_LINES) {
    structuredLogBuffer.shift();
  }
  for (const listener of logListeners) {
    listener(entry);
  }
}

export function addLogListener(cb: (entry: LogEntry) => void): () => void {
  logListeners.add(cb);
  return () => {
    logListeners.delete(cb);
  };
}

export function getLogBuffer(): LogEntry[] {
  return [...structuredLogBuffer];
}

// Original console methods — saved before hijacking so logRequest can
// write to terminal without triggering the hijack in non-boxed mode.
let origConsoleLog = console.log;
let origConsoleError = console.error;
let origConsoleWarn = console.warn;

// ── Capture console output ──
function pushSysLog(level: string, args: unknown[]) {
  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const msg = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
    .join(' ');

  emitLogEntry(level as LogEntry['level'], msg);

  if (!isBoxed) return;

  const escapedMsg = msg.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  const colorTag =
    level === 'ERR'
      ? '{red-fg}'
      : level === 'WRN'
        ? '{yellow-fg}'
        : '{white-fg}';

  const line = `${time}  ${colorTag}${level}{/}  ${escapedMsg}`;
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
const BLESSED_CSI_RE =
  /\x1b\[\??[\d;]*[A-HJKSTfhlmnsu]|\x1b\(|\x1b\[\d*[ABCDEFGHIJKLMPXZ@`ade]/;

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
  origConsoleLog = console.log;
  origConsoleError = console.error;
  origConsoleWarn = console.warn;

  console.log = (...args: unknown[]) => {
    pushSysLog('LOG', args);
    if (!isBoxed) origConsoleLog(...args);
  };
  console.error = (...args: unknown[]) => {
    pushSysLog('ERR', args);
    if (!isBoxed) origConsoleError(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushSysLog('WRN', args);
    if (!isBoxed) origConsoleWarn(...args);
  };

  if (!isBoxed) return;

  interceptStream(process.stdout, origStdoutWrite, 'OUT');
  interceptStream(process.stderr, origStderrWrite, 'ERR');

  // Patch child_process.spawn so that child processes spawned with
  // stdio:'inherit' (e.g. smelter_main) get piped stdout/stderr routed into
  // the sysLog panel instead of writing directly to the terminal fd and
  // corrupting the blessed TUI.
  const cp = require('child_process');
  const origSpawn = cp.spawn;
  cp.spawn = function (cmd: string, args: string[], opts: any) {
    if (opts?.stdio === 'inherit') {
      opts = { ...opts, stdio: ['inherit', 'pipe', 'pipe'] };
    }
    const child = origSpawn(cmd, args, opts);
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const t = line.trim();
        if (t) pushSysLog('OUT', [t]);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const t = line.trim();
        if (t) pushSysLog('ERR', [t]);
      }
    });
    return child;
  };
}

export function logRequest(method: string, route: string, status: number) {
  requestCount++;

  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const statusStr = status < 400 ? `${status}` : `${status} !!`;
  const msg = `${statusStr}  ${method.padEnd(6)} ${route}`;

  emitLogEntry('REQ', msg);

  if (!isBoxed) {
    origConsoleLog(`${time}  ${msg}`);
    return;
  }

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

export function logTimelineEvent(roomId: string, message: string) {
  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  const roomShort = roomId.slice(0, 8);

  if (!isBoxed) {
    console.log(`[timeline] ${roomShort}  ${message}`);
    return;
  }

  const line = `${time}  {cyan-fg}${roomShort}{/}  ${sanitizeTableCell(message)}`;
  timelineLog.push(line);
  if (timelineLog.length > MAX_TIMELINE_LOG_LINES) {
    timelineLog.shift();
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function sanitizeTableCell(value: string): string {
  return value.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function formatTimelineMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
}

function formatMotionScore(input: {
  motionEnabled: boolean;
  motionScore?: number;
  type: string;
}): string {
  const videoTypes = ['local-mp4', 'twitch-channel', 'kick-channel', 'whip'];
  if (!videoTypes.includes(input.type) || !input.motionEnabled) return '-';
  if (input.motionScore === undefined) return '...';
  return input.motionScore.toFixed(2);
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
  const roomRows = rooms.map((room) => {
    const inputs = room.getInputs();
    const { layers } = room.getState();
    const res = room.getResolution();
    const recording = room.hasActiveRecording() ? 'REC' : '-';
    const age = formatUptime(Date.now() - room.creationTimestamp);
    const roomStatus = room.pendingDelete ? 'DELETING' : 'ACTIVE';
    return [
      room.idPrefix.slice(0, 8),
      roomStatus,
      String(layers.length),
      `${res.width}x${res.height}`,
      String(inputs.length),
      recording,
      age.slice(0, 8),
    ];
  });

  roomsTable.setData({
    headers: [
      'Room ID',
      'Status',
      'Layers',
      'Resolution',
      'Inputs',
      'Rec',
      'Age',
    ],
    data:
      roomRows.length > 0 ? roomRows : [['-', '-', '-', '-', '-', '-', '-']],
  });

  // ── Panel 3: Timeline ──
  const tlLines: string[] = [];
  let anyTimelinePlaying = false;

  for (const room of rooms) {
    const tl = room.getTimelinePlaybackState();
    if (!tl.isPlaying && !tl.isPaused) continue;
    anyTimelinePlaying = true;

    const roomId = room.idPrefix.slice(0, 8);
    const statusLabel = tl.isPlaying
      ? '{green-fg}PLAYING{/}'
      : '{yellow-fg}PAUSED{/}';

    const playheadStr = formatTimelineMs(tl.playheadMs);
    const totalStr = formatTimelineMs(tl.totalDurationMs);
    tlLines.push(
      ` {cyan-fg}${roomId}{/}  ${statusLabel}  ${playheadStr} / ${totalStr}`,
    );

    const BAR_WIDTH = 30;
    const pct =
      tl.totalDurationMs > 0
        ? Math.min(tl.playheadMs / tl.totalDurationMs, 1)
        : 0;
    const filled = Math.round(pct * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    const pctLabel = `${Math.round(pct * 100)}%`;
    const barColor = tl.isPlaying ? 'green' : 'yellow';
    tlLines.push(
      ` {${barColor}-fg}[${'█'.repeat(filled)}${'░'.repeat(empty)}]{/} ${pctLabel}`,
    );

    const activeIds = room.getTimelineActiveInputIds();
    if (activeIds.length > 0) {
      const allInputs = room.getInputs();
      const names = activeIds.map((id) => {
        const inp = allInputs.find((i) => i.inputId === id);
        return inp
          ? sanitizeTableCell(inp.metadata.title).slice(0, 14)
          : id.slice(0, 8);
      });
      tlLines.push(` Active: {white-fg}${names.join(', ')}{/}`);
    }
    tlLines.push(``);
  }

  if (!anyTimelinePlaying && timelineLog.length === 0) {
    tlLines.push(` {white-fg}No active timeline playback{/}`);
  }

  if (timelineLog.length > 0) {
    if (anyTimelinePlaying) {
      tlLines.push(` {bold}── Recent events ──{/bold}`);
    }
    const visibleEvents = timelineLog.slice(-12);
    for (const line of visibleEvents) {
      tlLines.push(` ${line}`);
    }
  }

  timelineBox.setContent(tlLines.join('\n'));

  // ── Panel 4: Inputs ──
  const inputRows: string[][] = [];
  for (const room of rooms) {
    for (const input of room.getInputs()) {
      const typeLabels: Record<string, string> = {
        'twitch-channel': 'twitch',
        'kick-channel': 'kick',
        whip: 'whip',
        'local-mp4': 'mp4',
        image: 'image',
        'text-input': 'text',
        game: 'game',
      };
      const statusLabel =
        input.status === 'connected'
          ? 'ON'
          : input.status === 'pending'
            ? 'PND'
            : 'OFF';
      inputRows.push([
        room.idPrefix.slice(0, 8),
        (typeLabels[input.type] ?? input.type).slice(0, 8),
        statusLabel,
        sanitizeTableCell(input.metadata.title).slice(0, 14),
        input.hidden ? 'hid' : 'vis',
        `${Math.round(input.volume * 100)}%`.slice(0, 4),
        formatMotionScore(input),
      ]);
    }
  }

  inputsTable.setData({
    headers: ['Room', 'Type', 'St', 'Title', 'Vis', 'Vol', 'Mot'],
    data:
      inputRows.length > 0 ? inputRows : [['-', '-', '-', '-', '-', '-', '-']],
  });

  screen.render();
}

export function initDashboard() {
  startTime = Date.now();

  if (!isBoxed) return;

  blessed = require('blessed');
  contrib = require('blessed-contrib');

  screen = blessed.screen({
    smartCSR: true,
    title: 'Smelter Dashboard',
    tags: true,
  });

  // Layout (12x6 grid):
  //  Row 0-2:  Server Info (2 cols) | Rooms (4 cols)
  //  Row 3-7:  Timeline (3 cols)   | Inputs (3 cols)
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
    columnWidth: [8, 8, 14, 11, 6, 5, 8],
  });

  // Middle-left: Timeline
  timelineBox = grid.set(3, 0, 5, 3, blessed.box, {
    label: ' 🎬 Timeline ',
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'blue' },
      label: { fg: 'blue', bold: true },
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
    columnWidth: [8, 8, 4, 14, 4, 4, 5],
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
