import path from 'node:path';
import { pathExists, readdir, readFile, stat } from 'fs-extra';
import type { FastifyPluginCallback } from 'fastify';
import { state } from '../serverState';
import {
  RoomIdParamsSchema,
  type RoomIdParams,
  type RecordingFileParams,
} from './schemas';

const SCREENSHOTS_DIR = path.join(__dirname, '../../../screenshots');
const RECORDINGS_DIR = path.join(__dirname, '../../../recordings');

export const recordingRoutes: FastifyPluginCallback = (routes, _opts, done) => {
  routes.post<RoomIdParams>(
    '/room/:roomId/record/start',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      console.log('[request] Start recording', { roomId });
      try {
        const room = state.getRoom(roomId);
        const { fileName } = await room.startRecording();
        res.status(200).send({ status: 'recording', fileName });
      } catch (err: any) {
        console.error('Failed to start recording', err?.body ?? err);
        res.status(400).send({
          status: 'error',
          message: err?.message ?? 'Failed to start recording',
        });
      }
    },
  );

  routes.post<RoomIdParams>(
    '/room/:roomId/record/stop',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      console.log('[request] Stop recording', { roomId });
      try {
        const room = state.getRoom(roomId);
        const { fileName } = await room.stopRecording();

        const forwardedProto = (
          req.headers['x-forwarded-proto'] as string | undefined
        )?.split(',')[0];
        const protocol = forwardedProto || (req.protocol as string) || 'http';
        const host = (req.headers['host'] as string) || 'localhost';
        const baseUrl = `${protocol}://${host}`;
        const downloadUrl = `${baseUrl}/recordings/${encodeURIComponent(fileName)}`;

        res.status(200).send({ status: 'stopped', fileName, downloadUrl });
      } catch (err: any) {
        console.error('Failed to stop recording', err?.body ?? err);
        res.status(400).send({
          status: 'error',
          message: err?.message ?? 'Failed to stop recording',
        });
      }
    },
  );

  routes.get<{ Params: { fileName: string } }>(
    '/screenshots/:fileName',
    async (req, res) => {
      const { fileName } = req.params;
      const filePath = path.join(SCREENSHOTS_DIR, path.basename(fileName));

      if (!(await pathExists(filePath))) {
        return res.status(404).send({ error: 'Screenshot not found' });
      }

      try {
        const fileStat = await stat(filePath);
        const data = await readFile(filePath);

        res.header('Content-Type', 'image/jpeg');
        res.header('Cache-Control', 'public, max-age=3600');
        res.header('Content-Length', fileStat.size.toString());
        res.send(data);
      } catch (err: any) {
        console.error('Failed to read screenshot file', { filePath, err });
        res.status(500).send({ error: 'Failed to read screenshot file' });
      }
    },
  );

  routes.get('/recordings', async (_req, res) => {
    if (!(await pathExists(RECORDINGS_DIR))) {
      return res.status(200).send({ recordings: [] });
    }

    try {
      const files = await readdir(RECORDINGS_DIR);
      const mp4Files = files.filter((f) => f.endsWith('.mp4'));
      const recordings = [];
      for (const fileName of mp4Files) {
        const filePath = path.join(RECORDINGS_DIR, fileName);
        const fileStat = await stat(filePath);
        const match = fileName.match(/^recording-(.+)-(\d+)\.mp4$/);
        recordings.push({
          fileName,
          roomId: match ? match[1] : null,
          createdAt: match ? Number(match[2]) : fileStat.mtimeMs,
          size: fileStat.size,
        });
      }
      recordings.sort((a, b) => b.createdAt - a.createdAt);
      res.status(200).send({ recordings });
    } catch (err: any) {
      console.error('Failed to list recordings', err);
      res.status(500).send({ error: 'Failed to list recordings' });
    }
  });

  routes.get<RoomIdParams>(
    '/room/:roomId/recordings',
    { schema: { params: RoomIdParamsSchema } },
    async (req, res) => {
      const { roomId } = req.params;
      const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (!(await pathExists(RECORDINGS_DIR))) {
        return res.status(200).send({ recordings: [] });
      }

      try {
        const files = await readdir(RECORDINGS_DIR);
        const mp4Files = files.filter((f) => f.endsWith('.mp4'));
        const recordings = [];
        for (const fileName of mp4Files) {
          const match = fileName.match(/^recording-(.+)-(\d+)\.mp4$/);
          if (!match || match[1] !== safeRoomId) {
            continue;
          }
          const filePath = path.join(RECORDINGS_DIR, fileName);
          const fileStat = await stat(filePath);
          recordings.push({
            fileName,
            roomId: match[1],
            createdAt: Number(match[2]),
            size: fileStat.size,
          });
        }
        recordings.sort((a, b) => b.createdAt - a.createdAt);
        res.status(200).send({ recordings });
      } catch (err: any) {
        console.error('Failed to list recordings for room', { roomId, err });
        res.status(500).send({ error: 'Failed to list recordings' });
      }
    },
  );

  routes.get<RecordingFileParams>('/recordings/:fileName', async (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(RECORDINGS_DIR, fileName);

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: 'Recording not found' });
    }

    try {
      const fileStat = await stat(filePath);
      const data = await readFile(filePath);

      res.header('Content-Type', 'video/mp4');
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);
      res.header('Content-Length', fileStat.size.toString());
      res.send(data);
    } catch (err: any) {
      console.error('Failed to read recording file', { filePath, err });
      res.status(500).send({ error: 'Failed to read recording file' });
    }
  });

  done();
};
