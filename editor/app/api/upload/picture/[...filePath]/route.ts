import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function DELETE(
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
    const upstream = await fetch(`${baseUrl}/upload/picture/${encodedPath}`, {
      method: 'DELETE',
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete picture' },
      { status: 502 },
    );
  }
}
