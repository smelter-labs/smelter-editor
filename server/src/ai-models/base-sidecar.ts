import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket, type WebSocket as WsSocket } from 'ws';
import type { ModelManifest } from './registry';

const execFileAsync = promisify(execFile);

export type ModelResultEvent = {
  modelId: string;
  inputId: string;
  data: unknown;
  ptsNanos?: number;
};

type IncomingMessage = {
  type?: unknown;
  inputId?: unknown;
  data?: unknown;
  ptsNanos?: unknown;
};

type OutgoingMessage = {
  cmd: 'subscribe' | 'unsubscribe' | 'side_channel_ready' | 'side_channel_stopped' | 'shutdown';
  inputId?: string;
};

export abstract class BaseSidecar extends EventEmitter {
  protected manifest: ModelManifest;
  protected ws: WsSocket | null = null;
  protected wss: WebSocketServer | null = null;
  protected pythonProcess: ChildProcess | null = null;
  protected pythonReady = false;
  protected pythonSetupPromise: Promise<void> | null = null;
  protected readonly trackedInputs = new Set<string>();
  protected readonly readyInputIds = new Set<string>();
  private restartAttempts = 0;
  private readonly MAX_RESTARTS = 3;
  private started = false;

  constructor(manifest: ModelManifest) {
    super();
    this.manifest = manifest;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startWsServer();
    await this.ensurePython();
    this.spawnProcess();
  }

  addInput(inputId: string): void {
    this.trackedInputs.add(inputId);
    const sent = this.sendToPython({ cmd: 'subscribe', inputId });
    console.log(
      `[ai:${this.manifest.id}] addInput inputId=${inputId} wsSent=${sent} tracked=${this.trackedInputs.size}`,
    );
  }

  removeInput(inputId: string): void {
    this.trackedInputs.delete(inputId);
    this.readyInputIds.delete(inputId);
    const sent = this.sendToPython({ cmd: 'unsubscribe', inputId });
    console.log(
      `[ai:${this.manifest.id}] removeInput inputId=${inputId} wsSent=${sent}`,
    );
  }

  notifySideChannelReady(inputId: string): void {
    if (!this.trackedInputs.has(inputId)) {
      console.log(
        `[ai:${this.manifest.id}] notifySideChannelReady inputId=${inputId} — NOT tracked, ignoring`,
      );
      return;
    }
    this.readyInputIds.add(inputId);
    const sent = this.sendToPython({ cmd: 'side_channel_ready', inputId });
    console.log(
      `[ai:${this.manifest.id}] notifySideChannelReady inputId=${inputId} wsSent=${sent}`,
    );
  }

  notifySideChannelStopped(inputId: string): void {
    this.readyInputIds.delete(inputId);
    this.sendToPython({ cmd: 'side_channel_stopped', inputId });
  }

  async shutdown(): Promise<void> {
    this.sendToPython({ cmd: 'shutdown' });
    this.pythonProcess?.kill('SIGTERM');
    this.wss?.close();
    this.started = false;
  }

  protected emitResult(event: ModelResultEvent): void {
    this.emit('result', event);
  }

  protected sendToPython(message: OutgoingMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private replayReadyInputs(): void {
    for (const inputId of this.readyInputIds) {
      this.sendToPython({ cmd: 'side_channel_ready', inputId });
    }
  }

  private startWsServer(): void {
    this.wss = new WebSocketServer({
      port: this.manifest.wsPort,
      host: '127.0.0.1',
    });
    this.wss.on('connection', (ws) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn(
          `[ai:${this.manifest.id}] rejecting second python connection`,
        );
        ws.close(1013, 'already connected');
        return;
      }
      this.ws = ws;
      console.log(`[ai:${this.manifest.id}] python connected`);
      this.replayReadyInputs();

      ws.on('message', (raw) => this.handleMessage(raw.toString()));
      ws.on('close', () => {
        if (this.ws === ws) this.ws = null;
        this.handlePythonDisconnect();
      });
      ws.on('error', (err) =>
        console.error(`[ai:${this.manifest.id}] ws error`, err),
      );
    });
    console.log(
      `[ai:${this.manifest.id}] WS listening on :${this.manifest.wsPort}`,
    );
  }

  private handleMessage(raw: string): void {
    let parsed: IncomingMessage;
    try {
      parsed = JSON.parse(raw) as IncomingMessage;
    } catch {
      return;
    }
    if (parsed.type === 'ready') {
      this.restartAttempts = 0;
      for (const inputId of this.trackedInputs) {
        this.sendToPython({ cmd: 'subscribe', inputId });
        if (this.readyInputIds.has(inputId)) {
          this.sendToPython({ cmd: 'side_channel_ready', inputId });
        }
      }
      return;
    }
    if (
      parsed.type === 'result' &&
      typeof parsed.inputId === 'string' &&
      parsed.data !== undefined
    ) {
      this.emitResult({
        modelId: this.manifest.id,
        inputId: parsed.inputId,
        data: parsed.data,
        ptsNanos:
          typeof parsed.ptsNanos === 'number' ? parsed.ptsNanos : undefined,
      });
    }
  }

  private handlePythonDisconnect(): void {
    if (this.trackedInputs.size === 0) return;
    if (this.restartAttempts >= this.MAX_RESTARTS) {
      console.error(
        `[ai:${this.manifest.id}] exceeded restart limit (${this.MAX_RESTARTS})`,
      );
      this.emit('fatal', new Error(`${this.manifest.id} sidecar failed`));
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), 8000);
    this.restartAttempts++;
    console.log(
      `[ai:${this.manifest.id}] restarting python in ${delay}ms (attempt ${this.restartAttempts})`,
    );
    setTimeout(() => this.spawnProcess(), delay);
  }

  private getVenvPython(): string {
    return process.platform === 'win32'
      ? path.join(this.manifest.venvDir, 'Scripts', 'python.exe')
      : path.join(this.manifest.venvDir, 'bin', 'python3');
  }

  private getPythonPath(): string {
    if (this.manifest.envOverrideKey) {
      const override = process.env[this.manifest.envOverrideKey];
      if (override) return override;
    }
    const venvPython = this.getVenvPython();
    if (existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  private async ensurePython(): Promise<void> {
    if (this.pythonReady) return;
    if (this.pythonSetupPromise) return this.pythonSetupPromise;
    this.pythonSetupPromise = this.setupPython();
    await this.pythonSetupPromise;
    this.pythonReady = true;
  }

  private async setupPython(): Promise<void> {
    const pythonPath = this.getPythonPath();
    const { requirementsFile, venvDir, depsCheck } = this.manifest;

    if (
      (this.manifest.envOverrideKey &&
        process.env[this.manifest.envOverrideKey]) ||
      !existsSync(requirementsFile)
    ) {
      try {
        await execFileAsync(pythonPath, ['-c', depsCheck]);
        console.log(`[ai:${this.manifest.id}] Python dependencies OK`);
      } catch {
        console.warn(
          `[ai:${this.manifest.id}] Python dependencies missing — model will not work`,
        );
      }
      return;
    }

    const venvPython = this.getVenvPython();
    if (existsSync(venvPython)) {
      try {
        await execFileAsync(venvPython, ['-c', depsCheck]);
        console.log(`[ai:${this.manifest.id}] Venv ready`);
        return;
      } catch {
        // reinstall below
      }
    }

    console.log(`[ai:${this.manifest.id}] Setting up Python venv...`);
    try {
      if (!existsSync(venvPython)) {
        await execFileAsync('python3', ['-m', 'venv', venvDir], {
          cwd: path.dirname(requirementsFile),
        });
      }
      await execFileAsync(
        venvPython,
        ['-m', 'pip', 'install', '--quiet', '-r', requirementsFile],
        { cwd: path.dirname(requirementsFile) },
      );
      console.log(`[ai:${this.manifest.id}] Venv created`);
    } catch (err) {
      console.error(`[ai:${this.manifest.id}] Failed to setup venv:`, err);
    }
  }

  private spawnProcess(): void {
    if (process.env.SKIP_PYTHON === '1') {
      console.log(
        `[ai:${this.manifest.id}] SKIP_PYTHON=1 — start worker manually:`,
      );
      console.log(
        `  NODE_WS_URL=ws://127.0.0.1:${this.manifest.wsPort} python3 ${this.manifest.pythonScript}`,
      );
      return;
    }

    const pythonBin = this.getPythonPath();
    const socketDir = process.env.SMELTER_SIDE_CHANNEL_SOCKET_DIR ?? '';
    console.log(
      `[ai:${this.manifest.id}] spawning python=${pythonBin}`,
    );

    this.pythonProcess = spawn(pythonBin, ['-u', this.manifest.pythonScript], {
      stdio: 'inherit',
      cwd: path.dirname(this.manifest.pythonScript),
      env: {
        ...process.env,
        SMELTER_SIDE_CHANNEL_SOCKET_DIR: socketDir,
        NODE_WS_URL: `ws://127.0.0.1:${this.manifest.wsPort}`,
      },
    });

    this.pythonProcess.on('exit', (code) => {
      console.log(`[ai:${this.manifest.id}] python exited code=${code}`);
      if (this.pythonProcess?.pid === undefined) return;
      this.handlePythonDisconnect();
    });
  }
}
