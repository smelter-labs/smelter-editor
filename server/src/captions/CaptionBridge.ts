import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { WebSocketServer, WebSocket, type WebSocket as WsSocket } from 'ws';

import { SmelterInstance } from '../smelter';
import { captionDebug } from './captionsDebug';
import { CAPTIONS_SIDE_CHANNEL_DELAY_MS } from './constants';

const execFileAsync = promisify(execFile);

// The python sidecar + its venv live next to the motion detector's, under
// server/captions (mirrors the layout of server/motion used by MotionManager).
const CAPTIONS_DIR = path.join(__dirname, '../../captions');
const VENV_DIR = path.join(CAPTIONS_DIR, '.venv');
const REQUIREMENTS_CPU_FILE = path.join(CAPTIONS_DIR, 'requirements-cpu.txt');
const REQUIREMENTS_CUDA_FILE = path.join(CAPTIONS_DIR, 'requirements.txt');
const PYTHON_SCRIPT = path.join(CAPTIONS_DIR, 'sidecar.py');

function getRequirementsFile(): string {
  if (process.env.CAPTIONS_USE_CUDA_TORCH === '1') {
    return REQUIREMENTS_CUDA_FILE;
  }
  if (existsSync(REQUIREMENTS_CPU_FILE)) {
    return REQUIREMENTS_CPU_FILE;
  }
  return REQUIREMENTS_CUDA_FILE;
}

const DEPS_CHECK =
  'import torch; import numpy; import faster_whisper; import silero_vad; import websockets; import smelter';

function getVenvPython(): string {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python3');
}

function getPythonPath(): string {
  if (process.env.CAPTIONS_PYTHON_PATH) {
    return process.env.CAPTIONS_PYTHON_PATH;
  }
  const venvPython = getVenvPython();
  if (existsSync(venvPython)) {
    return venvPython;
  }
  return process.env.SIDECAR_PYTHON || 'python3';
}

export type TranscriptEvent = {
  inputId: string;
  text: string;
  ts: number; // stream pts in ms
  duration: number; // ms of audio the text covers
};

export type CaptionBridgeOptions = {
  port: number;
  socketDir: string;
  onTranscript: (event: TranscriptEvent) => void;
};

type IncomingMessage = {
  type?: unknown;
  inputId?: unknown;
  text?: unknown;
  ts?: unknown;
  duration?: unknown;
};

type OutgoingSideChannelMessage = {
  type: 'side_channel_ready' | 'side_channel_stopped';
  inputId: string;
};

export class CaptionBridge {
  private opts: CaptionBridgeOptions;
  private ws: WsSocket | null = null;
  private pythonProcess: ChildProcess | null = null;
  private pythonReady = false;
  private pythonSetupPromise: Promise<void> | null = null;
  /** Inputs whose WHIP publisher has acked and side channel may have audio. */
  private readonly readyInputIds = new Set<string>();

  constructor(opts: CaptionBridgeOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.startWsServer();
    await this.ensurePython();
    this.spawnSidecar();
  }

  /** WHIP publisher is live — Python should wait delayMs before subscribing. */
  notifySideChannelReady(inputId: string): void {
    if (this.readyInputIds.has(inputId)) {
      captionDebug('side channel ready already signaled', inputId);
      return;
    }
    this.readyInputIds.add(inputId);
    this.sendToPython({ type: 'side_channel_ready', inputId });
    console.log(`[captions] side channel ready signal inputId=${inputId}`);
  }

  /** WHIP input disconnected — Python should stop waiting for this channel. */
  notifySideChannelStopped(inputId: string): void {
    this.readyInputIds.delete(inputId);
    this.sendToPython({ type: 'side_channel_stopped', inputId });
    console.log(`[captions] side channel stopped signal inputId=${inputId}`);
  }

  private sendToPython(message: OutgoingSideChannelMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      captionDebug('sendToPython skipped (python not connected)', message);
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private replayReadyInputs(): void {
    for (const inputId of this.readyInputIds) {
      this.sendToPython({ type: 'side_channel_ready', inputId });
    }
    if (this.readyInputIds.size > 0) {
      console.log(
        `[captions] replayed ${this.readyInputIds.size} side_channel_ready signal(s) to python`,
      );
    }
  }

  private async ensurePython(): Promise<void> {
    if (this.pythonReady) return;
    if (this.pythonSetupPromise) return this.pythonSetupPromise;
    this.pythonSetupPromise = this.setupPython();
    await this.pythonSetupPromise;
    this.pythonReady = true;
  }

  private async setupPython(): Promise<void> {
    const pythonPath = getPythonPath();
    const requirementsFile = getRequirementsFile();

    if (process.env.CAPTIONS_PYTHON_PATH || !existsSync(requirementsFile)) {
      try {
        await execFileAsync(pythonPath, ['-c', DEPS_CHECK]);
        console.log('[captions] Python dependencies OK');
      } catch {
        console.warn(
          '[captions] Python dependencies missing — captions will not work',
        );
        console.warn(
          '[captions] Install: cd server/captions && python3 -m venv .venv && .venv/bin/pip install -r requirements-cpu.txt',
        );
      }
      return;
    }

    const venvPython = getVenvPython();
    if (existsSync(venvPython)) {
      try {
        await execFileAsync(venvPython, ['-c', DEPS_CHECK]);
        console.log('[captions] Venv ready');
        return;
      } catch {
        // venv exists but deps missing — reinstall below
      }
    }

    console.log('[captions] Setting up Python venv...');
    try {
      if (!existsSync(venvPython)) {
        await execFileAsync('python3', ['-m', 'venv', VENV_DIR], {
          cwd: CAPTIONS_DIR,
        });
      }
      await execFileAsync(
        venvPython,
        ['-m', 'pip', 'install', '--quiet', '-r', requirementsFile],
        { cwd: CAPTIONS_DIR },
      );
      console.log('[captions] Venv created and dependencies installed');
    } catch (err) {
      console.error('[captions] Failed to setup Python venv:', err);
      console.warn('[captions] Captions will not work. Install manually:');
      console.warn(
        '[captions]   cd server/captions && python3 -m venv .venv && .venv/bin/pip install -r requirements-cpu.txt',
      );
    }
  }

  private startWsServer(): void {
    const wss = new WebSocketServer({
      port: this.opts.port,
      host: '127.0.0.1',
    });
    wss.on('connection', (ws) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn('[captions] rejecting second python connection');
        ws.close(1013, 'already connected');
        return;
      }
      this.ws = ws;
      console.log('[captions] python connected');
      this.replayReadyInputs();

      ws.on('message', (raw) => this.handleMessage(raw.toString()));
      ws.on('close', () => {
        console.error('[captions] python disconnected — this is a bug');
        if (this.ws === ws) this.ws = null;
      });
      ws.on('error', (err) => console.error('[captions] ws error', err));
    });
    wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `[captions] port ${this.opts.port} is already in use — another process holds it. ` +
            `Find it with: lsof -nP -iTCP:${this.opts.port} -sTCP:LISTEN`,
        );
        process.exit(1);
      }
      console.error('[captions] ws server error', err);
    });
    console.log(`[captions] python WS listening on :${this.opts.port}`);
  }

  private handleMessage(raw: string): void {
    let parsed: IncomingMessage;
    try {
      parsed = JSON.parse(raw) as IncomingMessage;
    } catch {
      console.warn('[captions] non-JSON message dropped');
      return;
    }
    if (
      parsed.type !== 'transcript' ||
      typeof parsed.inputId !== 'string' ||
      typeof parsed.text !== 'string' ||
      typeof parsed.ts !== 'number' ||
      typeof parsed.duration !== 'number'
    ) {
      console.warn('[captions] invalid message dropped', parsed);
      return;
    }
    this.scheduleTranscript({
      inputId: parsed.inputId,
      text: parsed.text,
      ts: parsed.ts,
      duration: parsed.duration,
    });
    console.log(
      `[captions] transcript from python inputId=${parsed.inputId} ts=${parsed.ts}ms duration=${parsed.duration}ms text="${parsed.text}"`,
    );
  }

  private scheduleTranscript(event: TranscriptEvent): void {
    const start = SmelterInstance.getStartTime();
    const wait = start === null ? 0 : start + event.ts - Date.now();
    captionDebug('scheduleTranscript', {
      inputId: event.inputId,
      ts: event.ts,
      smelterStart: start,
      waitMs: wait,
      text: event.text,
    });
    if (wait <= 0) {
      console.log(
        `[captions] showing now inputId=${event.inputId} wait=${wait}ms`,
      );
      this.opts.onTranscript(event);
      return;
    }
    console.log(
      `[captions] delayed ${wait}ms inputId=${event.inputId} ts=${event.ts}ms`,
    );
    setTimeout(() => {
      captionDebug('delayed transcript fired', event.inputId);
      this.opts.onTranscript(event);
    }, wait);
  }

  private spawnSidecar(): void {
    if (process.env.SKIP_PYTHON === '1') {
      console.log(
        '[captions] SKIP_PYTHON=1 — start sidecar manually with these env vars:',
      );
      console.log(
        `  SMELTER_SIDE_CHANNEL_SOCKET_DIR=${this.opts.socketDir} NODE_WS_URL=ws://127.0.0.1:${this.opts.port} python3 ${PYTHON_SCRIPT}`,
      );
      return;
    }
    const pythonBin = getPythonPath();
    console.log(
      `[captions] spawning sidecar python=${pythonBin} socketDir=${this.opts.socketDir}`,
    );
    this.pythonProcess = spawn(pythonBin, ['-u', PYTHON_SCRIPT], {
      stdio: 'inherit',
      cwd: CAPTIONS_DIR,
      env: {
        ...process.env,
        SMELTER_SIDE_CHANNEL_SOCKET_DIR: this.opts.socketDir,
        SMELTER_SIDE_CHANNEL_DELAY_MS: String(CAPTIONS_SIDE_CHANNEL_DELAY_MS),
        NODE_WS_URL: `ws://127.0.0.1:${this.opts.port}`,
        CAPTIONS_DEBUG: process.env.CAPTIONS_DEBUG ?? '',
      },
    });
    this.pythonProcess.on('exit', (code) =>
      console.log(`[captions] python exited with code ${code}`),
    );
    process.on('SIGINT', () => {
      this.pythonProcess?.kill('SIGINT');
    });
    process.on('SIGTERM', () => {
      this.pythonProcess?.kill('SIGTERM');
    });
  }
}
