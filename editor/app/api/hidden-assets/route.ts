import { NextResponse } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

export async function GET() {
  const baseUrl = await getServerSideServerUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Server URL not configured' },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(`${baseUrl}/hidden-assets`);
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load hidden assets' },
      { status: 502 },
    );
  }
}
