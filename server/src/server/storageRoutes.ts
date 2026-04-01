import path from 'node:path';
import {
  ensureDir,
  pathExists,
  readdir,
  readFile,
  remove,
  stat,
  writeFile,
} from 'fs-extra';
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

function safeFileName(fileName: string): string {
  if (
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    !fileName.endsWith('.json')
  ) {
    throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
  }
  return fileName;
}

interface StorageRouteOptions {
  routePrefix: string;
  dirPath: string;
  filePrefix: string;
  resourceName: string;
  payloadKey: string;
  listKey: string;
  bodySchema: TSchema;
  supportsUpdate?: boolean;
}

export function registerStorageRoutes(
  routes: FastifyInstance,
  opts: StorageRouteOptions,
): void {
  const {
    routePrefix,
    dirPath,
    filePrefix,
    resourceName,
    payloadKey,
    listKey,
    bodySchema,
    supportsUpdate,
  } = opts;

  const SaveSchema = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 200 }),
    [payloadKey]: bodySchema,
  });

  // POST / — save new item
  routes.post<{ Body: Static<typeof SaveSchema> }>(
    routePrefix,
    { schema: { body: SaveSchema } },
    async (req, res) => {
      const name = (req.body as any).name as string;
      const payload = (req.body as any)[payloadKey];
      const safeName = name.replace(/[^a-zA-Z0-9_\-.\s]/g, '_').trim();
      const timestamp = Date.now();
      const fileName = `${filePrefix}-${safeName}-${timestamp}.json`;

      await ensureDir(dirPath);
      const filePath = path.join(dirPath, fileName);
      await writeFile(
        filePath,
        JSON.stringify(
          { name, [payloadKey]: payload, savedAt: new Date().toISOString() },
          null,
          2,
        ),
      );

      console.log(`[request] Save ${resourceName}`, { name, fileName });
      res.status(200).send({ status: 'ok', fileName, name });
    },
  );

  // GET / — list all items
  routes.get(routePrefix, async (_req, res) => {
    if (!(await pathExists(dirPath))) {
      return res.status(200).send({ [listKey]: [] });
    }

    try {
      const files = await readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const items = [];
      for (const fileName of jsonFiles) {
        const filePath = path.join(dirPath, fileName);
        try {
          const content = await readFile(filePath, 'utf-8');
          const parsed = JSON.parse(content);
          const fileStat = await stat(filePath);
          items.push({
            fileName,
            name: parsed.name ?? fileName,
            savedAt: parsed.savedAt ?? fileStat.mtimeMs,
            size: fileStat.size,
          });
        } catch {
          continue;
        }
      }
      items.sort((a, b) => {
        const aTime =
          typeof a.savedAt === 'string'
            ? new Date(a.savedAt).getTime()
            : a.savedAt;
        const bTime =
          typeof b.savedAt === 'string'
            ? new Date(b.savedAt).getTime()
            : b.savedAt;
        return bTime - aTime;
      });
      res.status(200).send({ [listKey]: items });
    } catch (err: any) {
      console.error(`Failed to list ${resourceName}s`, err);
      res.status(500).send({ error: `Failed to list ${resourceName}s` });
    }
  });

  type FileParams = { Params: { fileName: string } };

  // GET /:fileName — load single item
  routes.get<FileParams>(`${routePrefix}/:fileName`, async (req, res) => {
    const fileName = safeFileName(req.params.fileName);
    const filePath = path.join(dirPath, fileName);

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: `${resourceName} not found` });
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      res.status(200).send(parsed);
    } catch (err: any) {
      console.error(`Failed to read ${resourceName} file`, {
        filePath,
        err,
      });
      res.status(500).send({ error: `Failed to read ${resourceName} file` });
    }
  });

  // POST /:fileName — update existing item (optional)
  if (supportsUpdate) {
    const UpdateSchema = Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200 }),
      [payloadKey]: bodySchema,
    });

    routes.post<FileParams & { Body: Static<typeof UpdateSchema> }>(
      `${routePrefix}/:fileName`,
      { schema: { body: UpdateSchema } },
      async (req, res) => {
        const fileName = safeFileName(req.params.fileName);
        const filePath = path.join(dirPath, fileName);

        if (!(await pathExists(filePath))) {
          return res.status(404).send({ error: `${resourceName} not found` });
        }

        const name = (req.body as any).name as string;
        const payload = (req.body as any)[payloadKey];
        try {
          const existing = JSON.parse(await readFile(filePath, 'utf-8'));
          await writeFile(
            filePath,
            JSON.stringify(
              {
                ...existing,
                name,
                [payloadKey]: payload,
                updatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
          console.log(`[request] Update ${resourceName}`, {
            name,
            fileName,
          });
          res.status(200).send({ status: 'ok', fileName, name });
        } catch (err: any) {
          console.error(`Failed to update ${resourceName}`, {
            filePath,
            err,
          });
          res.status(500).send({ error: `Failed to update ${resourceName}` });
        }
      },
    );
  }

  // DELETE /:fileName — delete item
  routes.delete<FileParams>(`${routePrefix}/:fileName`, async (req, res) => {
    const fileName = safeFileName(req.params.fileName);
    const filePath = path.join(dirPath, fileName);

    if (!(await pathExists(filePath))) {
      return res.status(404).send({ error: `${resourceName} not found` });
    }

    try {
      await remove(filePath);
      res.status(200).send({ status: 'ok' });
    } catch (err: any) {
      console.error(`Failed to delete ${resourceName}`, {
        filePath,
        err,
      });
      res.status(500).send({ error: `Failed to delete ${resourceName}` });
    }
  });
}
