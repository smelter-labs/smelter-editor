import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const durationCache = new Map<string, number>();
const dimensionsCache = new Map<
  string,
  { width: number; height: number } | null
>();

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

export async function getMp4VideoDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  if (dimensionsCache.has(filePath)) return dimensionsCache.get(filePath)!;

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
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0];
    if (!stream || !stream.width || !stream.height) {
      dimensionsCache.set(filePath, null);
      return null;
    }
    let { width, height } = stream;
    const rotation = stream.side_data_list?.find(
      (d: any) => d.rotation !== undefined,
    )?.rotation;
    if (rotation && (Math.abs(rotation) === 90 || Math.abs(rotation) === 270)) {
      [width, height] = [height, width];
    }
    const result = { width, height };
    dimensionsCache.set(filePath, result);
    return result;
  } catch (err) {
    console.warn(`[mp4] Failed to probe dimensions: ${filePath}`, err);
    dimensionsCache.set(filePath, null);
    return null;
  }
}
