import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('download mp4 api proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SMELTER_EDITOR_SERVER_URL = 'http://smelter.local';
  });

  it('buffers upstream payload before returning response', async () => {
    const { GET } = await import('../route');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('video-bytes'));
        controller.close();
      },
    });
    const upstream = new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-disposition': 'attachment; filename=\"test.mp4\"',
        'content-length': '11',
      },
    });
    const arrayBufferSpy = vi.spyOn(upstream, 'arrayBuffer');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

    const response = await GET({} as any, {
      params: Promise.resolve({ filePath: ['folder', 'test.mp4'] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-disposition')).toContain('test.mp4');
    expect(await response.text()).toBe('video-bytes');
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
  });
});
