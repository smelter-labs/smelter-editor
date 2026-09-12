import type { BbCam, BbCamRole, BbReplayState } from '@smelter-editor/types';

type Cams = Record<BbCamRole, BbCam>;

/** The clip driving the replay clock: the hoop file cam, else the court's. */
export function replayClip(cams: Cams | null | undefined): string | null {
  for (const role of ['hoop', 'court'] as const) {
    const cam = cams?.[role];
    if (cam?.joined && cam.source === 'file' && cam.fileName)
      return cam.fileName;
  }
  return null;
}

/**
 * Events file that belongs to the attached clip: `<clip>.events.json`, then
 * `events.json` in the clip's folder, then the first file in the library.
 */
export function defaultEventsFile(
  files: string[],
  cams: Cams | null | undefined,
): string {
  const clip = replayClip(cams);
  if (clip) {
    const base = clip.replace(/\.mp4$/i, '');
    const dir = clip.includes('/')
      ? clip.slice(0, clip.lastIndexOf('/') + 1)
      : '';
    const own = files.find((f) => f === `${base}.events.json`);
    if (own) return own;
    const folder = files.find((f) => f === `${dir}events.json`);
    if (folder) return folder;
  }
  return files[0] ?? '';
}

/** `m:ss` of a clip media time. */
export function fmtClipTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `GT 3/16 · next 4:12 in 7s` — the panel's replay status line. */
export function replayStatusLabel(replay: BbReplayState | null): string {
  if (!replay) return '';
  let label = `GT ${replay.fired}/${replay.total}`;
  if (replay.skipped) label += ` · ${replay.skipped} SKIPPED`;
  if (replay.nextEventTMs == null) return `${label} · DONE`;
  label += ` · NEXT ${fmtClipTime(replay.nextEventTMs)}`;
  if (replay.nextFireInMs == null) return `${label} · NO FILE CAM`;
  return `${label} IN ${Math.max(0, Math.ceil(replay.nextFireInMs / 1000))}S`;
}
