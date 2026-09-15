import type { FbCam, FbCamRole } from '@smelter-editor/types';

type Cams = Record<FbCamRole, FbCam>;

/** The clip driving the clock / telemetry / AI events: panorama, else centre, left, right. */
export function replayClip(cams: Cams | null | undefined): string | null {
  for (const role of ['pano', 'centre', 'left', 'right'] as const) {
    const cam = cams?.[role];
    if (cam?.fileName) return cam.fileName;
  }
  return null;
}

/** `m:ss` of a clip media time. */
export function fmtClipTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
