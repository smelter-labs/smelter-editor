import type { ObCam, ObShot, ObShotKind } from '@smelter-editor/types';
import { mainCamOf } from '@/lib/ob-van/tally';
import { SHOT_LABEL } from '@/lib/ob-van/view-labels';

// The SHOT bar: each button builds a shot from what is on preview and
// program right now and sends it to PREVIEW (the operator then TAKEs it).
// Pure, so the node tests pin the rules down.
//
//   SOLO     the preview's main camera
//   SPLIT    [preview main, program main]
//   PIP      preview main full, program main inset
//   QUAD     first 4 live cameras, the preview main first
//   GRID     every live camera (`cams: []`)
//   SLIDES   the `slides` camera + the preview main (program main when the
//            preview IS the slides camera)
//   VIRTUAL  digital follow of the preview main — only a `wide` camera

export type ShotCam = Pick<ObCam, 'id' | 'number' | 'role' | 'live'>;

export type ShotOption = {
  kind: ObShotKind;
  label: string;
  /** null = the button is disabled (see `why`). */
  shot: ObShot | null;
  /** Tooltip: what the button builds, or why it cannot. */
  why: string;
};

export type ShotContext = {
  cams: readonly ShotCam[];
  preview: ObShot | null;
  program: ObShot | null;
};

/** Cameras in bus order (by number). */
export function sortCams<T extends Pick<ObCam, 'number'>>(
  cams: readonly T[],
): T[] {
  return [...cams].sort((a, b) => a.number - b.number);
}

/** Live camera ids in bus order. */
export function liveCamIds(cams: readonly ShotCam[]): string[] {
  return sortCams(cams)
    .filter((c) => c.live)
    .map((c) => c.id);
}

/** Up to four live cameras for a quad, `firstId` leading when it is live. */
export function quadCams(
  cams: readonly ShotCam[],
  firstId: string | null,
): string[] {
  const live = liveCamIds(cams);
  const ordered =
    firstId && live.includes(firstId)
      ? [firstId, ...live.filter((id) => id !== firstId)]
      : live;
  return ordered.slice(0, 4);
}

export function buildShotOptions(ctx: ShotContext): ShotOption[] {
  const pv = mainCamOf(ctx.preview);
  const pg = mainCamOf(ctx.program);
  const camOf = (id: string | null) =>
    id ? (ctx.cams.find((c) => c.id === id) ?? null) : null;
  const tag = (id: string | null) => {
    const cam = camOf(id);
    return cam ? `CAM ${cam.number}` : '?';
  };
  const two = (a: string | null, b: string | null): string | null => {
    if (!a) return 'Put a camera on preview first.';
    if (!b) return 'Nothing on program to pair it with.';
    if (a === b) return 'Preview and program show the same camera.';
    return null;
  };
  const live = liveCamIds(ctx.cams);

  const solo: ShotOption = {
    kind: 'solo',
    label: SHOT_LABEL.solo,
    shot: pv ? { kind: 'solo', cam: pv } : null,
    why: pv ? `${tag(pv)} full frame` : 'Put a camera on preview first.',
  };

  const splitBlock = two(pv, pg);
  const split: ShotOption = {
    kind: 'split',
    label: SHOT_LABEL.split,
    shot: !splitBlock && pv && pg ? { kind: 'split', cams: [pv, pg] } : null,
    why: splitBlock ?? `${tag(pv)} | ${tag(pg)} side by side`,
  };

  const pip: ShotOption = {
    kind: 'pip',
    label: SHOT_LABEL.pip,
    shot: !splitBlock && pv && pg ? { kind: 'pip', main: pv, inset: pg } : null,
    why: splitBlock ?? `${tag(pv)} full, ${tag(pg)} inset`,
  };

  const q = quadCams(ctx.cams, pv);
  const quad: ShotOption = {
    kind: 'quad',
    label: SHOT_LABEL.quad,
    shot: q.length >= 2 ? { kind: 'quad', cams: q } : null,
    why:
      q.length >= 2
        ? `${q.map(tag).join(' + ')}`
        : 'A quad needs two live cameras.',
  };

  const grid: ShotOption = {
    kind: 'grid',
    label: SHOT_LABEL.grid,
    shot: live.length >= 2 ? { kind: 'grid', cams: [] } : null,
    why:
      live.length >= 2
        ? `every live camera (${live.length})`
        : 'A grid needs two live cameras.',
  };

  const slidesCam = sortCams(ctx.cams).find((c) => c.role === 'slides') ?? null;
  const speaker =
    slidesCam == null
      ? null
      : pv && pv !== slidesCam.id
        ? pv
        : pg && pg !== slidesCam.id
          ? pg
          : null;
  const slides: ShotOption = {
    kind: 'speaker-slides',
    label: SHOT_LABEL['speaker-slides'],
    shot:
      slidesCam && speaker
        ? { kind: 'speaker-slides', speaker, slides: slidesCam.id }
        : null,
    why: !slidesCam
      ? 'No camera has the SLIDES role.'
      : !speaker
        ? 'Put the speaker camera on preview.'
        : `slides ${tag(slidesCam.id)} + speaker ${tag(speaker)}`,
  };

  const pvCam = camOf(pv);
  const virtualOk = pvCam != null && pvCam.role === 'wide';
  const virtual: ShotOption = {
    kind: 'virtual',
    label: SHOT_LABEL.virtual,
    shot:
      virtualOk && pv ? { kind: 'virtual', cam: pv, target: 'speaker' } : null,
    why: virtualOk
      ? `digital follow of the speaker on ${tag(pv)}`
      : 'Only a WIDE camera on preview can run a virtual camera.',
  };

  return [solo, split, pip, quad, grid, slides, virtual];
}
