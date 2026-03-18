import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cache = new Map<string, number>();

export async function getMp4DurationMs(filePath: string): Promise<number> {
  const cached = cache.get(filePath);
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
  cache.set(filePath, ms);
  return ms;
}
