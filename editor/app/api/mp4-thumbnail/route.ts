import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function GET(req: NextRequest) {
  const fileName = req.nextUrl.searchParams.get('fileName');

  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  if (!fileName) {
    return NextResponse.json(
      { error: 'fileName is required' },
      { status: 400 },
    );
  }

  const url = `${BASE_URL}/suggestions/mp4-thumbnail?fileName=${encodeURIComponent(fileName)}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Thumbnail not found' },
        { status: upstream.status },
      );
    }
    const data = await upstream.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch thumbnail' },
      { status: 502 },
    );
  }
}
