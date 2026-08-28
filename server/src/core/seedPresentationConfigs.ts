import path from 'node:path';
import { DATA_DIR } from '../dataDir';
import { seedBundledDir } from './seedBundledDir';

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
  await seedBundledDir(
    DEFAULTS_DIR,
    TARGET_DIR,
    '.json',
    'bundled presentation config',
  );
}
