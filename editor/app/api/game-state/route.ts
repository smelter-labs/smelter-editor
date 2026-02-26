import { NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();

    const response = await fetch(`${BASE_URL}/game-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: text || `Failed with status ${response.status}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unexpected error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
