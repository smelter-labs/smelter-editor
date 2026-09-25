import type {
  ObActionSource,
  ObAudioPolicy,
  ObCam,
  ObGrade,
  ObPhase,
  ObShot,
  ObShotKind,
  ObTransitionType,
} from '@smelter-editor/types';
import { shotCamIds } from './tally';

// Every on-screen word for shots, transitions, grades and phases, so the
// host, the panel and the phone say the same thing.

export const SHOT_LABEL: Record<ObShotKind, string> = {
  solo: 'SOLO',
  split: 'SPLIT',
  pip: 'PIP',
  quad: 'QUAD',
  grid: 'GRID',
  'speaker-slides': 'SLIDES',
  virtual: 'VIRTUAL',
};

export const TRANSITION_LABEL: Record<ObTransitionType, string> = {
  cut: 'CUT',
  dissolve: 'DISS',
  wipe: 'WIPE',
  fade: 'FADE',
  dip: 'DIP',
  'zoom-punch': 'ZOOM',
};

export const TRANSITION_NAME: Record<ObTransitionType, string> = {
  cut: 'cut',
  dissolve: 'dissolve',
  wipe: 'wipe',
  fade: 'fade through black',
  dip: 'dip to black',
  'zoom-punch': 'zoom punch',
};

export const GRADE_LABEL: Record<ObGrade, string> = {
  none: 'NONE',
  warm: 'WARM',
  cool: 'COOL',
  mono: 'MONO',
  vhs: 'VHS',
  neon: 'NEON',
};

export const PHASE_LABEL: Record<ObPhase, string> = {
  setup: 'SETUP',
  'on-air': 'ON AIR',
  wrap: 'WRAP',
};

export const SOURCE_LABEL: Record<ObActionSource, string> = {
  operator: 'OP',
  auto: 'AUTO',
  llm: 'LLM',
  system: 'SYS',
};

export const AUDIO_LABEL: Record<ObAudioPolicy['mode'], string> = {
  follow: 'FOLLOW',
  master: 'MASTER',
  mix: 'MIX',
};

export const AUDIO_BLURB: Record<ObAudioPolicy['mode'], string> = {
  follow: 'sound follows the program camera',
  master: 'one camera carries the sound all show',
  mix: 'every live camera mixed',
};

/** `CAM 2` */
export function camTag(cam: Pick<ObCam, 'number'> | null | undefined): string {
  return cam ? `CAM ${cam.number}` : 'CAM ?';
}

/**
 * A shot in one line: `CAM 2`, `SPLIT 1+3`, `PIP 2 / 4`, `VIRTUAL 1`,
 * `GRID ALL`. Unknown camera ids print as `?`.
 */
export function shotLabel(
  shot: ObShot | null | undefined,
  cams: readonly Pick<ObCam, 'id' | 'number'>[],
): string {
  if (!shot) return 'BLACK';
  const n = (id: string) => {
    const cam = cams.find((c) => c.id === id);
    return cam ? String(cam.number) : '?';
  };
  switch (shot.kind) {
    case 'solo':
      return `CAM ${n(shot.cam)}`;
    case 'virtual':
      return `VIRTUAL ${n(shot.cam)}${shot.target ? ` · ${shot.target.toUpperCase()}` : ''}`;
    case 'pip':
      return `PIP ${n(shot.main)} / ${n(shot.inset)}`;
    case 'speaker-slides':
      return `SLIDES ${n(shot.slides)} + ${n(shot.speaker)}`;
    case 'split':
      return `SPLIT ${shot.cams.map(n).join('+')}`;
    case 'quad':
    case 'grid': {
      const ids = shotCamIds(shot);
      return ids.length === 0
        ? `${SHOT_LABEL[shot.kind]} ALL`
        : `${SHOT_LABEL[shot.kind]} ${ids.map(n).join('+')}`;
    }
  }
}

/**
 * What the captions switch costs. One side-channel delay per event keeps
 * the cameras in sync on air, so transcription delays every camera.
 */
export function captionsNote(on: boolean): string {
  return on
    ? 'Delays every camera to 8 s on air (Whisper needs the lead). Names from the transcript can drive lower thirds.'
    : 'Cameras air 3 s behind — the auto pilot still sees ahead of the program.';
}
