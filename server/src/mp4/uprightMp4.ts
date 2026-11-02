import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureDir, move, pathExists, stat } from 'fs-extra';
import { DATA_DIR } from '../dataDir';
import { getMp4Rotation } from '../routing/mp4Duration';

const execFileAsync = promisify(execFile);

const LIBRARY_DIR = path.join(DATA_DIR, 'mp4s') + path.sep;
const UPRIGHT_DIR = path.join(DATA_DIR, 'mp4-upright');

/** Source path + size + mtime → its upright copy (in flight or done). */
const bakes = new Map<string, Promise<string>>();

/**
 * The file the engine should play for a library clip.
 *
 * The engine decodes an mp4's coded frames and ignores its display matrix, so
 * a clip shot in portrait on a phone or webcam (coded 1920×1080 + "rotate
 * 90") plays lying on its side — on the stage and in every AI model's side
 * channel. Such a clip is re-encoded once with the rotation baked in; the
 * copy lives in data/mp4-upright and is what gets registered from then on.
 * A clip without a rotation is returned as it is, and so is one whose bake
 * fails (sideways beats missing).
 *
 * Only the library (data/mp4s) is checked: everything else the server
 * registers — replays, stingers, recordings — it rendered itself.
 */
export async function uprightMp4Path(filePath: string): Promise<string> {
  if (!filePath.startsWith(LIBRARY_DIR)) return filePath;
  try {
    if ((await getMp4Rotation(filePath)) === 0) return filePath;
    const { size, mtimeMs } = await stat(filePath);
    const key = `${filePath}:${size}:${mtimeMs}`;
    let bake = bakes.get(key);
    if (!bake) {
      bake = bakeUpright(filePath, key);
      bakes.set(key, bake);
    }
    return await bake;
  } catch (err) {
    console.warn(
      `[mp4] Rotation not baked, playing as coded: ${filePath}`,
      err,
    );
    return filePath;
  }
}

async function bakeUpright(filePath: string, key: string): Promise<string> {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  const name = `${path.basename(filePath, path.extname(filePath))}-${hash}`;
  const outPath = path.join(UPRIGHT_DIR, `${name}.mp4`);
  if (await pathExists(outPath)) return outPath;

  await ensureDir(UPRIGHT_DIR);
  const partPath = path.join(UPRIGHT_DIR, `${name}.part.mp4`);
  const t0 = Date.now();
  console.log(`[mp4] Baking rotation into an upright copy: ${filePath}`);
  // ffmpeg applies the display matrix on decode (autorotate) and drops it
  // from the output. Two encoder threads: this may run next to a live show.
  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-i',
    filePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    '30',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-c:a',
    'copy',
    '-y',
    partPath,
  ]);
  await move(partPath, outPath, { overwrite: true });
  console.log(`[mp4] Upright copy ready in ${Date.now() - t0}ms: ${outPath}`);
  return outPath;
}
