import {
  SHOOTER_CHARACTERS,
  type ShooterCharacterId,
} from '@smelter-editor/types';
import type { RetroAccent } from './retro-kit';

/**
 * Presentation layer over the shared SHOOTER_CHARACTERS catalog (the ids the
 * server validates). Each character has a pre-rendered 1280×720 looping
 * "CHARACTER SELECT" clip bundled with the server (server/duck-hunter-defaults
 * → seeded into data/mp4s/duck-hunter-characters at startup) plus a retro-kit
 * accent; ids/names/colors come from the shared list so they can't drift.
 */
export type ArcadeCharacter = {
  id: ShooterCharacterId;
  /** Headline name as rendered inside the clip. */
  name: string;
  /** Sub-line class, e.g. "DIY Ranger". */
  title: string;
  /** Path relative to data/mp4s (playable via /api/play/mp4/<file>). */
  file: string;
  accent: RetroAccent;
  /** Crosshair-style hex used wherever the character identity shows up. */
  color: string;
};

const CHARACTER_EXTRAS: Record<
  ShooterCharacterId,
  { file: string; accent: RetroAccent }
> = {
  improwizator: {
    file: 'duck-hunter-characters/improwizator.mp4',
    accent: 'cyan',
  },
  'crane-hunter': {
    file: 'duck-hunter-characters/crane-hunter.mp4',
    accent: 'orange',
  },
  'pink-spotter': {
    file: 'duck-hunter-characters/pink-spotter.mp4',
    accent: 'pink',
  },
};

export const CHARACTERS: ArcadeCharacter[] = SHOOTER_CHARACTERS.map((c) => ({
  ...c,
  ...CHARACTER_EXTRAS[c.id],
}));

/** Look up a character by (wire) id; null for unknown/absent picks. */
export function characterById(
  id: string | null | undefined,
): ArcadeCharacter | null {
  return CHARACTERS.find((c) => c.id === id) ?? null;
}

/** Browser-playable URL for a character clip (Next proxy → server data dir). */
export function characterVideoUrl(c: ArcadeCharacter): string {
  return `/api/play/mp4/${c.file}`;
}
