import {
  obShotCams,
  type ObCam,
  type ObShot,
  type ObTally,
} from '@smelter-editor/types';

// Tally: red when a camera is in the program shot, green when it is in the
// preview shot (program wins). The server sends each phone its own tally;
// the host and the panel derive it from the shots so the buses and the
// phones can never disagree about what is on air.

/**
 * Camera ids a shot puts on screen. An empty grid means "every live
 * camera", so it expands to `liveCamIds`.
 */
export function shotCamIds(
  shot: ObShot | null | undefined,
  liveCamIds: readonly string[] = [],
): string[] {
  if (!shot) return [];
  if (shot.kind === 'grid' && shot.cams.length === 0) return [...liveCamIds];
  return obShotCams(shot);
}

export function tallyFor(
  camId: string,
  program: ObShot | null | undefined,
  preview: ObShot | null | undefined,
  liveCamIds: readonly string[] = [],
): ObTally {
  if (shotCamIds(program, liveCamIds).includes(camId)) return 'program';
  if (shotCamIds(preview, liveCamIds).includes(camId)) return 'preview';
  return 'off';
}

/** Tally of every camera, keyed by camera id. */
export function tallyMap(
  cams: readonly Pick<ObCam, 'id' | 'live'>[],
  program: ObShot | null | undefined,
  preview: ObShot | null | undefined,
): Record<string, ObTally> {
  const live = cams.filter((c) => c.live).map((c) => c.id);
  const out: Record<string, ObTally> = {};
  for (const cam of cams)
    out[cam.id] = tallyFor(cam.id, program, preview, live);
  return out;
}

export const TALLY_LABEL: Record<ObTally, string> = {
  program: 'ON AIR',
  preview: 'PREVIEW',
  off: 'STANDBY',
};

/** Vibration pattern for a tally change on the phone (null = stay quiet). */
export function tallyVibration(
  prev: ObTally | null,
  next: ObTally,
): number[] | null {
  if (prev === next || prev === null) return null;
  if (next === 'program') return [200, 100, 200];
  if (prev === 'program') return [80];
  return null;
}

/** First camera of a shot (the "main" picture), for bus highlighting. */
export function mainCamOf(shot: ObShot | null | undefined): string | null {
  if (!shot) return null;
  switch (shot.kind) {
    case 'solo':
    case 'virtual':
      return shot.cam;
    case 'pip':
      return shot.main;
    case 'speaker-slides':
      return shot.speaker;
    case 'split':
      return shot.cams[0] ?? null;
    case 'quad':
    case 'grid':
      return shot.cams[0] ?? null;
  }
}
