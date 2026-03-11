export type SavedItemInfo = {
  fileName: string;
  name: string;
  savedAt: string;
  size: number;
};

type OkResult<T> = { ok: true } & T;
type ErrResult = { ok: false; error: string };

export type StorageResult<T = object> = OkResult<T> | ErrResult;

export interface StorageClient<T> {
  save(
    name: string,
    payload: T,
  ): Promise<StorageResult<{ fileName: string; name: string }>>;
  list(): Promise<StorageResult<{ items: SavedItemInfo[] }>>;
  load(
    fileName: string,
  ): Promise<StorageResult<{ name: string; data: T; savedAt: string }>>;
  update(
    fileName: string,
    name: string,
    payload: T,
  ): Promise<StorageResult<{ fileName: string; name: string }>>;
  remove(fileName: string): Promise<StorageResult>;
}

type RequestFn = (
  method: 'get' | 'delete' | 'post',
  route: string,
  body?: object,
) => Promise<any>;

export function createStorageClient<T>(
  req: RequestFn,
  routePrefix: string,
  payloadKey: string,
  listKey: string,
): StorageClient<T> {
  const enc = encodeURIComponent;

  return {
    async save(name, payload) {
      try {
        const result = await req('post', routePrefix, {
          name,
          [payloadKey]: payload,
        });
        return { ok: true, fileName: result.fileName, name: result.name };
      } catch (e: any) {
        const msg = e?.message ?? `Failed to save`;
        console.error(`[storage:${routePrefix}:save]`, msg);
        return { ok: false, error: msg };
      }
    },

    async list() {
      try {
        const data = await req('get', routePrefix);
        return { ok: true, items: data[listKey] ?? [] };
      } catch (e: any) {
        const msg = e?.message ?? `Failed to list`;
        console.error(`[storage:${routePrefix}:list]`, msg);
        return { ok: false, error: msg };
      }
    },

    async load(fileName) {
      try {
        const data = await req('get', `${routePrefix}/${enc(fileName)}`);
        return {
          ok: true,
          name: data.name,
          data: data[payloadKey] as T,
          savedAt: data.savedAt,
        };
      } catch (e: any) {
        const msg = e?.message ?? `Failed to load`;
        console.error(`[storage:${routePrefix}:load]`, msg);
        return { ok: false, error: msg };
      }
    },

    async update(fileName, name, payload) {
      try {
        const result = await req('post', `${routePrefix}/${enc(fileName)}`, {
          name,
          [payloadKey]: payload,
        });
        return { ok: true, fileName: result.fileName, name: result.name };
      } catch (e: any) {
        const msg = e?.message ?? `Failed to update`;
        console.error(`[storage:${routePrefix}:update]`, msg);
        return { ok: false, error: msg };
      }
    },

    async remove(fileName) {
      try {
        await req('delete', `${routePrefix}/${enc(fileName)}`, {});
        return { ok: true as const };
      } catch (e: any) {
        const msg = e?.message ?? `Failed to delete`;
        console.error(`[storage:${routePrefix}:remove]`, msg);
        return { ok: false, error: msg };
      }
    },
  };
}
