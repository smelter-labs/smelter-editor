import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function DELETE(
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
    const upstream = await fetch(`${BASE_URL}/upload/audio/${encodedPath}`, {
      method: 'DELETE',
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete audio asset' },
      { status: 502 },
    );
  }
}
