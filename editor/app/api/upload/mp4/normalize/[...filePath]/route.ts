import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ filePath: string[] }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { filePath } = await params;
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  try {
    const encodedPath = filePath
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const upstream = await fetch(
      `${baseUrl}/upload/mp4/normalize/${encodedPath}`,
      {
        method: 'POST',
      },
    );
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to normalize MP4 audio' },
      { status: 502 },
    );
  }
}
