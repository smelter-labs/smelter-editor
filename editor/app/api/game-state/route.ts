import { NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

function getCorsHeaders(request?: Request) {
  const requestedHeaders =
    request?.headers.get('access-control-request-headers') ??
    'Content-Type, X-Game-Id';
  const requestedPrivateNetwork =
    request?.headers.get('access-control-request-private-network') === 'true';

  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders,
    ...(requestedPrivateNetwork
      ? { 'Access-Control-Allow-Private-Network': 'true' }
      : {}),
    Vary: 'Origin, Access-Control-Request-Headers',
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: Request) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500, headers: getCorsHeaders(request) },
    );
  }

  try {
    const gameId = request.headers.get('x-game-id');
    const body = await request.json();

    const response = await fetch(`${BASE_URL}/game-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gameId ? { 'x-game-id': gameId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: text || `Failed with status ${response.status}` },
        { status: response.status, headers: getCorsHeaders(request) },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { headers: getCorsHeaders(request) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unexpected error' },
      { status: 500, headers: getCorsHeaders(request) },
    );
  }
}
