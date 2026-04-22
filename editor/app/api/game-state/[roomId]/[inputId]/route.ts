import { NextResponse } from 'next/server';
import { getServerSideServerUrl } from '@/lib/server-url.server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string; inputId: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }

  try {
    const { roomId, inputId } = await params;
    const body = await request.json();

    const response = await fetch(
      `${baseUrl}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/game-state`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

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
