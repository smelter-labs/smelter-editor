import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!BASE_URL) {
    return NextResponse.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }

  const { roomId } = await params;

  try {
    const response = await fetch(
      `${BASE_URL}/room/${encodeURIComponent(roomId)}`,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: text || `Failed with status ${response.status}` },
        { status: response.status, headers: corsHeaders },
      );
    }

    const data = await response.json();
    return NextResponse.json(
      { roomId, outputUrl: data.whepUrl },
      { headers: corsHeaders },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unexpected error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
