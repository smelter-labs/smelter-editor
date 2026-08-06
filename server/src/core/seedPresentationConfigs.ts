import path from 'node:path';
import { copy, ensureDir, pathExists, readdir } from 'fs-extra';
import { DATA_DIR } from '../dataDir';

// Demo projects bundled with the repo (data/ itself is gitignored). Each JSON
// here is installed into data/presentation-configs at startup, so they show up
// under "Demo Projects" on every deployment.
const DEFAULTS_DIR = path.join(process.cwd(), 'presentation-defaults');
const TARGET_DIR = path.join(DATA_DIR, 'presentation-configs');

/**
 * Install bundled presentation configs that are not present yet. Existing
 * files are never overwritten, so operator edits survive restarts — but a
 * deleted bundled demo comes back on the next start.
 */
export async function seedPresentationConfigs(): Promise<void> {
  if (!(await pathExists(DEFAULTS_DIR))) return;
  await ensureDir(TARGET_DIR);
  for (const fileName of await readdir(DEFAULTS_DIR)) {
    if (!fileName.endsWith('.json')) continue;
    const target = path.join(TARGET_DIR, fileName);
    if (await pathExists(target)) continue;
    await copy(path.join(DEFAULTS_DIR, fileName), target);
    console.log(`[seed] Installed bundled presentation config: ${fileName}`);
  }
}
