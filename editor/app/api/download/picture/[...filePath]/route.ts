import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filePath: string[] }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { filePath: segments } = await params;
  if (!segments?.length) {
    return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
  }
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const relative = segments.map((s) => encodeURIComponent(s)).join('/');
  const url = `${baseUrl.replace(/\/$/, '')}/download/picture/${relative}`;

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
    const data = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition);
    }
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    return new Response(data, {
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
