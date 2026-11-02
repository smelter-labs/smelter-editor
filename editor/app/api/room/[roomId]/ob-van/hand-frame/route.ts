import { getServerSideServerUrl } from '@/lib/server-url.server';

// Finger-frame bridge for the editor's own WHIP publish tab (the camera the
// OB Van adopts as a cam): GET answers "should this tab run the in-browser
// hand detector" (the FRAME toggle + which inputs are OB cameras), POST
// forwards detected quads / the pinch sign to the server's
// /ob-van/hand-frame. Proxied like the motion SSE route, so the browser
// never needs direct reachability to the server.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { roomId } = await params;
  if (!baseUrl) {
    return Response.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }
  const upstream = await fetch(
    `${baseUrl}/room/${encodeURIComponent(roomId)}/ob-van/state`,
    { cache: 'no-store' },
  );
  if (!upstream.ok) {
    return Response.json({ fingerFrame: false, camInputIds: [] });
  }
  const { state } = (await upstream.json()) as {
    state?: {
      fingerFrame?: boolean;
      cams?: { inputId?: string | null }[];
    };
  };
  return Response.json({
    fingerFrame: state?.fingerFrame === true,
    camInputIds: (state?.cams ?? [])
      .map((c) => c.inputId)
      .filter((id): id is string => typeof id === 'string'),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const baseUrl = await getServerSideServerUrl();
  const { roomId } = await params;
  if (!baseUrl) {
    return Response.json(
      { error: 'SMELTER_EDITOR_SERVER_URL is not configured' },
      { status: 500 },
    );
  }
  const body = await request.text();
  const upstream = await fetch(
    `${baseUrl}/room/${encodeURIComponent(roomId)}/ob-van/hand-frame`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      cache: 'no-store',
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
