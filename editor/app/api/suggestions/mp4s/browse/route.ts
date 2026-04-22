import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET(req: NextRequest) {
  const baseUrl = await getServerSideServerUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  const folder = req.nextUrl.searchParams.get('folder') ?? '';
  const url = `${baseUrl}/suggestions/mp4s/browse${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to browse MP4s' },
      { status: 502 },
    );
  }
}
