import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ filePath: string[] }> },
) {
  const { filePath } = await params;
  if (!BASE_URL) {
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
      `${BASE_URL}/upload/mp4/normalize/${encodedPath}`,
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
