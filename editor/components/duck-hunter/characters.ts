import type { RetroAccent } from './retro-kit';

/**
 * The three pre-rendered "CHARACTER SELECT" clips bundled with the server
 * (server/duck-hunter-defaults → seeded into data/mp4s/duck-hunter-characters
 * at startup). Each is a loopable 1280×720 animated select screen for one
 * character; the /duck-hunter page plays them as the literal select UI.
 */
export type ArcadeCharacter = {
  id: 'improwizator' | 'crane-hunter' | 'pink-spotter';
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

export const CHARACTERS: ArcadeCharacter[] = [
  {
    id: 'improwizator',
    name: 'IMPROWIZATOR',
    title: 'DIY Ranger',
    file: 'duck-hunter-characters/improwizator.mp4',
    accent: 'cyan',
    color: '#4fc3f7',
  },
  {
    id: 'crane-hunter',
    name: 'CRANE HUNTER',
    title: 'Kimono Blaster',
    file: 'duck-hunter-characters/crane-hunter.mp4',
    accent: 'orange',
    color: '#ff9210',
  },
  {
    id: 'pink-spotter',
    name: 'PINK SPOTTER',
    title: 'Visor Scout',
    file: 'duck-hunter-characters/pink-spotter.mp4',
    accent: 'pink',
    color: '#FF4081',
  },
];

/** Browser-playable URL for a character clip (Next proxy → server data dir). */
export function characterVideoUrl(c: ArcadeCharacter): string {
  return `/api/play/mp4/${c.file}`;
}
