import 'server-only';

import { cookies } from 'next/headers';
import { SERVER_URL_COOKIE_NAME } from '@/lib/server-url';

export async function getServerSideServerUrl(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SERVER_URL_COOKIE_NAME)?.value?.trim();
  if (cookieValue) {
    return decodeURIComponent(cookieValue).replace(/\/$/, '');
  }

  return process.env.SMELTER_EDITOR_SERVER_URL?.replace(/\/$/, '');
}
