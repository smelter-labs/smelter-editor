import { NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

export async function POST(request: Request) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }

  try {
    const body = (await request.json()) as {
      roomId?: string;
      inputId?: string;
    };

    const roomId = body?.roomId?.trim();
    const inputId = body?.inputId?.trim();

    if (!roomId || !inputId) {
      return NextResponse.json(
        { error: 'roomId and inputId are required' },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${BASE_URL}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/whip/ack`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
