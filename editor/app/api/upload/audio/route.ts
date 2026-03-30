import { NextResponse, type NextRequest } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function POST(req: NextRequest) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  try {
    const formData = await req.formData();
    const upstream = await fetch(`${BASE_URL}/upload/audio`, {
      method: 'POST',
      body: formData,
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to upload audio' },
      { status: 502 },
    );
  }
}
