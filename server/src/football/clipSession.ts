import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FbCamRole, FbSession } from '@smelter-editor/types';

/**
 * The rig a library clip was shot with, from its `<clip>.alfheim.json`
 * sidecar (scripts/alfheim-prep.mjs, carried over by fb-clip-window.mjs).
 * Null when the clip has no sidecar (any other footage) or it names no rig.
 */
export async function readFbClipSession(
  mp4Root: string,
  fileName: string,
): Promise<FbSession | null> {
  const file = path.join(mp4Root, fileName.replace(/\.mp4$/i, '.alfheim.json'));
  try {
    return sessionOf(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export function sessionOf(meta: unknown): FbSession | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const s = (meta as { session?: unknown }).session;
  return s === 'pano' || s === 'tricam' ? s : null;
}

/** Why `role` cannot run on a clip of `session` (null = fine / unknown rig). */
export function fbRoleRefusal(
  role: FbCamRole,
  session: FbSession | null,
): string | null {
  if (session == null) return null;
  if (role === 'pano' && session !== 'pano')
    return 'a three-camera clip — attach it as LEFT / CENTRE / RIGHT CAM';
  if (role !== 'pano' && session === 'pano')
    return 'a panorama clip — attach it as PANORAMA';
  return null;
}
