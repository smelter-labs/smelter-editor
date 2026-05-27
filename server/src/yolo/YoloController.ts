import type { YoloSearchConfig, YoloBoundingBox } from '../types';
import type { RoomInputState } from '../room/types';
import { getSideChannelSocketDir } from '../smelter';

/**
 * Payload sent by the YOLO server to the callback URL on every frame.
 * Box coordinates are in the input's native pixel space.
 */
export type YoloCallbackPayload = {
  task_id: string;
  input_id: string;
  boxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    class_name: string;
    class_id: number;
    confidence: number;
  }>;
  frame_width: number;
  frame_height: number;
  pts_nanos?: number;
};

const SERVER_PORT = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
const SERVER_BASE_URL =
  process.env.YOLO_CALLBACK_BASE_URL ?? `http://127.0.0.1:${SERVER_PORT}`;

export class YoloController {
  /** inputId → { task_id, serverUrl } */
  private activeTasks = new Map<
    string,
    { taskId: string; serverUrl: string }
  >();

  constructor(
    private readonly roomId: string,
    private readonly onBoxesReceived: (
      inputId: string,
      boxes: YoloBoundingBox[],
    ) => void,
  ) {}

  async setYoloConfig(
    input: RoomInputState,
    config: YoloSearchConfig | undefined,
  ): Promise<void> {
    const isActive = config?.enabled && !!config.serverUrl;

    if (isActive) {
      await this._start(input, config!);
    } else {
      await this.stopInput(input.inputId);
      this.onBoxesReceived(input.inputId, []);
    }

    input.yoloSearchConfig = config;
  }

  /**
   * Called by the route handler when the YOLO server POSTs detection results.
   * Normalises box coordinates to [0, 1] relative to the reported frame size
   * so the rendering layer can scale them to any output resolution.
   */
  receiveBoxes(inputId: string, payload: YoloCallbackPayload): void {
    const { frame_width: fw, frame_height: fh } = payload;
    const boxes: YoloBoundingBox[] = payload.boxes.map((b) => ({
      x: b.x / fw,
      y: b.y / fh,
      width: b.width / fw,
      height: b.height / fh,
      className: b.class_name,
      confidence: b.confidence,
    }));
    const now = Date.now();
    const last = this._lastBoxLogAt.get(inputId) ?? 0;
    if (now - last >= 2000) {
      console.log(
        `[yolo] receiveBoxes inputId=${inputId} count=${boxes.length} frame=${fw}x${fh} task=${payload.task_id}`,
      );
      this._lastBoxLogAt.set(inputId, now);
    }
    this.onBoxesReceived(inputId, boxes);
  }

  private _lastBoxLogAt = new Map<string, number>();

  async stopAll(): Promise<void> {
    const entries = [...this.activeTasks.entries()];
    this.activeTasks.clear();
    await Promise.allSettled(
      entries.map(([, { taskId, serverUrl }]) =>
        this._stopTask(taskId, serverUrl).catch(() =>
          console.warn(`[yolo] stopAll: could not stop task ${taskId}`),
        ),
      ),
    );
  }

  async stopInput(inputId: string): Promise<void> {
    const entry = this.activeTasks.get(inputId);
    if (!entry) return;
    this.activeTasks.delete(inputId);
    await this._stopTask(entry.taskId, entry.serverUrl);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _start(
    input: RoomInputState,
    config: YoloSearchConfig,
  ): Promise<void> {
    // Stop any existing task for this input first
    await this.stopInput(input.inputId);

    const health = await this._checkHealth(config.serverUrl);
    if (!health) {
      console.warn(
        `[yolo] Health check failed for ${input.inputId} at ${config.serverUrl}`,
      );
      return;
    }
    const expectedSocketDir = getSideChannelSocketDir();
    if (health.socket_dir && health.socket_dir !== expectedSocketDir) {
      console.warn(
        `[yolo] Socket dir mismatch for ${input.inputId}: server=${health.socket_dir} local=${expectedSocketDir}`,
      );
    }

    const taskId = `${this.roomId}::${input.inputId}`;
    const callbackUrl = `${SERVER_BASE_URL}/room/${encodeURIComponent(this.roomId)}/input/${encodeURIComponent(input.inputId)}/yolo-boxes`;

    try {
      const response = await fetch(`${config.serverUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Side channel: the Python server attaches directly to the input's
          // unix socket (video_<input_id>.sock) under the same socket dir
          // exported by the Node server. The smelter binary writes sockets
          // as `video_global:<inputId>.sock`, so the side-channel SDK reports
          // input_id as `global:<inputId>`; we must match that format.
          input_id: `global:${input.inputId}`,
          socket_dir: getSideChannelSocketDir(),
          callback_url: callbackUrl,
          class_filter: config.targetClass || undefined,
          confidence: 0.25,
          task_id: taskId,
          model_name: config.modelName || undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[yolo] /start failed for ${input.inputId}: ${response.status} ${text}`,
        );
        return;
      }

      const data = (await response.json()) as { task_id: string };
      this.activeTasks.set(input.inputId, {
        taskId: data.task_id,
        serverUrl: config.serverUrl,
      });
      console.log(
        `[yolo] Started task ${data.task_id} (side-channel) for input ${input.inputId}`,
      );
    } catch (err) {
      console.error(
        `[yolo] Cannot reach YOLO server for ${input.inputId}:`,
        err,
      );
    }
  }

  private async _stopTask(taskId: string, serverUrl: string): Promise<void> {
    try {
      await fetch(`${serverUrl}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
        signal: AbortSignal.timeout(3000),
      });
      console.log(`[yolo] Stopped task ${taskId}`);
    } catch (err) {
      console.warn(`[yolo] Could not stop task ${taskId}:`, err);
    }
  }

  private async _checkHealth(
    serverUrl: string,
  ): Promise<{
    status?: string;
    socket_dir?: string;
    active_tasks?: string[];
  } | null> {
    try {
      const response = await fetch(`${serverUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        console.warn(
          `[yolo] Health check failed: ${serverUrl} returned ${response.status}`,
        );
        return null;
      }
      return (await response.json()) as {
        status?: string;
        socket_dir?: string;
        active_tasks?: string[];
      };
    } catch (err) {
      console.warn(`[yolo] Health check error for ${serverUrl}:`, err);
      return null;
    }
  }
}
