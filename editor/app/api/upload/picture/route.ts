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
    const headers = new Headers();
    const contentType = req.headers.get('content-type');
    const contentLength = req.headers.get('content-length');

    if (contentType) {
      headers.set('content-type', contentType);
    }

    if (contentLength) {
      headers.set('content-length', contentLength);
    }

    const upstream = await fetch(`${BASE_URL}/upload/picture`, {
      method: 'POST',
      body: req.body,
      headers,
      // `duplex` is required when streaming a request body in Node.js.
      // @ts-expect-error `duplex` is supported at runtime but missing in typings.
      duplex: 'half',
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error('[upload/picture proxy] failed', error);
    return NextResponse.json(
      { error: 'Failed to upload picture' },
      { status: 502 },
    );
  }
}
