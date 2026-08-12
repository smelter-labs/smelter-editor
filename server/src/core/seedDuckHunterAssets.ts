import path from 'node:path';
import { copy, ensureDir, pathExists, readdir } from 'fs-extra';
import { DATA_DIR } from '../dataDir';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';

// Character-select clips for the /duck-hunter arcade page, bundled with the
// repo (data/ itself is gitignored). Installed into data/mp4s at startup so
// the page can stream them via /play/mp4/duck-hunter-characters/<file> and
// they survive a fresh checkout/deploy.
const DEFAULTS_DIR = path.join(process.cwd(), 'duck-hunter-defaults');
const TARGET_DIR = path.join(DATA_DIR, 'mp4s', 'duck-hunter-characters');

/**
 * Install bundled Duck Hunter character clips that are not present yet.
 * Existing files are never overwritten.
 */
export async function seedDuckHunterAssets(): Promise<void> {
  if (!(await pathExists(DEFAULTS_DIR))) return;
  await ensureDir(TARGET_DIR);
  let installed = 0;
  for (const fileName of await readdir(DEFAULTS_DIR)) {
    if (!fileName.endsWith('.mp4')) continue;
    const target = path.join(TARGET_DIR, fileName);
    if (await pathExists(target)) continue;
    await copy(path.join(DEFAULTS_DIR, fileName), target);
    installed += 1;
    console.log(`[seed] Installed Duck Hunter character clip: ${fileName}`);
  }
  if (installed > 0) mp4SuggestionsMonitor.refresh();
}
