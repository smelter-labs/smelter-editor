import {
  OB_TRANSITION_TYPES,
  type ObCam,
  type ObOperatorCommand,
  type ObShot,
  type ObTransitionType,
} from '@smelter-editor/types';
import { mainCamOf } from '@/lib/ob-van/tally';

// The desk keyboard map, shared by the operator panel and the host's ON AIR
// screen. Pure: a key + what the desk shows → one command (or nothing).
//
//   1..9   preview camera N          Enter  TAKE (preview → program)
//   Space  CUT (also `.`)            A      auto pilot on / off
//   L      lower third on preview    T      next transition type
//   N      next rundown segment      R      replay (when the preset has it)

export type PanelKeyContext = {
  cams: readonly Pick<ObCam, 'id' | 'number' | 'connected'>[];
  preview: ObShot | null;
  program: ObShot | null;
  autoOn: boolean;
  transitionType: ObTransitionType;
  /** Camera the active lower third sits on (null = none on air). */
  lowerThirdCamId: string | null;
  rundownLength: number;
  replayEnabled: boolean;
};

export const PANEL_KEY_HINTS: { key: string; label: string }[] = [
  { key: '1-8', label: 'PREVIEW' },
  { key: 'ENTER', label: 'TAKE' },
  { key: 'SPACE', label: 'CUT' },
  { key: 'A', label: 'AUTO' },
  { key: 'L', label: 'LOWER THIRD' },
  { key: 'T', label: 'TRANSITION' },
  { key: 'N', label: 'NEXT' },
];

export function nextTransitionType(t: ObTransitionType): ObTransitionType {
  const i = OB_TRANSITION_TYPES.indexOf(t);
  return OB_TRANSITION_TYPES[(i + 1) % OB_TRANSITION_TYPES.length];
}

export function panelKeyToCommand(
  key: string,
  ctx: PanelKeyContext,
): ObOperatorCommand | null {
  if (/^[1-9]$/.test(key)) {
    const cam = ctx.cams.find((c) => c.number === Number(key));
    if (!cam) return null;
    return { op: 'preview', shot: { kind: 'solo', cam: cam.id } };
  }
  switch (key) {
    case 'Enter':
      return ctx.preview ? { op: 'take' } : null;
    case ' ':
    case '.':
      return ctx.preview ? { op: 'cut' } : null;
    case 'a':
    case 'A':
      return { op: 'auto', enabled: !ctx.autoOn };
    case 'l':
    case 'L': {
      const camId = mainCamOf(ctx.preview) ?? mainCamOf(ctx.program);
      if (!camId) return null;
      return ctx.lowerThirdCamId === camId
        ? { op: 'lower_third', clear: true }
        : { op: 'lower_third', camId };
    }
    case 't':
    case 'T':
      return {
        op: 'transition',
        transition: { type: nextTransitionType(ctx.transitionType) },
      };
    case 'n':
    case 'N':
      return ctx.rundownLength > 0 ? { op: 'segment', action: 'next' } : null;
    case 'r':
    case 'R': {
      if (!ctx.replayEnabled) return null;
      const camId = mainCamOf(ctx.program);
      return camId ? { op: 'replay', camId } : { op: 'replay' };
    }
    default:
      return null;
  }
}
