import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const url = `${BASE_URL}/suggestions/pictures/${encodeURIComponent(fileName)}`;
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
