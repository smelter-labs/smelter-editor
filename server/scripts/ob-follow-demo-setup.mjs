#!/usr/bin/env node
// Builds the FOLLOW quick demo (data/mp4s/ob-demo/follow/): three background
// file cams with "something happening", copied from the demo clips already on
// this box (nba / panel — any that exist, at least one required), plus a
// cams.json that loads the `follow` preset with audio MIX, auto pilot ON and
// host recognition enabled. The person then joins their phone by QR as the
// camera the host walks into (gold baseball cap by default).
//
//   node scripts/ob-follow-demo-setup.mjs
//
// data/ is gitignored — run this once per box (after the nba/panel demos
// exist, see scripts/ob-demo/*).

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'mp4s',
  'ob-demo',
);

/** Background cams: first existing source wins per slot. */
const SLOTS = [
  {
    file: 'court.mp4',
    sources: ['nba/wide.mp4'],
    role: 'wide',
    name: 'COURT',
    subtitle: 'pickup game',
  },
  {
    file: 'street.mp4',
    sources: ['nba/tape.mp4', 'panel/slides.mp4'],
    role: 'audience',
    name: 'STREET',
    subtitle: 'drive & shoot',
  },
  {
    file: 'panel.mp4',
    sources: ['panel/wide.mp4', 'panel/host.mp4'],
    role: 'guest',
    name: 'PANEL',
    subtitle: 'the talking heads',
  },
];

const manifest = {
  eventName: 'Follow the Host',
  presetId: 'follow',
  // Captions would delay every camera to 8 s — the follow cut must be snappy.
  captions: false,
  audio: { mode: 'mix' },
  brief: '',
  config: {
    autoPilot: true,
    subtitles: false,
    host: { enabled: true, description: 'wears a GOLD baseball cap' },
  },
  cams: [],
};

const dir = path.join(ROOT, 'follow');
mkdirSync(dir, { recursive: true });
for (const slot of SLOTS) {
  const source = slot.sources.find((s) => existsSync(path.join(ROOT, s)));
  if (!source) {
    console.warn(`skip ${slot.file}: none of ${slot.sources.join(', ')} exist`);
    continue;
  }
  copyFileSync(path.join(ROOT, source), path.join(dir, slot.file));
  manifest.cams.push({
    file: slot.file,
    role: slot.role,
    name: slot.name,
    talent: null,
    subtitle: slot.subtitle,
    optional: true,
  });
  console.log(`${slot.file} ← ${source} (${slot.role})`);
}
if (!manifest.cams.length) {
  console.error(
    'no background clips found — build the nba/ or panel/ demo first',
  );
  process.exit(1);
}
writeFileSync(
  path.join(dir, 'cams.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `wrote ${path.join(dir, 'cams.json')} (${manifest.cams.length} background cams)`,
);
console.log(
  'QUICK DEMOS now lists "Follow the Host": load it, join a phone by QR, go live, walk in wearing the gold cap.',
);
