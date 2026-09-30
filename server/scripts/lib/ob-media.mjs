// Media helpers for the OB Van demo-footage scripts (conductor, take prep,
// wide composite, slides): ffmpeg / ffprobe / `say` wrappers, mono PCM
// buffers and WAV writing. Dependency-free: node + ffmpeg (+ macOS `say`).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
/** The server's mp4 library (what `POST mp4-cam` resolves `fileName` against). */
export const MP4_DIR = path.join(SERVER_DIR, 'data', 'mp4s');
/** Raw footage, conductor tracks and other intermediates (outside the library). */
export const RAW_DIR = path.join(SERVER_DIR, 'data', 'ob-demo-raw');
export const FONTS_DIR = path.join(SERVER_DIR, 'fonts');
export const SR = 48000;

/**
 * Run a command; resolves `{stdout, stderr}` (stdout as a Buffer when
 * `binary`), rejects with the stderr tail on a non-zero exit.
 */
export function run(cmd, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const buf = Buffer.concat(out);
      if (code === 0)
        resolve({ stdout: binary ? buf : buf.toString('utf8'), stderr: err });
      else
        reject(
          new Error(
            `${cmd} exited ${code}: ${err.trim().split('\n').slice(-6).join('\n')}`,
          ),
        );
    });
  });
}

export const ffmpeg = (args, opts) =>
  run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], opts);

export async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  return JSON.parse(stdout);
}

/** Mono float PCM at 48 kHz of the first audio stream (optionally a window). */
export async function decodePcm(file, { startS = 0, durS } = {}) {
  const { stdout } = await ffmpeg(
    [
      '-v',
      'error',
      ...(startS > 0 ? ['-ss', startS.toFixed(3)] : []),
      '-i',
      file,
      ...(durS ? ['-t', durS.toFixed(3)] : []),
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(SR),
      '-f',
      'f32le',
      '-',
    ],
    { binary: true },
  );
  // Copy: the Buffer may sit at an offset that is not 4-byte aligned.
  return new Float32Array(Uint8Array.from(stdout).buffer);
}

/** 16-bit mono WAV; samples are soft-clipped into [-1, 1]. */
export function writeWav(file, samples, sampleRate = SR) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const v =
      Math.abs(s) <= 0.9
        ? s
        : Math.sign(s) * (0.9 + 0.1 * Math.tanh((Math.abs(s) - 0.9) * 10));
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

/** Add `src` into `dst` at `atS` seconds with `gain`. */
export function mixInto(dst, src, atS, gain = 1) {
  const off = Math.round(atS * SR);
  for (let i = 0; i < src.length; i++) {
    const j = off + i;
    if (j < 0) continue;
    if (j >= dst.length) break;
    dst[j] += src[i] * gain;
  }
}

/** A sine blip with 5 ms fades (cue beeps, count-in ticks). */
export function tone(freq, durS, amp = 0.5) {
  const n = Math.round(durS * SR);
  const fade = Math.min(Math.round(0.005 * SR), n >> 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = amp * env * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

export function peakOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++)
    p = Math.max(p, Math.abs(samples[i]));
  return p;
}

/** Voices `say` knows on this machine (`say -v '?'`). */
export async function sayVoices() {
  const { stdout } = await run('say', ['-v', '?']);
  const names = new Set();
  for (const line of stdout.split('\n')) {
    const m = /^(.*\S)\s+[a-z]{2,3}_[A-Za-z0-9]{2,}\s+#/.exec(line);
    if (m) names.add(m[1].trim());
  }
  return names;
}

/**
 * Render `text` with macOS `say` and decode it to mono 48 kHz PCM. Renders are
 * cached in `cacheDir` by (voice, rate, text): `say` output lengths vary a
 * little between runs, and a timeline built from them must not move once
 * takes were recorded against it.
 */
export async function sayPcm(text, voice, rate, cacheDir) {
  const key = createHash('sha1')
    .update(`${voice}\n${rate}\n${text}`)
    .digest('hex')
    .slice(0, 16);
  const aiff = path.join(cacheDir, `${key}.aiff`);
  if (!existsSync(aiff)) {
    mkdirSync(cacheDir, { recursive: true });
    const tmp = `${aiff}.${process.pid}.tmp.aiff`;
    await run('say', ['-v', voice, '-r', String(rate), '-o', tmp, text]);
    renameSync(tmp, aiff);
  }
  return decodePcm(aiff);
}

/** Run `fn` over `items` with at most `limit` in flight; results in order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** `83.4` → `01:23.4` */
export function fmtTime(s) {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const r = a - m * 60;
  return `${sign}${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

/** `01:23.4` / `83.4` → seconds (NaN when unparseable). */
export function parseTime(s) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

/** Resolve a CLI path: absolute stays, relative is taken from the cwd. */
export const resolveCli = (p) => path.resolve(process.cwd(), p);
