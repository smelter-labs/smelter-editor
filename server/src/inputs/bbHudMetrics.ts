/**
 * Layout helpers for the Blacktop broadcast chrome (BbHud.tsx), kept
 * DOM/engine-free so the position maths is unit-testable.
 */

/** Plex Mono advance is 0.6 em: label widths are predictable without measuring. */
export function monoWidth(text: string, fontSize: number): number {
  return text.length * 0.6 * fontSize;
}

/**
 * A runtime tag chip (REG / PAUSED / FIRST TO +2 / FULL TIME): the block
 * hugs the text with 8 px side padding and centres on `cx`.
 */
export function tagChipRect(
  text: string,
  fontSize: number,
  cx: number,
  y: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.round(monoWidth(text, fontSize) + 16);
  return { x: Math.round(cx - w / 2), y, w, h: height };
}

/** The 496×320 PiP frame origin for a 480×270 window at pip rect (x, y). */
export function pipFrameOrigin(
  rect: { x: number; y: number },
  k: number,
): { x: number; y: number } {
  return { x: Math.round(rect.x / k) - 8, y: Math.round(rect.y / k) - 42 };
}

/** Clock face + tag for the score bug's centre cell. */
export type ClockFace = {
  main: string;
  mainColor: 'chalk' | 'amber' | 'bad' | 'electric' | 'dim';
  tag: string;
  tagTone: 'electric' | 'amber' | 'chalk' | 'outline';
};

export function clockFace(
  clock: {
    phase: 'lobby' | 'live' | 'paused' | 'overtime' | 'ended';
    period: 'reg' | 'ot';
    remainingMs: number;
  },
  otWinPoints: number,
  lobbyDurationMs: number | null,
  formatClock: (ms: number) => string,
): ClockFace {
  switch (clock.phase) {
    case 'lobby':
      return {
        main: 'WARM-UP',
        mainColor: 'dim',
        tag: formatClock(lobbyDurationMs ?? clock.remainingMs),
        tagTone: 'outline',
      };
    case 'paused':
      return {
        main: formatClock(clock.remainingMs),
        mainColor: 'amber',
        tag: 'PAUSED',
        tagTone: 'amber',
      };
    case 'overtime':
      return {
        main: 'OT',
        mainColor: 'electric',
        tag: `FIRST TO +${otWinPoints}`,
        tagTone: 'electric',
      };
    case 'ended':
      return {
        main: 'FINAL',
        mainColor: 'chalk',
        tag: clock.period === 'ot' ? 'AFTER OT' : 'FULL TIME',
        tagTone: 'chalk',
      };
    default:
      return {
        main: formatClock(clock.remainingMs),
        mainColor: clock.remainingMs <= 10_000 ? 'bad' : 'chalk',
        tag: clock.period === 'ot' ? 'OT' : 'REG',
        tagTone: 'electric',
      };
  }
}
