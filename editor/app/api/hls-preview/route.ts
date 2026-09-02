import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET(req: NextRequest) {
  const baseUrl = await getServerSideServerUrl();
  const streamUrl = req.nextUrl.searchParams.get('url');

  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  if (!streamUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const url = `${baseUrl}/suggestions/hls-preview?url=${encodeURIComponent(streamUrl)}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      // Forward the server's message ("Stream unreachable...") so the UI can
      // show why a preview failed instead of a generic error.
      const body = (await upstream
        .json()
        .catch(() => ({ error: 'Preview failed' }))) as { error?: string };
      return NextResponse.json(
        { error: body.error ?? 'Preview failed' },
        { status: upstream.status },
      );
    }
    const data = await upstream.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        // The server caches frames on disk by URL hash; the client fetches
        // explicitly, so don't let the browser pin a stale frame.
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch preview' },
      { status: 502 },
    );
  }
}
