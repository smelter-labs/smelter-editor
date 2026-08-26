'use client';

import React, { useState } from 'react';
import {
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
} from '@/lib/server-url';
import { KBT, displayFont } from './kbt-kit';

/**
 * Absolute URL for a player's profile photo. `photoUrl` is server-relative
 * (`/kbt-photos/…`) — grafted onto the same base the page uses for the WS,
 * since the browser talks to the fastify server directly, not through Next.
 */
export function kbtPhotoSrc(photoUrl?: string | null): string | null {
  if (!photoUrl || typeof window === 'undefined') return null;
  // Same base chain as the room WS — photos live on the fastify server. On a
  // remote origin (ngrok/Caddy tunnel) the page's own origin proxies these
  // paths to the API; on localhost dev it would point at Next (404), so the
  // loopback fallback stays last.
  const base =
    getStoredClientServerUrl() ??
    getPublicDefaultServerUrl() ??
    remoteOrigin() ??
    getEffectiveClientServerUrl();
  return base.replace(/\/+$/, '') + photoUrl;
}

/**
 * Square player avatar in the kit's hard-edged look: the uploaded photo
 * inside a frame of the player's color, or — with no photo (or a stale URL
 * after a server restart) — a solid color block with the name's initial.
 */
export function KbtAvatar({
  name,
  color,
  photoUrl,
  size = 24,
  style,
}: {
  name: string;
  color: string;
  photoUrl?: string | null;
  size?: number;
  style?: React.CSSProperties;
}) {
  // Track WHICH src failed, so a fresh upload (new content-hashed URL) gets a
  // fresh attempt instead of being stuck behind a latched error flag.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = kbtPhotoSrc(photoUrl);
  const showPhoto = !!src && failedSrc !== src;
  const border = Math.max(1, Math.round(size / 16));
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color,
        overflow: 'hidden',
        ...style,
      }}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setFailedSrc(src)}
          style={{
            width: size - border * 2,
            height: size - border * 2,
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <span
          style={{
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: Math.round(size * 0.55),
            lineHeight: 1,
            color: KBT.dark,
            userSelect: 'none',
          }}>
          {(name.trim()[0] ?? '?').toUpperCase()}
        </span>
      )}
    </span>
  );
}
