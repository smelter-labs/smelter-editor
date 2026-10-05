/**
 * Structural parsing of OB Van operator commands arriving as raw JSON (the
 * panel's `ob_operator_cmd`). REST bodies are already TypeBox-validated and
 * LLM actions are built typed, but everything funnels through the same
 * `ObVanController.operate()` which re-checks the semantics (cameras exist,
 * are live, the phase allows it).
 */
import type {
  ObAudioPolicy,
  ObEffects,
  ObGrade,
  ObOperatorCommand,
  ObQuizAction,
  ObTransition,
  ObTransitionType,
} from '@smelter-editor/types';
import {
  OB_GRADES,
  OB_QUIZ_ACTIONS,
  OB_TRANSITION_TYPES,
  isObQuizLetter,
  parseObShot,
} from '@smelter-editor/types';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;
const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : undefined;

export function isTransitionType(v: unknown): v is ObTransitionType {
  return (OB_TRANSITION_TYPES as readonly unknown[]).includes(v);
}
export function isGrade(v: unknown): v is ObGrade {
  return (OB_GRADES as readonly unknown[]).includes(v);
}

export function parseTransitionPatch(
  raw: unknown,
): Partial<ObTransition> | null {
  if (!isRec(raw)) return null;
  const out: Partial<ObTransition> = {};
  if (raw.type !== undefined) {
    if (!isTransitionType(raw.type)) return null;
    out.type = raw.type;
  }
  const d = num(raw.durationMs);
  if (d !== undefined) out.durationMs = d;
  const h = num(raw.holdMs);
  if (h !== undefined) out.holdMs = h;
  return out;
}

export function parseTransition(raw: unknown): ObTransition | null {
  const t = parseTransitionPatch(raw);
  if (!t || !t.type) return null;
  return {
    type: t.type,
    durationMs: t.durationMs ?? 0,
    ...(t.holdMs !== undefined ? { holdMs: t.holdMs } : {}),
  };
}

export function parseEffectsPatch(raw: unknown): Partial<ObEffects> | null {
  if (!isRec(raw)) return null;
  const out: Partial<ObEffects> = {};
  if (raw.grade !== undefined) {
    if (!isGrade(raw.grade)) return null;
    out.grade = raw.grade;
  }
  const spot = bool(raw.spotlight);
  if (spot !== undefined) out.spotlight = spot;
  const soft = bool(raw.softBackground);
  if (soft !== undefined) out.softBackground = soft;
  return out;
}

export function parseAudioPolicy(raw: unknown): ObAudioPolicy | null {
  if (!isRec(raw)) return null;
  if (raw.mode === 'follow') return { mode: 'follow' };
  if (raw.mode === 'mix') return { mode: 'mix' };
  if (raw.mode === 'master' && typeof raw.cam === 'string' && raw.cam)
    return { mode: 'master', cam: raw.cam };
  return null;
}

/** Raw JSON → a structurally valid command, or null. */
export function parseObCommand(raw: unknown): ObOperatorCommand | null {
  if (!isRec(raw)) return null;
  switch (raw.op) {
    case 'preview': {
      const shot = parseObShot(raw.shot);
      return shot ? { op: 'preview', shot } : null;
    }
    case 'take': {
      if (raw.transition === undefined) return { op: 'take' };
      const transition = parseTransition(raw.transition);
      return transition ? { op: 'take', transition } : null;
    }
    case 'cut':
      return { op: 'cut' };
    case 'shot': {
      const shot = parseObShot(raw.shot);
      const mode = raw.mode;
      if (!shot || (mode !== 'take' && mode !== 'cut' && mode !== 'preview'))
        return null;
      return { op: 'shot', shot, mode };
    }
    case 'transition': {
      const transition = parseTransitionPatch(raw.transition);
      return transition ? { op: 'transition', transition } : null;
    }
    case 'fx': {
      const effects = parseEffectsPatch(raw.effects);
      return effects ? { op: 'fx', effects } : null;
    }
    case 'lower_third': {
      const cmd: ObOperatorCommand = { op: 'lower_third' };
      const camId = str(raw.camId, 80);
      if (camId) cmd.camId = camId;
      const name = str(raw.name, 60);
      if (name !== undefined) cmd.name = name;
      if (raw.subtitle === null) cmd.subtitle = null;
      else {
        const subtitle = str(raw.subtitle, 80);
        if (subtitle !== undefined) cmd.subtitle = subtitle;
      }
      if (raw.ms === null) cmd.ms = null;
      else {
        const ms = num(raw.ms);
        if (ms !== undefined) cmd.ms = ms;
      }
      const clear = bool(raw.clear);
      if (clear !== undefined) cmd.clear = clear;
      return cmd;
    }
    case 'title_bug': {
      const cmd: ObOperatorCommand = { op: 'title_bug' };
      const event = str(raw.event, 60);
      if (event !== undefined) cmd.event = event;
      if (raw.segment === null) cmd.segment = null;
      else {
        const segment = str(raw.segment, 60);
        if (segment !== undefined) cmd.segment = segment;
      }
      const visible = bool(raw.visible);
      if (visible !== undefined) cmd.visible = visible;
      return cmd;
    }
    case 'audio': {
      const audio = parseAudioPolicy(raw.audio);
      return audio ? { op: 'audio', audio } : null;
    }
    case 'auto': {
      const enabled = bool(raw.enabled);
      return enabled === undefined ? null : { op: 'auto', enabled };
    }
    case 'dip': {
      const holdMs = num(raw.holdMs);
      return holdMs === undefined ? { op: 'dip' } : { op: 'dip', holdMs };
    }
    case 'segment': {
      const action = raw.action;
      if (action !== 'next' && action !== 'prev' && action !== 'goto')
        return null;
      const index = num(raw.index);
      return index === undefined
        ? { op: 'segment', action }
        : { op: 'segment', action, index };
    }
    case 'replay': {
      const cmd: ObOperatorCommand = { op: 'replay' };
      const camId = str(raw.camId, 80);
      if (camId) cmd.camId = camId;
      const mediaMs = num(raw.mediaMs);
      if (mediaMs !== undefined) cmd.mediaMs = mediaMs;
      return cmd;
    }
    case 'cam': {
      const action = raw.action;
      const camId = str(raw.camId, 80);
      if (
        !camId ||
        (action !== 'role' &&
          action !== 'name' &&
          action !== 'talent' &&
          action !== 'kick')
      )
        return null;
      const value = str(raw.value, 60);
      return value === undefined
        ? { op: 'cam', action, camId }
        : { op: 'cam', action, camId, value };
    }
    case 'pacing': {
      const cmd: ObOperatorCommand = { op: 'pacing' };
      const minHoldMs = num(raw.minHoldMs);
      if (minHoldMs !== undefined) cmd.minHoldMs = minHoldMs;
      const maxHoldMs = num(raw.maxHoldMs);
      if (maxHoldMs !== undefined) cmd.maxHoldMs = maxHoldMs;
      const clear = bool(raw.clear);
      if (clear !== undefined) cmd.clear = clear;
      return cmd;
    }
    case 'prefer_cam': {
      const camId = str(raw.camId, 80);
      const forMs = num(raw.forMs);
      if (!camId || forMs === undefined) return null;
      const boost = num(raw.boost);
      return boost === undefined
        ? { op: 'prefer_cam', camId, forMs }
        : { op: 'prefer_cam', camId, forMs, boost };
    }
    case 'note': {
      const text = str(raw.text, 240);
      return text ? { op: 'note', text } : null;
    }
    case 'quiz': {
      const action = raw.action;
      if (!(OB_QUIZ_ACTIONS as readonly unknown[]).includes(action))
        return null;
      const cmd: ObOperatorCommand = {
        op: 'quiz',
        action: action as ObQuizAction,
      };
      const camId = str(raw.camId, 80);
      if (camId) cmd.camId = camId;
      if (isObQuizLetter(raw.letter)) cmd.letter = raw.letter;
      if (raw.verdict === 'correct' || raw.verdict === 'wrong')
        cmd.verdict = raw.verdict;
      return cmd;
    }
    case 'quiz_set': {
      const cmd: ObOperatorCommand = { op: 'quiz_set' };
      const auto = bool(raw.auto);
      if (auto !== undefined) cmd.auto = auto;
      const aiHost = bool(raw.aiHost);
      if (aiHost !== undefined) cmd.aiHost = aiHost;
      return auto === undefined && aiHost === undefined ? null : cmd;
    }
    default:
      return null;
  }
}
