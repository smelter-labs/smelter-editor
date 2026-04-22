import { getServerSideServerUrl } from '@/lib/server-url.server';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { roomId } = await params;

  if (!baseUrl) {
    return new Response('SMELTER_EDITOR_SERVER_URL is not configured', {
      status: 500,
    });
  }

  const upstream = await fetch(
    `${baseUrl}/room/${encodeURIComponent(roomId)}/motion-scores/sse`,
    {
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
    },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response('Failed to connect to motion scores stream', {
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
