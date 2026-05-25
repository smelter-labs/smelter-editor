import path from 'node:path';
import { ensureDir, pathExists, readFile, rename, writeFile } from 'fs-extra';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

interface HiddenAssetsRouteOptions {
  dirPath: string;
}

const FILE_NAME = 'hidden-assets.json';
const BodySchema = Type.Object({
  filePath: Type.String({ minLength: 1, maxLength: 1024 }),
});
type Body = Static<typeof BodySchema>;

export function registerHiddenAssetsRoutes(
  routes: FastifyInstance,
  opts: HiddenAssetsRouteOptions,
): void {
  const { dirPath } = opts;
  const filePath = path.join(dirPath, FILE_NAME);

  let writeChain: Promise<unknown> = Promise.resolve();

  async function loadHidden(): Promise<string[]> {
    if (!(await pathExists(filePath))) return [];
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const list = parsed?.hiddenAssets;
      if (!Array.isArray(list)) return [];
      return list.filter((v): v is string => typeof v === 'string');
    } catch {
      return [];
    }
  }

  async function saveHidden(list: string[]): Promise<void> {
    await ensureDir(dirPath);
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify({ hiddenAssets: list }, null, 2));
    await rename(tmp, filePath);
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeChain.then(fn, fn);
    writeChain = next.catch(() => {});
    return next;
  }

  routes.get('/hidden-assets', async (_req, res) => {
    try {
      const hiddenAssets = await loadHidden();
      res.status(200).send({ hiddenAssets });
    } catch (err) {
      console.error('Failed to load hidden assets', err);
      res.status(500).send({ error: 'Failed to load hidden assets' });
    }
  });

  routes.post<{ Body: Body }>(
    '/hidden-assets/hide',
    { schema: { body: BodySchema } },
    async (req, res) => {
      const { filePath: assetKey } = req.body;
      try {
        const hiddenAssets = await withLock(async () => {
          const current = await loadHidden();
          if (current.includes(assetKey)) return current;
          const next = [...current, assetKey];
          await saveHidden(next);
          return next;
        });
        res.status(200).send({ hiddenAssets });
      } catch (err) {
        console.error('Failed to hide asset', err);
        res.status(500).send({ error: 'Failed to hide asset' });
      }
    },
  );

  routes.post<{ Body: Body }>(
    '/hidden-assets/unhide',
    { schema: { body: BodySchema } },
    async (req, res) => {
      const { filePath: assetKey } = req.body;
      try {
        const hiddenAssets = await withLock(async () => {
          const current = await loadHidden();
          if (!current.includes(assetKey)) return current;
          const next = current.filter((v) => v !== assetKey);
          await saveHidden(next);
          return next;
        });
        res.status(200).send({ hiddenAssets });
      } catch (err) {
        console.error('Failed to unhide asset', err);
        res.status(500).send({ error: 'Failed to unhide asset' });
      }
    },
  );
}
