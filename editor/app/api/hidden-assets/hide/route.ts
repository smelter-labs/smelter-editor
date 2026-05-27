import { NextResponse, type NextRequest } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function POST(req: NextRequest) {
  const baseUrl = await getServerSideServerUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  try {
    const body = await req.text();
    const upstream = await fetch(`${baseUrl}/hidden-assets/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to hide asset' },
      { status: 502 },
    );
  }
}
