import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function GET(req: NextRequest) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const folder = req.nextUrl.searchParams.get('folder') ?? '';
  const url = `${BASE_URL}/suggestions/audios/browse${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to browse audios' },
      { status: 502 },
    );
  }
}
