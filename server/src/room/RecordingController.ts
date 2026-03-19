import { ensureDir, pathExists, readdir, remove } from 'fs-extra';
import path from 'node:path';
import { SmelterInstance, type SmelterOutput } from '../smelter';

export class RecordingController {
  private recording?: {
    outputId: string;
    filePath: string;
    fileName: string;
    startedAt: number;
    stoppedAt?: number;
  };

  constructor(
    private readonly idPrefix: string,
    private readonly output: SmelterOutput,
  ) {}

  hasActiveRecording(): boolean {
    return !!this.recording && !this.recording.stoppedAt;
  }

  async startRecording(): Promise<{ fileName: string }> {
    if (this.hasActiveRecording()) {
      throw new Error('Recording is already in progress for this room');
    }

    const recordingsDir = path.join(process.cwd(), 'recordings');
    await ensureDir(recordingsDir);

    const timestamp = Date.now();
    const recordingId = `${this.idPrefix}::recording::${timestamp}`;
    const safeRoomId = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `recording-${safeRoomId}-${timestamp}.mp4`;
    const filePath = path.join(recordingsDir, fileName);

    await SmelterInstance.registerMp4Output(recordingId, this.output, filePath);

    this.recording = {
      outputId: recordingId,
      filePath,
      fileName,
      startedAt: timestamp,
    };

    return { fileName };
  }

  async stopRecording(): Promise<{ fileName: string }> {
    if (!this.recording || this.recording.stoppedAt) {
      throw new Error('No active recording to stop for this room');
    }

    try {
      await SmelterInstance.unregisterOutput(this.recording.outputId);
    } finally {
      this.recording.stoppedAt = Date.now();
    }

    try {
      await pruneOldRecordings(10);
    } catch (err) {
      console.error('Failed to prune old recordings', err);
    }

    return { fileName: this.recording.fileName };
  }

  async cleanup(): Promise<void> {
    if (this.recording && !this.recording.stoppedAt) {
      try {
        await SmelterInstance.unregisterOutput(this.recording.outputId);
      } catch (err: any) {
        console.error('Failed to remove recording output', err?.body ?? err);
      }
    }
  }
}

async function pruneOldRecordings(maxCount: number): Promise<void> {
  const recordingsDir = path.join(process.cwd(), 'recordings');
  if (!(await pathExists(recordingsDir))) return;

  let entries: string[] = [];
  try {
    entries = await readdir(recordingsDir);
  } catch {
    return;
  }

  const mp4s = entries.filter((e) => e.toLowerCase().endsWith('.mp4'));
  if (mp4s.length <= maxCount) return;

  type RecordingFile = { name: string; timestamp: number };
  const parsed: RecordingFile[] = [];

  for (const file of mp4s) {
    const match = file.match(/^recording-.*-(\d+)\.mp4$/);
    const ts = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(ts)) {
      parsed.push({ name: file, timestamp: 0 });
    } else {
      parsed.push({ name: file, timestamp: ts });
    }
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);

  const toDelete = parsed.slice(0, Math.max(0, parsed.length - maxCount));
  for (const file of toDelete) {
    const fullPath = path.join(recordingsDir, file.name);
    try {
      await remove(fullPath);
    } catch (err) {
      console.warn('Failed to remove old recording file', {
        file: fullPath,
        err,
      });
    }
  }
}
