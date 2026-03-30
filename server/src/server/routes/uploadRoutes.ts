import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import fs from 'fs-extra';
import type { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import mp4SuggestionsMonitor from '../../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../../pictures/pictureSuggestionMonitor';
import audioSuggestionsMonitor from '../../audio-files/audioSuggestionMonitor';

const execFileAsync = promisify(execFile);

const MP4_EXTS = new Set(['.mp4']);
const AUDIO_EXTS = new Set(['.wav', '.mp3']);
const PICTURE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
]);

const MAX_FOLDER_DEPTH = 3;

function sanitizeFolderPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length > MAX_FOLDER_DEPTH) return null;

  for (const seg of segments) {
    if (seg === '.' || seg === '..') return null;
    if (/[<>:"|?*\x00-\x1f]/.test(seg)) return null;
  }

  return segments.join('/');
}

function sanitizeFileName(raw: string): string | null {
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..') return null;
  if (/[<>:"|?*\x00-\x1f/\\]/.test(base)) return null;
  return base;
}

function isAllowedExt(fileName: string, allowed: Set<string>): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return allowed.has(ext);
}

export const uploadRoutes: FastifyPluginCallback = (routes, _opts, done) => {
  // ── Upload MP4 ──────────────────────────────────────────────
  routes.post('/upload/mp4', async (req, res) => {
    const data = await req.file();
    if (!data) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const fileName = sanitizeFileName(data.filename);
    if (!fileName || !isAllowedExt(fileName, MP4_EXTS)) {
      await data.toBuffer();
      return res
        .status(400)
        .send({ error: 'Invalid file. Only .mp4 files are accepted.' });
    }

    const folderRaw =
      (data.fields.folder as any)?.value ?? '';
    let folder = '';
    if (folderRaw) {
      const sanitized = sanitizeFolderPath(folderRaw);
      if (sanitized === null) {
        await data.toBuffer();
        return res.status(400).send({ error: 'Invalid folder path' });
      }
      folder = sanitized;
    }

    const targetDir = folder
      ? path.join(process.cwd(), 'mp4s', folder)
      : path.join(process.cwd(), 'mp4s');
    await fs.ensureDir(targetDir);

    const filePath = path.join(targetDir, fileName);
    await pipeline(data.file, fs.createWriteStream(filePath));

    mp4SuggestionsMonitor.refresh();

    return res.status(200).send({ fileName, folder });
  });

  // ── Upload Picture ──────────────────────────────────────────
  routes.post('/upload/picture', async (req, res) => {
    const data = await req.file();
    if (!data) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const fileName = sanitizeFileName(data.filename);
    if (!fileName || !isAllowedExt(fileName, PICTURE_EXTS)) {
      await data.toBuffer();
      return res.status(400).send({
        error:
          'Invalid file. Only .jpg, .jpeg, .png, .gif, .svg, .webp files are accepted.',
      });
    }

    const folderRaw =
      (data.fields.folder as any)?.value ?? '';
    let folder = '';
    if (folderRaw) {
      const sanitized = sanitizeFolderPath(folderRaw);
      if (sanitized === null) {
        await data.toBuffer();
        return res.status(400).send({ error: 'Invalid folder path' });
      }
      folder = sanitized;
    }

    const targetDir = folder
      ? path.join(process.cwd(), 'pictures', folder)
      : path.join(process.cwd(), 'pictures');
    await fs.ensureDir(targetDir);

    const filePath = path.join(targetDir, fileName);
    await pipeline(data.file, fs.createWriteStream(filePath));

    pictureSuggestionsMonitor.refresh();

    return res.status(200).send({ fileName, folder });
  });

  // ── Delete MP4 ──────────────────────────────────────────────
  routes.delete<{ Params: { filePath: string } }>(
    '/upload/mp4/:filePath',
    { schema: { params: Type.Object({ filePath: Type.String() }) } },
    async (req, res) => {
      const decoded = decodeURIComponent(req.params.filePath);
      const sanitized = sanitizeFolderPath(decoded);
      if (sanitized === null) {
        return res.status(400).send({ error: 'Invalid file path' });
      }

      const absPath = path.join(process.cwd(), 'mp4s', sanitized);
      if (!(await fs.pathExists(absPath))) {
        return res.status(404).send({ error: 'File not found' });
      }

      await fs.remove(absPath);
      mp4SuggestionsMonitor.refresh();
      return res.status(200).send({ deleted: sanitized });
    },
  );

  // ── Delete Picture ──────────────────────────────────────────
  routes.delete<{ Params: { filePath: string } }>(
    '/upload/picture/:filePath',
    { schema: { params: Type.Object({ filePath: Type.String() }) } },
    async (req, res) => {
      const decoded = decodeURIComponent(req.params.filePath);
      const sanitized = sanitizeFolderPath(decoded);
      if (sanitized === null) {
        return res.status(400).send({ error: 'Invalid file path' });
      }

      const absPath = path.join(process.cwd(), 'pictures', sanitized);
      if (!(await fs.pathExists(absPath))) {
        return res.status(404).send({ error: 'File not found' });
      }

      await fs.remove(absPath);
      pictureSuggestionsMonitor.refresh();
      return res.status(200).send({ deleted: sanitized });
    },
  );

  // ── Create MP4 Folder ──────────────────────────────────────
  routes.post(
    '/upload/mp4/folder',
    {
      schema: {
        body: Type.Object({ folder: Type.String() }),
      },
    },
    async (req, res) => {
      const { folder } = req.body as { folder: string };
      const sanitized = sanitizeFolderPath(folder);
      if (sanitized === null || sanitized === '') {
        return res.status(400).send({ error: 'Invalid folder path' });
      }

      const absPath = path.join(process.cwd(), 'mp4s', sanitized);
      await fs.ensureDir(absPath);
      mp4SuggestionsMonitor.refresh();
      return res.status(200).send({ folder: sanitized });
    },
  );

  // ── Create Picture Folder ──────────────────────────────────
  routes.post(
    '/upload/picture/folder',
    {
      schema: {
        body: Type.Object({ folder: Type.String() }),
      },
    },
    async (req, res) => {
      const { folder } = req.body as { folder: string };
      const sanitized = sanitizeFolderPath(folder);
      if (sanitized === null || sanitized === '') {
        return res.status(400).send({ error: 'Invalid folder path' });
      }

      const absPath = path.join(process.cwd(), 'pictures', sanitized);
      await fs.ensureDir(absPath);
      pictureSuggestionsMonitor.refresh();
      return res.status(200).send({ folder: sanitized });
    },
  );

  // ── Upload Audio (WAV/MP3 → MP4 with black video) ───────────
  routes.post('/upload/audio', async (req, res) => {
    const data = await req.file();
    if (!data) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const fileName = sanitizeFileName(data.filename);
    if (!fileName || !isAllowedExt(fileName, AUDIO_EXTS)) {
      await data.toBuffer();
      return res
        .status(400)
        .send({ error: 'Invalid file. Only .wav and .mp3 files are accepted.' });
    }

    const folderRaw = (data.fields.folder as any)?.value ?? '';
    let folder = '';
    if (folderRaw) {
      const sanitized = sanitizeFolderPath(folderRaw);
      if (sanitized === null) {
        await data.toBuffer();
        return res.status(400).send({ error: 'Invalid folder path' });
      }
      folder = sanitized;
    }

    const targetDir = folder
      ? path.join(process.cwd(), 'audios', folder)
      : path.join(process.cwd(), 'audios');
    await fs.ensureDir(targetDir);

    const tmpPath = path.join(targetDir, `.tmp_${fileName}`);
    await pipeline(data.file, fs.createWriteStream(tmpPath));

    const outputName = fileName.replace(/\.[^.]+$/, '.mp4');
    const outputPath = path.join(targetDir, outputName);

    try {
      await execFileAsync('ffmpeg', [
        '-f', 'lavfi',
        '-i', 'color=c=black:s=320x160:r=1',
        '-i', tmpPath,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-af', 'apad=whole_dur=5',
        '-shortest',
        '-y',
        outputPath,
      ]);
    } catch (err: any) {
      await fs.remove(tmpPath).catch(() => {});
      console.error('[upload/audio] ffmpeg conversion failed', err?.message);
      return res.status(500).send({ error: 'Audio conversion failed' });
    }

    await fs.remove(tmpPath).catch(() => {});
    audioSuggestionsMonitor.refresh();

    return res.status(200).send({ fileName: outputName, folder });
  });

  // ── Delete Audio ────────────────────────────────────────────
  routes.delete<{ Params: { filePath: string } }>(
    '/upload/audio/:filePath',
    { schema: { params: Type.Object({ filePath: Type.String() }) } },
    async (req, res) => {
      const decoded = decodeURIComponent(req.params.filePath);
      const sanitized = sanitizeFolderPath(decoded);
      if (sanitized === null) {
        return res.status(400).send({ error: 'Invalid file path' });
      }

      const absPath = path.join(process.cwd(), 'audios', sanitized);
      if (!(await fs.pathExists(absPath))) {
        return res.status(404).send({ error: 'File not found' });
      }

      await fs.remove(absPath);
      audioSuggestionsMonitor.refresh();
      return res.status(200).send({ deleted: sanitized });
    },
  );

  // ── Create Audio Folder ─────────────────────────────────────
  routes.post(
    '/upload/audio/folder',
    {
      schema: {
        body: Type.Object({ folder: Type.String() }),
      },
    },
    async (req, res) => {
      const { folder } = req.body as { folder: string };
      const sanitized = sanitizeFolderPath(folder);
      if (sanitized === null || sanitized === '') {
        return res.status(400).send({ error: 'Invalid folder path' });
      }

      const absPath = path.join(process.cwd(), 'audios', sanitized);
      await fs.ensureDir(absPath);
      audioSuggestionsMonitor.refresh();
      return res.status(200).send({ folder: sanitized });
    },
  );

  done();
};
