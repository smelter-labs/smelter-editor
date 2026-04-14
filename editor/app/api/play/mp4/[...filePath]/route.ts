import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

function proxyPlaybackHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  const cacheControl = upstream.headers.get('cache-control');

  if (contentType) headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);
  if (contentRange) headers.set('Content-Range', contentRange);
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
  if (cacheControl) headers.set('Cache-Control', cacheControl);

  return headers;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filePath: string[] }> },
) {
  const { filePath: segments } = await params;
  if (!segments?.length) {
    return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
  }
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const relative = segments
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `${BASE_URL.replace(/\/$/, '')}/play/mp4/${relative}`;

  try {
    const headers = new Headers();
    const range = req.headers.get('range');
    if (range) headers.set('range', range);

    const upstream = await fetch(url, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream
        .json()
        .catch(() => ({ error: 'Failed to stream file' }));
      return NextResponse.json(body, { status: upstream.status });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: proxyPlaybackHeaders(upstream),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to stream file' },
      { status: 502 },
    );
  }
}
