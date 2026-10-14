#!/usr/bin/env node
// Stages the in-browser hand-tracking assets into public/hand-tracking/ so
// phones on a LAN without internet can load them: the MediaPipe wasm bundle
// is copied out of node_modules, and the hand_landmarker.task model (not in
// the npm package) is downloaded once from Google's CDN — the same file the
// server-side Python worker uses. Re-runs skip anything already staged.
//
//   node scripts/fetch-hand-landmarker.mjs

import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const editorDir = path.join(root, '..');
const wasmSrc = path.join(
  editorDir,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm',
);
const outDir = path.join(editorDir, 'public', 'hand-tracking');
const wasmOut = path.join(outDir, 'wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/' +
  'hand_landmarker/float16/latest/hand_landmarker.task';
const modelOut = path.join(outDir, 'hand_landmarker.task');

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(wasmOut, { recursive: true });
for (const file of await readdir(wasmSrc)) {
  const dst = path.join(wasmOut, file);
  if (await exists(dst)) continue;
  await copyFile(path.join(wasmSrc, file), dst);
  console.log(`copied wasm/${file}`);
}

if (await exists(modelOut)) {
  console.log('hand_landmarker.task already staged');
} else {
  console.log(`downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`model download failed: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(modelOut));
  console.log(`saved ${modelOut}`);
}
console.log('hand-tracking assets ready');
