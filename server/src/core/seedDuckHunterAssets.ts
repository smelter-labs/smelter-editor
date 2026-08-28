import path from 'node:path';
import { DATA_DIR } from '../dataDir';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import { seedBundledDir } from './seedBundledDir';

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
  const installed = await seedBundledDir(
    DEFAULTS_DIR,
    TARGET_DIR,
    '.mp4',
    'Duck Hunter character clip',
  );
  if (installed > 0) mp4SuggestionsMonitor.refresh();
}
