import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileName: string[] }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { fileName: segments } = await params;
  const fileName = segments.join('/');
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const url = `${baseUrl}/suggestions/pictures/${encodeURIComponent(fileName)}`;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Picture not found' },
        { status: upstream.status },
      );
    }
    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream';
    const data = await upstream.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch picture' },
      { status: 502 },
    );
  }
}
