import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function GET(
  _req: NextRequest,
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

  const relative = segments.map((s) => encodeURIComponent(s)).join('/');
  const url = `${BASE_URL.replace(/\/$/, '')}/download/audio/${relative}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: upstream.status },
      );
    }
    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream';
    const contentDisposition = upstream.headers.get('content-disposition');
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition);
    }
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch file' },
      { status: 502 },
    );
  }
}
