import path from 'node:path';
import { copy, ensureDir, pathExists, readdir } from 'fs-extra';

/**
 * Install files with `ext` from a repo-bundled defaults dir into a (gitignored)
 * data dir, so they survive a fresh checkout/deploy. Existing files are never
 * overwritten — operator edits survive restarts, but a deleted bundled file
 * comes back on the next start. Returns the number of files installed.
 */
export async function seedBundledDir(
  srcDir: string,
  targetDir: string,
  ext: string,
  label: string,
): Promise<number> {
  if (!(await pathExists(srcDir))) return 0;
  await ensureDir(targetDir);
  let installed = 0;
  for (const fileName of await readdir(srcDir)) {
    if (!fileName.endsWith(ext)) continue;
    const target = path.join(targetDir, fileName);
    if (await pathExists(target)) continue;
    await copy(path.join(srcDir, fileName), target);
    installed += 1;
    console.log(`[seed] Installed ${label}: ${fileName}`);
  }
  return installed;
}
