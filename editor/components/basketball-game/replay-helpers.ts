import type { BbCam, BbCamRole } from '@smelter-editor/types';

type Cams = Record<BbCamRole, BbCam>;

/** The clip driving the replay / Ultra AI clock: the hoop file cam, else the court's. */
export function replayClip(cams: Cams | null | undefined): string | null {
  for (const role of ['hoop', 'court'] as const) {
    const cam = cams?.[role];
    if (cam?.joined && cam.source === 'file' && cam.fileName)
      return cam.fileName;
  }
  return null;
}

/** `m:ss` of a clip media time. */
export function fmtClipTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
