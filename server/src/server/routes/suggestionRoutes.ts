import path from 'node:path';
import { pathExists } from 'fs-extra';
import type { FastifyPluginCallback } from 'fastify';
import { Type } from '@sinclair/typebox';
import { getMp4DurationMs } from '../mp4Duration';
import { TwitchChannelSuggestions } from '../../twitch/TwitchChannelMonitor';
import { KickChannelSuggestions } from '../../kick/KickChannelMonitor';
import mp4SuggestionsMonitor from '../../mp4/mp4SuggestionMonitor';
import pictureSuggestionsMonitor from '../../pictures/pictureSuggestionMonitor';
import audioSuggestionsMonitor from '../../audio-files/audioSuggestionMonitor';
import shadersController from '../../shaders/shaders';

export const suggestionRoutes: FastifyPluginCallback = (routes, _opts, done) => {
  routes.get('/suggestions/mp4s', async (_req, res) => {
    res.status(200).send({ mp4s: mp4SuggestionsMonitor.mp4Files });
  });

  routes.get<{ Params: { fileName: string } }>(
    '/suggestions/mp4-duration/:fileName',
    { schema: { params: Type.Object({ fileName: Type.String() }) } },
    async (req, res) => {
      const { fileName } = req.params;
      const safeName = path.basename(fileName);
      const filePath = path.join(process.cwd(), 'mp4s', safeName);

      if (!(await pathExists(filePath))) {
        return res.status(404).send({ error: 'MP4 file not found' });
      }

      try {
        const durationMs = await getMp4DurationMs(filePath);
        return res.status(200).send({ durationMs });
      } catch (err: any) {
        console.error('Failed to get MP4 duration via ffprobe', {
          fileName: safeName,
          err: err?.message,
        });
        return res.status(500).send({ error: 'Failed to read MP4 duration' });
      }
    },
  );

  routes.get('/suggestions/pictures', async (_req, res) => {
    res.status(200).send({ pictures: pictureSuggestionsMonitor.pictureFiles });
  });

  routes.get<{ Querystring: { folder?: string } }>(
    '/suggestions/mp4s/browse',
    {
      schema: {
        querystring: Type.Object({
          folder: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, res) => {
      const folder = req.query.folder || undefined;
      res.status(200).send(mp4SuggestionsMonitor.listFolder(folder));
    },
  );

  routes.get<{ Querystring: { folder?: string } }>(
    '/suggestions/pictures/browse',
    {
      schema: {
        querystring: Type.Object({
          folder: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, res) => {
      const folder = req.query.folder || undefined;
      res.status(200).send(pictureSuggestionsMonitor.listFolder(folder));
    },
  );

  routes.get('/suggestions/audios', async (_req, res) => {
    res.status(200).send({ audios: audioSuggestionsMonitor.audioFiles });
  });

  routes.get<{ Querystring: { folder?: string } }>(
    '/suggestions/audios/browse',
    {
      schema: {
        querystring: Type.Object({
          folder: Type.Optional(Type.String()),
        }),
      },
    },
    async (req, res) => {
      const folder = req.query.folder || undefined;
      res.status(200).send(audioSuggestionsMonitor.listFolder(folder));
    },
  );

  routes.get<{ Params: { fileName: string } }>(
    '/suggestions/audio-duration/:fileName',
    { schema: { params: Type.Object({ fileName: Type.String() }) } },
    async (req, res) => {
      const { fileName } = req.params;
      const decoded = decodeURIComponent(fileName);
      if (decoded.includes('..')) {
        return res.status(400).send({ error: 'Invalid file name' });
      }
      const filePath = path.join(process.cwd(), 'audios', decoded);

      if (!(await pathExists(filePath))) {
        return res.status(404).send({ error: 'Audio file not found' });
      }

      try {
        const durationMs = await getMp4DurationMs(filePath);
        return res.status(200).send({ durationMs });
      } catch (err: any) {
        console.error('Failed to get audio duration via ffprobe', {
          fileName: decoded,
          err: err?.message,
        });
        return res
          .status(500)
          .send({ error: 'Failed to read audio duration' });
      }
    },
  );

  routes.get('/suggestions/twitch', async (_req, res) => {
    res.status(200).send({ twitch: TwitchChannelSuggestions.getTopStreams() });
  });

  routes.get('/suggestions/kick', async (_req, res) => {
    console.log('[request] Get kick suggestions');
    res.status(200).send({ kick: KickChannelSuggestions.getTopStreams() });
  });

  routes.get('/suggestions', async (_req, res) => {
    res.status(200).send({ twitch: TwitchChannelSuggestions.getTopStreams() });
  });

  routes.get('/shaders', async (_req, res) => {
    const visible = shadersController.shaders.filter((s) => s.isVisible);
    res.status(200).send({ shaders: visible });
  });

  done();
};
