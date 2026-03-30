import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { SmelterInstance } from '../smelter';
import {
  createMotionStore,
  MOTION_GRID_WIDTH,
  MOTION_GRID_HEIGHT,
  MOTION_CELL_WIDTH,
  MOTION_MAX_SLOTS,
} from './MotionScene';
import type { StoreApi } from 'zustand';
import type { HandsStore, HandLandmarks } from '../hands/handStore';

const execFileAsync = promisify(execFile);

const MOTION_DIR = path.join(__dirname, '../../motion');
const VENV_DIR = path.join(MOTION_DIR, '.venv');
const REQUIREMENTS_FILE = path.join(MOTION_DIR, 'requirements.txt');
const SCRIPT_PATH = path.join(MOTION_DIR, 'motion_detector.py');

function getVenvPython(): string {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python3');
}

function getPythonPath(): string {
  if (process.env.MOTION_PYTHON_PATH) {
    return process.env.MOTION_PYTHON_PATH;
  }
  const venvPython = getVenvPython();
  if (existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

export class MotionManager {
  private static nextPort = 20000;
  private static readonly PORT_STRIDE = 2;

  private readonly rtpPort: number;
  private readonly outputId: string;

  /** Ordered list of inputIds currently tracked. Index = grid slot. */
  private trackedInputs: string[] = [];
  /** Per-input score callbacks. */
  private callbacks: Map<string, (score: number) => void> = new Map();

  /** Per-input hand tracking stores. Key = sourceInputId. */
  private handStores: Map<string, StoreApi<HandsStore>> = new Map();
  /** Maps inputId → grid slot index for hand-tracked inputs. */
  private handRegions: Map<string, number> = new Map();

  private motionStore = createMotionStore();
  private pythonProcess: ChildProcess | null = null;
  private pipelineRunning = false;

  private pythonReady = false;
  private pythonSetupPromise: Promise<void> | null = null;

  private restartAttempts = 0;
  private readonly MAX_RESTART_ATTEMPTS = 3;

  /** Serializes start/stop calls. */
  private queue: Promise<void> = Promise.resolve();

  constructor(roomId: string) {
    this.rtpPort = MotionManager.nextPort;
    MotionManager.nextPort += MotionManager.PORT_STRIDE;
    this.outputId = `motion::grid::${roomId}`;
  }

  // ── Python venv setup ─────────────────────────────────────────

  private async ensurePython(): Promise<void> {
    if (this.pythonReady) return;
    if (this.pythonSetupPromise) return this.pythonSetupPromise;
    this.pythonSetupPromise = this._setupPython();
    await this.pythonSetupPromise;
    this.pythonReady = true;
  }

  private async _setupPython(): Promise<void> {
    const pythonPath = getPythonPath();

    if (process.env.MOTION_PYTHON_PATH || !existsSync(REQUIREMENTS_FILE)) {
      try {
        await execFileAsync(pythonPath, ['-c', 'import cv2; import numpy']);
        console.log('[motion] Python dependencies OK');
      } catch {
        console.warn(
          '[motion] Python dependencies missing — motion detection will not work',
        );
        console.warn(
          '[motion] Install: pip3 install opencv-python-headless numpy',
        );
      }
      return;
    }

    const venvPython = getVenvPython();
    if (existsSync(venvPython)) {
      try {
        await execFileAsync(venvPython, ['-c', 'import cv2; import numpy']);
        console.log('[motion] Venv ready');
        return;
      } catch {
        // venv exists but deps missing — reinstall below
      }
    }

    console.log('[motion] Setting up Python venv...');
    try {
      if (!existsSync(VENV_DIR)) {
        await execFileAsync('python3', ['-m', 'venv', VENV_DIR], {
          cwd: MOTION_DIR,
        });
      }
      await execFileAsync(
        venvPython,
        ['-m', 'pip', 'install', '--quiet', '-r', REQUIREMENTS_FILE],
        {
          cwd: MOTION_DIR,
        },
      );
      console.log('[motion] Venv created and dependencies installed');
    } catch (err) {
      console.error('[motion] Failed to setup Python venv:', err);
      console.warn(
        '[motion] Motion detection will not work. Install manually:',
      );
      console.warn(
        '[motion]   cd server/motion && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────

  async startMotionDetection(
    inputId: string,
    onScore: (score: number) => void,
  ): Promise<void> {
    if (this.callbacks.has(inputId)) {
      this.callbacks.set(inputId, onScore);
      return;
    }

    const prev = this.queue;
    this.queue = prev
      .then(() => this._addInput(inputId, onScore))
      .catch(() => {});
    await this.queue;
  }

  async stopMotionDetection(inputId: string): Promise<void> {
    if (!this.callbacks.has(inputId)) return;

    const prev = this.queue;
    this.queue = prev.then(() => this._removeInput(inputId)).catch(() => {});
    await this.queue;
  }

  async stopAll(): Promise<void> {
    const ids = [...this.callbacks.keys()];
    for (const id of ids) {
      await this.stopMotionDetection(id);
    }
    for (const [inputId] of this.handRegions) {
      this.stopHandTracking(inputId);
    }
  }

  /**
   * Ensure an input is in the motion grid (for hand tracking purposes).
   * If already tracked for motion, does nothing.
   * Returns the grid slot index.
   */
  async ensureInGrid(inputId: string): Promise<number> {
    const existingIdx = this.trackedInputs.indexOf(inputId);
    if (existingIdx >= 0) return existingIdx;

    const prev = this.queue;
    let slotIdx = -1;
    this.queue = prev
      .then(async () => {
        if (this.trackedInputs.length >= MOTION_MAX_SLOTS) {
          console.warn(
            `[motion] Max ${MOTION_MAX_SLOTS} motion inputs reached, cannot add ${inputId} for hand tracking`,
          );
          return;
        }
        this.trackedInputs.push(inputId);
        slotIdx = this.trackedInputs.length - 1;
        this._syncStore();
        if (!this.pipelineRunning) {
          await this._startPipeline();
        }
      })
      .catch(() => {});
    await this.queue;
    return slotIdx;
  }

  /**
   * Start hand tracking for a given source input.
   * Ensures the input is in the grid and sends enable_hands to Python.
   */
  async startHandTracking(
    inputId: string,
    store: StoreApi<HandsStore>,
  ): Promise<void> {
    const slotIdx = await this.ensureInGrid(inputId);
    if (slotIdx < 0) return;

    this.handStores.set(inputId, store);
    this.handRegions.set(inputId, slotIdx);

    this._sendStdinCommand({ cmd: 'enable_hands', region: slotIdx });
    console.log(
      `[motion] Hand tracking started for ${inputId} at slot ${slotIdx}`,
    );
  }

  /**
   * Stop hand tracking for a given source input.
   * Does NOT remove the input from the grid (it may still be used for motion).
   */
  stopHandTracking(inputId: string): void {
    const slotIdx = this.handRegions.get(inputId);
    if (slotIdx !== undefined) {
      this._sendStdinCommand({ cmd: 'disable_hands', region: slotIdx });
    }
    this.handStores.delete(inputId);
    this.handRegions.delete(inputId);
    console.log(`[motion] Hand tracking stopped for ${inputId}`);
  }

  // ── Internal ──────────────────────────────────────────────────

  private _sendStdinCommand(cmd: object): void {
    if (this.pythonProcess?.stdin?.writable) {
      this.pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
    }
  }

  private async _addInput(
    inputId: string,
    onScore: (score: number) => void,
  ): Promise<void> {
    if (this.trackedInputs.length >= MOTION_MAX_SLOTS) {
      console.warn(
        `[motion] Max ${MOTION_MAX_SLOTS} motion inputs reached, ignoring ${inputId}`,
      );
      return;
    }

    this.callbacks.set(inputId, onScore);
    this.trackedInputs.push(inputId);
    this._syncStore();

    if (!this.pipelineRunning) {
      await this._startPipeline();
    }
  }

  private async _removeInput(inputId: string): Promise<void> {
    this.callbacks.delete(inputId);

    if (this.handRegions.has(inputId)) {
      this.stopHandTracking(inputId);
    }

    this.trackedInputs = this.trackedInputs.filter((id) => id !== inputId);
    this._syncStore();

    if (this.trackedInputs.length === 0 && this.handRegions.size === 0) {
      await this._teardown();
    }
  }

  /** Push current trackedInputs into the Zustand store → React re-renders the grid. */
  private _syncStore(): void {
    this.motionStore.getState().setInputIds([...this.trackedInputs]);
    console.log(
      `[motion] Grid updated: ${this.trackedInputs.length} inputs [${this.trackedInputs.join(', ')}]`,
    );
  }

  /**
   * Start the full pipeline once: spawn Python, wait for ready,
   * register a fixed-resolution Smelter output.
   */
  private async _startPipeline(): Promise<void> {
    await this.ensurePython();

    const pythonPath = getPythonPath();
    console.log(
      `[motion] Starting grid pipeline: ${MOTION_GRID_WIDTH}x${MOTION_GRID_HEIGHT} (${MOTION_MAX_SLOTS} slots, cell ${MOTION_CELL_WIDTH}x${MOTION_GRID_HEIGHT}) on port ${this.rtpPort}`,
    );

    const handRegionArgs: string[] = [];
    if (this.handRegions.size > 0) {
      const regions = [...this.handRegions.values()].join(',');
      handRegionArgs.push('--hand-regions', regions);
    }

    const child = spawn(
      pythonPath,
      [
        SCRIPT_PATH,
        '--port',
        String(this.rtpPort),
        '--width',
        String(MOTION_GRID_WIDTH),
        '--height',
        String(MOTION_GRID_HEIGHT),
        '--regions',
        String(MOTION_MAX_SLOTS),
        ...handRegionArgs,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.pythonProcess = child;

    const stderrRl = createInterface({ input: child.stderr! });
    let stderrLineCount = 0;
    const STDERR_INITIAL_LINES = 5;
    const stderrFilter = /error|warning|fatal|critical/i;
    stderrRl.on('line', (line) => {
      stderrLineCount++;
      if (stderrLineCount <= STDERR_INITIAL_LINES || stderrFilter.test(line)) {
        console.log(`[motion][grid] ${line}`);
      }
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      try {
        const data = JSON.parse(line);
        if (data.scores && typeof data.scores === 'object') {
          for (const [indexStr, score] of Object.entries(data.scores)) {
            const idx = Number(indexStr);
            const id = this.trackedInputs[idx];
            if (id) {
              const cb = this.callbacks.get(id);
              if (cb) {
                cb(score as number);
              }
            }
          }
        }
        if (data.hands && typeof data.hands === 'object') {
          for (const [indexStr, handsArr] of Object.entries(data.hands)) {
            const idx = Number(indexStr);
            const id = this.trackedInputs[idx];
            if (id) {
              const store = this.handStores.get(id);
              if (store) {
                store
                  .getState()
                  .setLandmarks({ hands: handsArr as HandLandmarks['hands'] });
              }
            }
          }
        }
      } catch {
        // ignore malformed lines
      }
    });

    child.on('exit', (code) => {
      console.log(`[motion] Grid Python process exited with code ${code}`);
      if (this.pythonProcess === child) {
        this.pythonProcess = null;
        this.pipelineRunning = false;
        for (const id of this.trackedInputs) {
          const cb = this.callbacks.get(id);
          if (cb) cb(-1);
        }
        if (
          this.trackedInputs.length > 0 &&
          this.restartAttempts < this.MAX_RESTART_ATTEMPTS
        ) {
          const delay = Math.min(
            1000 * Math.pow(2, this.restartAttempts),
            8000,
          );
          this.restartAttempts++;
          console.log(
            `[motion] Restarting pipeline in ${delay}ms (attempt ${this.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`,
          );
          setTimeout(() => {
            this._startPipeline().catch((err) => {
              console.error('[motion] Restart failed', err);
            });
          }, delay);
        }
      }
    });

    // Wait for Python ready signal (ffmpeg has bound the UDP socket)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[motion] Ready signal timeout, proceeding anyway');
        resolve();
      }, 5000);

      let resolved = false;
      const onLine = (line: string) => {
        if (resolved) return;
        try {
          const data = JSON.parse(line);
          if (data.ready) {
            resolved = true;
            clearTimeout(timeout);
            setTimeout(resolve, 200);
          }
        } catch {
          // ignore
        }
      };
      rl.on('line', onLine);
      child.on('exit', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Register fixed-resolution Smelter output (once — scene updates via Zustand)
    try {
      await SmelterInstance.registerMotionOutput(
        this.outputId,
        this.motionStore,
        this.rtpPort,
      );
      this.pipelineRunning = true;
      this.restartAttempts = 0;
    } catch (err) {
      this._killPython();
      throw err;
    }
  }

  private async _teardown(): Promise<void> {
    this._killPython();
    this.motionStore.getState().setInputIds([]);

    if (this.pipelineRunning) {
      try {
        await SmelterInstance.unregisterMotionOutput(this.outputId);
      } catch (err) {
        console.error('[motion] Failed to unregister motion output', err);
      }
      this.pipelineRunning = false;
    }
  }

  private _killPython(): void {
    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
    }
  }
}
