import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const durationCache = new Map<string, number>();
const videoProbeCache = new Map<string, VideoProbe | null>();

type VideoProbe = {
  /** Coded frame size, before the display matrix is applied. */
  width: number;
  height: number;
  /** Degrees the display matrix turns the coded frames: 0, 90, 180 or 270. */
  rotation: number;
};

type FfprobeVideoStream = {
  width?: number;
  height?: number;
  side_data_list?: { rotation?: number }[];
};

export async function getMp4DurationMs(filePath: string): Promise<number> {
  const cached = durationCache.get(filePath);
  if (cached !== undefined) return cached;

  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    filePath,
  ]);
  const ms = Math.round(parseFloat(stdout.trim()) * 1000);
  if (!Number.isFinite(ms)) {
    throw new Error(`Could not parse MP4 duration: ${filePath}`);
  }
  durationCache.set(filePath, ms);
  return ms;
}

async function probeMp4Video(filePath: string): Promise<VideoProbe | null> {
  if (videoProbeCache.has(filePath)) return videoProbeCache.get(filePath)!;

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-show_entries',
      'stream_side_data=rotation',
      '-of',
      'json',
      filePath,
    ]);
    const parsed: { streams?: FfprobeVideoStream[] } = JSON.parse(stdout);
    const stream = parsed.streams?.[0];
    if (!stream || !stream.width || !stream.height) {
      videoProbeCache.set(filePath, null);
      return null;
    }
    const rawRotation =
      stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
      0;
    const result = {
      width: stream.width,
      height: stream.height,
      rotation: ((Math.round(rawRotation) % 360) + 360) % 360,
    };
    videoProbeCache.set(filePath, result);
    return result;
  } catch (err) {
    console.warn(`[mp4] Failed to probe dimensions: ${filePath}`, err);
    videoProbeCache.set(filePath, null);
    return null;
  }
}

/** Frame size as displayed, i.e. with the display-matrix rotation applied. */
export async function getMp4VideoDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  const probe = await probeMp4Video(filePath);
  if (!probe) return null;
  return probe.rotation === 90 || probe.rotation === 270
    ? { width: probe.height, height: probe.width }
    : { width: probe.width, height: probe.height };
}

/** Degrees the display matrix turns the coded frames (0 = upright as coded). */
export async function getMp4Rotation(filePath: string): Promise<number> {
  return (await probeMp4Video(filePath))?.rotation ?? 0;
}
