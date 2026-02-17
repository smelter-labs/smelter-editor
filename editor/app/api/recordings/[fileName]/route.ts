import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;

  const upstream = await fetch(
    `${BASE_URL}/recordings/${encodeURIComponent(fileName)}`,
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
