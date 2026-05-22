import 'server-only';

import { cookies } from 'next/headers';
import { SERVER_URL_COOKIE_NAME } from '@/lib/server-url';
import { APP_MODE_COOKIE_NAME, DEFAULT_APP_MODE } from '@/lib/app-mode';

export async function getServerSideServerUrl(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const appMode =
    cookieStore.get(APP_MODE_COOKIE_NAME)?.value?.trim() || DEFAULT_APP_MODE;
  const envUrl = process.env.SMELTER_EDITOR_SERVER_URL?.replace(/\/$/, '');

  if (appMode === 'demo') {
    return envUrl;
  }

  const cookieValue = cookieStore.get(SERVER_URL_COOKIE_NAME)?.value?.trim();
  if (cookieValue) {
    return decodeURIComponent(cookieValue).replace(/\/$/, '');
  }

  return envUrl;
}
