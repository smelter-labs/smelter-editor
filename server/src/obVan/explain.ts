/**
 * OB Van — human wording for auto-pilot decisions (the "WHY" log):
 * `CAM 2 Anna · speech 2.4 s · faces 1 · held CAM 1 12 s · rule slides-kw`.
 * Pure string building from the brain's context; no decisions are made here.
 */
import type { ObShot } from '@smelter-editor/types';
import type { ObBrainCam, ObBrainContext, ObSignalState } from './contracts';

const secs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
const wholeSecs = (ms: number) => `${Math.round(Math.max(0, ms) / 1000)} s`;

/** `CAM 2 Anna` — bus number plus the operator-facing name when it says more. */
export function camLabel(cams: ObBrainCam[], camId: string): string {
  const cam = cams.find((c) => c.camId === camId);
  if (!cam) return camId;
  const base = `CAM ${cam.number}`;
  const name = cam.name.trim();
  return name && name.toUpperCase() !== base ? `${base} ${name}` : base;
}

/** What goes on air, e.g. `SPLIT CAM 1 / CAM 2`, `CAM 3 VIRTUAL ball`. */
export function shotLabel(cams: ObBrainCam[], shot: ObShot): string {
  const l = (id: string) => camLabel(cams, id);
  switch (shot.kind) {
    case 'solo':
      return l(shot.cam);
    case 'virtual':
      return `${l(shot.cam)} VIRTUAL ${shot.target ?? 'centroid'}`;
    case 'split':
      return `SPLIT ${l(shot.cams[0])} / ${l(shot.cams[1])}`;
    case 'pip':
      return `PIP ${l(shot.main)} / ${l(shot.inset)}`;
    case 'speaker-slides':
      return `SLIDES ${l(shot.slides)} + ${l(shot.speaker)}`;
    case 'quad':
    case 'grid':
      return shot.cams.length
        ? `${shot.kind.toUpperCase()} ${shot.cams.map(l).join(' / ')}`
        : `${shot.kind.toUpperCase()} all`;
  }
}

/** The measurable reasons a camera is interesting at air time `T`. */
export function camFacts(
  state: ObSignalState | undefined,
  T: number,
): string[] {
  if (!state || state.offline) return [];
  const facts: string[] = [];
  if (!state.staleAudio && state.speech && state.speechSinceAirMs !== null) {
    facts.push(`speech ${secs(T - state.speechSinceAirMs)}`);
  }
  if (!state.staleVideo) {
    if (state.people.count > 0) facts.push(`faces ${state.people.count}`);
    if (state.ball) facts.push(`ball ${Math.round(state.ball.conf * 100)}%`);
    if (state.motionSpike) facts.push('motion spike');
    else if (state.motionEma >= 0.2)
      facts.push(`motion ${state.motionEma.toFixed(2)}`);
    if (state.burst.active) facts.push('burst');
  }
  if (!state.staleAudio && state.beat.periodMs !== null)
    facts.push(`beat ${state.beat.periodMs} ms`);
  return facts.slice(0, 3);
}

/** `held CAM 1 12 s` — what the decision replaces and for how long it was on. */
export function heldFact(ctx: ObBrainContext, T: number): string | null {
  const shot = ctx.program.shot;
  if (!shot) return null;
  return `held ${shotLabel(ctx.cams, shot)} ${wholeSecs(T - ctx.program.sinceAirMs)}`;
}

export function scoreFact(best: number, program: number | null): string {
  return program === null
    ? `score ${best.toFixed(2)}`
    : `score ${best.toFixed(2)} vs ${program.toFixed(2)}`;
}

export function timingFact(
  kind: 'anticipated' | 'beat',
  offsetMs: number,
): string {
  const sign = offsetMs < 0 ? '−' : '+';
  return kind === 'anticipated'
    ? `anticipated ${sign}${Math.abs(Math.round(offsetMs))} ms`
    : `beat ${sign}${Math.abs(Math.round(offsetMs))} ms`;
}

/** One log line from the ordered parts. */
export function reasonLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}
