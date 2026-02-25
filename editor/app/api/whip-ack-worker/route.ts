import { NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function POST(request: Request) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId')?.trim();
  const inputId = url.searchParams.get('inputId')?.trim();

  if (!roomId || !inputId) {
    return NextResponse.json(
      { error: 'roomId and inputId query params are required' },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `${BASE_URL}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/whip/ack`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: text || `ACK failed with status ${response.status}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ status: 'ok' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unexpected error' },
      { status: 500 },
    );
  }
}
