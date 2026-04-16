import type { YoloSearchConfig, YoloBoundingBox } from '../types';
import type { RoomInputState } from '../room/types';

/**
 * Payload sent by the YOLO server to the callback URL on every frame.
 */
export type YoloCallbackPayload = {
  task_id: string;
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
};

const SUPPORTED_INPUT_TYPES: RoomInputState['type'][] = [
  'twitch-channel',
  'kick-channel',
  'hls',
  'local-mp4',
];

const SERVER_PORT = Number(process.env.SMELTER_DEMO_API_PORT) || 3001;
const SERVER_BASE_URL =
  process.env.YOLO_CALLBACK_BASE_URL ?? `http://127.0.0.1:${SERVER_PORT}`;

function getStreamUrl(input: RoomInputState): string | null {
  switch (input.type) {
    case 'twitch-channel':
    case 'kick-channel':
      return input.hlsUrl;
    case 'hls':
      return input.hlsUrl;
    case 'local-mp4':
      return input.mp4FilePath;
    default:
      return null;
  }
}

export class YoloController {
  /** inputId → { task_id, serverUrl } */
  private activeTasks = new Map<string, { taskId: string; serverUrl: string }>();

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
   */
  receiveBoxes(inputId: string, payload: YoloCallbackPayload): void {
    const boxes: YoloBoundingBox[] = payload.boxes.map((b) => ({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      className: b.class_name,
      confidence: b.confidence,
    }));
    this.onBoxesReceived(inputId, boxes);
  }

  async stopAll(): Promise<void> {
    const entries = [...this.activeTasks.entries()];
    this.activeTasks.clear();
    await Promise.allSettled(
      entries.map(([inputId, { taskId, serverUrl }]) =>
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
    if (!SUPPORTED_INPUT_TYPES.includes(input.type)) {
      console.warn(
        `[yolo] Input type ${input.type} not supported for YOLO detection`,
      );
      return;
    }

    const streamUrl = getStreamUrl(input);
    if (!streamUrl) return;

    // Stop any existing task for this input first
    await this.stopInput(input.inputId);

    const taskId = `${this.roomId}::${input.inputId}`;
    const callbackUrl = `${SERVER_BASE_URL}/room/${encodeURIComponent(this.roomId)}/input/${encodeURIComponent(input.inputId)}/yolo-boxes`;

    try {
      const response = await fetch(`${config.serverUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_url: streamUrl,
          callback_url: callbackUrl,
          class_filter: config.targetClass || undefined,
          confidence: 0.25,
          task_id: taskId,
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
        `[yolo] Started task ${data.task_id} for input ${input.inputId} → ${streamUrl}`,
      );
    } catch (err) {
      console.error(`[yolo] Cannot reach YOLO server for ${input.inputId}:`, err);
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
}
