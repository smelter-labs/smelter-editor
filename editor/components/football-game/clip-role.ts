import type { FbCamRole, FbSession } from '@smelter-editor/types';

const byName = (role: FbCamRole, f: string): boolean =>
  role === 'pano'
    ? /pano/i.test(f) || !/cam\d/i.test(f)
    : role === 'left'
      ? /cam0|left/i.test(f)
      : role === 'centre'
        ? /cam1|centre|center/i.test(f)
        : /cam2|right/i.test(f);

/**
 * Whether a library clip is a candidate for a camera role. The clip's sidecar
 * (`session`) decides the rig — the server refuses a mismatch anyway; the file
 * name only tells the three cameras apart, and is the whole story for footage
 * without a sidecar (`session` null / unknown).
 */
export function clipFitsRole(
  role: FbCamRole,
  fileName: string,
  session: FbSession | null | undefined,
): boolean {
  if (session === 'pano') return role === 'pano';
  if (session === 'tricam') {
    if (role === 'pano') return false;
    // A camera clip with an unrecognisable name stays on offer for every cam.
    const named = (['left', 'centre', 'right'] as const).some((r) =>
      byName(r, fileName),
    );
    return named ? byName(role, fileName) : true;
  }
  return byName(role, fileName);
}
