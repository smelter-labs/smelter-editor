import { getServerSideServerUrl } from '@/lib/server-url.server';

/**
 * Generic proxy for the server's per-model results SSE stream
 * (`/room/:roomId/ai-models/:modelId/results/sse`). Each event is the full
 * ModelResultEvent `{modelId, inputId, data}` — consumers filter by inputId.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; modelId: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { roomId, modelId } = await params;

  if (!baseUrl) {
    return new Response('SMELTER_EDITOR_SERVER_URL is not configured', {
      status: 500,
    });
  }

  const upstream = await fetch(
    `${baseUrl}/room/${encodeURIComponent(roomId)}/ai-models/${encodeURIComponent(
      modelId,
    )}/results/sse`,
    {
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
    },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response('Failed to connect to AI model results stream', {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
