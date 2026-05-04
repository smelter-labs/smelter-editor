#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_TARGET = { width: 1920, height: 1080 };

const SCALE_X_KEYS = new Set([
  'x',
  'width',
  'absoluteLeft',
  'absoluteWidth',
  'cropLeft',
  'cropRight',
  'textFontSize',
  'textScrollSpeed',
]);

const SCALE_Y_KEYS = new Set([
  'y',
  'height',
  'absoluteTop',
  'absoluteHeight',
  'cropTop',
  'cropBottom',
]);

function printUsage() {
  console.error(
    'Usage: node scripts/rescale-room-config.mjs <input.json> <output.json> [--target=WIDTHxHEIGHT]',
  );
}

function parseTargetArg(targetArg) {
  if (!targetArg) return DEFAULT_TARGET;
  if (!targetArg.startsWith('--target=')) {
    throw new Error(`Unknown argument: ${targetArg}`);
  }

  const raw = targetArg.slice('--target='.length).trim().toLowerCase();
  const match = raw.match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new Error(
      'Invalid --target format. Expected --target=WIDTHxHEIGHT, e.g. --target=1920x1080',
    );
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid target size: ${raw}`);
  }

  return { width, height };
}

function scaleValue(value, scale) {
  return Math.round(value * scale);
}

function walkAndScale(node, scaleX, scaleY) {
  if (Array.isArray(node)) {
    node.forEach((entry) => walkAndScale(entry, scaleX, scaleY));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'number' && SCALE_X_KEYS.has(key)) {
      node[key] = scaleValue(value, scaleX);
      continue;
    }

    if (typeof value === 'number' && SCALE_Y_KEYS.has(key)) {
      node[key] = scaleValue(value, scaleY);
      continue;
    }

    walkAndScale(value, scaleX, scaleY);
  }
}

function main() {
  const [, , inputPath, outputPath, targetArg] = process.argv;
  if (!inputPath || !outputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const target = parseTargetArg(targetArg);
  const raw = readFileSync(inputPath, 'utf-8');
  const config = JSON.parse(raw);

  const sourceResolution = config?.resolution;
  if (
    !sourceResolution ||
    typeof sourceResolution !== 'object' ||
    typeof sourceResolution.width !== 'number' ||
    typeof sourceResolution.height !== 'number' ||
    sourceResolution.width <= 0 ||
    sourceResolution.height <= 0
  ) {
    throw new Error('Input config has missing or invalid `resolution`.');
  }

  const sourceWidth = sourceResolution.width;
  const sourceHeight = sourceResolution.height;
  const scaleX = target.width / sourceWidth;
  const scaleY = target.height / sourceHeight;

  // Prevent accidental scaling of top-level resolution.width/height by key name.
  delete config.resolution;
  walkAndScale(config, scaleX, scaleY);
  config.resolution = { width: target.width, height: target.height };

  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

  console.log(
    `Rescaled ${inputPath} (${sourceWidth}x${sourceHeight}) -> ${outputPath} (${target.width}x${target.height})`,
  );
  console.log(`scaleX=${scaleX}, scaleY=${scaleY}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
