import { NextRequest, NextResponse } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { fileName } = await params;

  const upstream = await fetch(
    `${baseUrl}/recordings/${encodeURIComponent(fileName)}`,
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'Recording not found' },
      { status: upstream.status },
    );
  }

  const blob = await upstream.blob();

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': blob.size.toString(),
    },
  });
}
