export async function sendWhipOfferLocal(
  inputId: string,
  bearerToken: string,
  whipUrl: string,
  sdp: string,
): Promise<{ answer: string; location: string | null }> {
  const res = await fetch(`${whipUrl}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/sdp',
      authorization: `Bearer ${bearerToken}`,
    },
    body: sdp,
    cache: 'no-store',
  });
  const answer = await res.text();
  if (!res.ok) throw new Error(`WHIP ${res.status}: ${answer}`);
  return { answer, location: res.headers.get('Location') };
}
