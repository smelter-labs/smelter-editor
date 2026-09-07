'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
} from '@/lib/server-url';

/** localStorage override for the public page base (LAN/tunnel testing). */
export const PUBLIC_BASE_KEY = 'smelter-public-base';

/** Public page base: env override, else the page's own origin. */
export function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

/**
 * The join-link recipe shared by every arcade game (duck hunter, kettlebell
 * tournament, basketball): `<public base><path>?server=<api url>` — the phone
 * page reads `?server=` via applyServerUrlFromQueryParam so a QR scanned on a
 * LAN/tunnel setup still talks to the right API.
 */
export function buildJoinUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, '');
  if (!b) return '';
  const api = getStoredClientServerUrl() ?? getPublicDefaultServerUrl();
  const sep = path.includes('?') ? '&' : '?';
  return api ? `${b}${path}${sep}server=${encodeURIComponent(api)}` : `${b}${path}`;
}

/** Host part of the base, for the "scan → host" caption on the broadcast. */
export function joinLabelFor(base: string): string {
  try {
    return new URL(base.trim()).host;
  } catch {
    return base.trim();
  }
}

/**
 * Build one join link per role for a room. `paths` maps a role key to the
 * page path (already including the room id, e.g. `/mobile/<room>/lift`).
 * Links are empty strings until the base is known (after mount) and the room
 * exists.
 */
export function useJoinLinks<K extends string>(
  roomId: string | null,
  paths: Record<K, string>,
): { base: string; label: string; links: Record<K, string> } {
  const [base, setBase] = useState('');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(PUBLIC_BASE_KEY);
    } catch {
      /* storage blocked — fall through to the default */
    }
    setBase(saved || defaultPublicBase());
  }, []);

  // Paths are rebuilt by callers every render; key on their serialized form
  // so the memo is stable without asking callers to memoize.
  const pathsKey = JSON.stringify(paths);
  const links = useMemo(() => {
    const entries = JSON.parse(pathsKey) as Record<K, string>;
    const out = {} as Record<K, string>;
    for (const key of Object.keys(entries) as K[]) {
      out[key] = base && roomId ? buildJoinUrl(base, entries[key]) : '';
    }
    return out;
  }, [base, roomId, pathsKey]);

  return { base, label: joinLabelFor(base), links };
}

/**
 * Push a join link + label to the server (debounced) so the broadcast's
 * lobby scene can burn in its own QR. The server can't know the public page
 * base, hence the round trip. Failures are swallowed — the on-air QR simply
 * stays on its placeholder.
 */
export function useJoinLinkPush(args: {
  roomId: string | null;
  url: string;
  label: string;
  push: (roomId: string, url: string, label: string) => Promise<unknown>;
  debounceMs?: number;
}): void {
  const { roomId, url, label, debounceMs = 600 } = args;
  const pushRef = useRef(args.push);
  pushRef.current = args.push;
  useEffect(() => {
    if (!roomId || !url) return;
    const timer = window.setTimeout(() => {
      void pushRef.current(roomId, url, label).catch(() => {
        /* non-fatal */
      });
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [roomId, url, label, debounceMs]);
}
