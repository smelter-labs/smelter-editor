import 'server-only';

import { cookies } from 'next/headers';
import { SERVER_URL_COOKIE_NAME } from '@/lib/server-url';

export async function getServerSideServerUrl(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const envUrl = process.env.SMELTER_EDITOR_SERVER_URL?.replace(/\/$/, '');

  // The cookie is only ever set by an explicit choice (the geek-mode server
  // selector or a `?server=` deep link) — honor it in demo mode too, so a
  // phone that scanned a workshop QR reads room state from the same backend
  // its WebSocket and media connect to.
  const cookieValue = cookieStore.get(SERVER_URL_COOKIE_NAME)?.value?.trim();
  if (cookieValue) {
    return decodeURIComponent(cookieValue).replace(/\/$/, '');
  }

  return envUrl;
}
