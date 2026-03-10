import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { SmelterInstance } from '../smelter';

type MotionProcess = {
  process: ChildProcess;
  port: number;
  outputId: string;
  onScore: (score: number) => void;
};

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
  // Explicit override via env var
  if (process.env.MOTION_PYTHON_PATH) {
    return process.env.MOTION_PYTHON_PATH;
  }
  // If venv exists, use it
  const venvPython = getVenvPython();
  if (existsSync(venvPython)) {
    return venvPython;
  }
  // Fallback (Docker / system python)
  return 'python3';
}

let globalNextPort = 20000;

export class MotionManager {
  private processes: Map<string, MotionProcess> = new Map();
  private pythonReady = false;
  private pythonSetupPromise: Promise<void> | null = null;

  /**
   * Ensure Python venv exists with opencv + numpy installed.
   * Runs once, skipped in Docker where system python already has deps.
   */
  private async ensurePython(): Promise<void> {
    if (this.pythonReady) return;
    if (this.pythonSetupPromise) return this.pythonSetupPromise;

    this.pythonSetupPromise = this._setupPython();
    await this.pythonSetupPromise;
    this.pythonReady = true;
  }

  private async _setupPython(): Promise<void> {
    const pythonPath = getPythonPath();

    // If using explicit path or system python (Docker), just verify it works
    if (process.env.MOTION_PYTHON_PATH || !existsSync(REQUIREMENTS_FILE)) {
      try {
        execSync(`${pythonPath} -c "import cv2; import numpy"`, { stdio: 'ignore' });
        console.log('[motion] Python dependencies OK');
      } catch {
        console.warn('[motion] Python dependencies missing — motion detection will not work');
        console.warn('[motion] Install: pip3 install opencv-python-headless numpy');
      }
      return;
    }

    // Check if venv already has the deps
    const venvPython = getVenvPython();
    if (existsSync(venvPython)) {
      try {
        execSync(`${venvPython} -c "import cv2; import numpy"`, { stdio: 'ignore' });
        console.log('[motion] Venv ready');
        return;
      } catch {
        // venv exists but deps missing — reinstall below
      }
    }

    // Create venv and install deps
    console.log('[motion] Setting up Python venv...');
    try {
      if (!existsSync(VENV_DIR)) {
        execSync(`python3 -m venv ${VENV_DIR}`, { cwd: MOTION_DIR, stdio: 'pipe' });
      }
      execSync(`${venvPython} -m pip install --quiet -r ${REQUIREMENTS_FILE}`, {
        cwd: MOTION_DIR,
        stdio: 'pipe',
      });
      console.log('[motion] Venv created and dependencies installed');
    } catch (err) {
      console.error('[motion] Failed to setup Python venv:', err);
      console.warn('[motion] Motion detection will not work. Install manually:');
      console.warn('[motion]   cd server/motion && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt');
    }
  }

  async startMotionDetection(inputId: string, onScore: (score: number) => void): Promise<void> {
    const existing = this.processes.get(inputId);
    if (existing) {
      existing.onScore = onScore;
      return;
    }

    await this.ensurePython();

    const port = globalNextPort++;
    const outputId = `motion::${inputId}`;

    // Spawn ffmpeg FIRST so it's already listening on the UDP port
    // before Smelter starts sending RTP packets (including the initial keyframe).
    const pythonPath = getPythonPath();
    console.log(`[motion] Starting detection for ${inputId} on port ${port} using ${pythonPath}`);
    const child = spawn(pythonPath, [SCRIPT_PATH, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Give ffmpeg a moment to bind the UDP socket before Smelter starts streaming
    await new Promise((resolve) => setTimeout(resolve, 500));

    await SmelterInstance.registerMotionOutput(outputId, inputId, port);

    const entry: MotionProcess = { process: child, port, outputId, onScore };
    this.processes.set(inputId, entry);

    const stderrRl = createInterface({ input: child.stderr! });
    stderrRl.on('line', (line) => {
      console.log(`[motion][${inputId}] ${line}`);
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      try {
        const data = JSON.parse(line);
        if (typeof data.score === 'number') {
          entry.onScore(data.score);
        }
      } catch {
        // ignore malformed lines
      }
    });

    child.on('exit', (code) => {
      console.log(`[motion] Process for ${inputId} exited with code ${code}`);
      this.processes.delete(inputId);
      entry.onScore(-1);
    });
  }

  async stopMotionDetection(inputId: string): Promise<void> {
    const entry = this.processes.get(inputId);
    if (!entry) return;

    this.processes.delete(inputId);
    entry.process.kill('SIGTERM');

    try {
      await SmelterInstance.unregisterMotionOutput(entry.outputId);
    } catch (err) {
      console.error(`[motion] Failed to unregister motion output for ${inputId}`, err);
    }
  }

  async stopAll(): Promise<void> {
    const inputIds = [...this.processes.keys()];
    await Promise.all(inputIds.map((id) => this.stopMotionDetection(id)));
  }
}
