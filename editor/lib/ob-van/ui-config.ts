import {
  OB_CONFIG_LIMITS,
  OB_DEFAULT_CONFIG,
  OB_PRESET_IDS,
  OB_TRANSITION_LIMITS,
  OB_TRANSITION_TYPES,
  obPresetRuleset,
  parseObRuleset,
  type ObAudioPolicy,
  type ObConfig,
  type ObConfigPatch,
  type ObPacingDial,
  type ObPresetId,
  type ObRundownItem,
  type ObRuleset,
  type ObTransition,
} from '@smelter-editor/types';
import { clampResumeAfterMs } from './pacing';

// The host's event config in UI terms (what the SETUP screen edits and what
// survives a refresh in localStorage), and its mapping to the server's
// ObConfig / ObConfigPatch. Pure — the node tests cover it.

/** Output resolutions offered for a new event (the room is created with it). */
export const OB_RESOLUTIONS = ['720p', '1080p'] as const;
export type ObResolution = (typeof OB_RESOLUTIONS)[number];

export type ObUiConfig = {
  eventName: string;
  presetId: ObPresetId;
  brief: string;
  /** null = the preset's rules. */
  ruleset: ObRuleset | null;
  /** Where a custom ruleset came from (the rules cards' badge). */
  rulesOrigin: 'llm' | 'custom';
  rundown: ObRundownItem[];
  pacingDial: ObPacingDial;
  audio: ObAudioPolicy;
  autoPilot: { enabled: boolean; resumeAfterMs: number };
  /** TAKE transition. */
  transition: ObTransition;
  captions: boolean;
  titleBugVisible: boolean;
  lowerThirdMs: number;
  /** Start recording on GO LIVE (local: the host's recording hook does it). */
  record: boolean;
  resolution: ObResolution;
};

export const DEFAULT_OB_UI_CONFIG: ObUiConfig = {
  eventName: OB_DEFAULT_CONFIG.eventName,
  presetId: OB_DEFAULT_CONFIG.presetId,
  brief: '',
  ruleset: null,
  rulesOrigin: 'custom',
  rundown: [],
  pacingDial: OB_DEFAULT_CONFIG.pacingDial,
  audio: { ...OB_DEFAULT_CONFIG.audio },
  autoPilot: {
    enabled: OB_DEFAULT_CONFIG.autoPilot,
    resumeAfterMs: OB_DEFAULT_CONFIG.resumeAfterMs,
  },
  transition: { ...OB_DEFAULT_CONFIG.transition },
  captions: OB_DEFAULT_CONFIG.captions,
  titleBugVisible: OB_DEFAULT_CONFIG.titleBugVisible,
  lowerThirdMs: OB_DEFAULT_CONFIG.lowerThirdMs,
  record: false,
  resolution: '1080p',
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, fallback: string): string =>
  typeof v === 'string' ? v.slice(0, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;
const clampNum = (
  v: unknown,
  lim: { min: number; max: number },
  fallback: number,
): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(lim.max, Math.max(lim.min, v)))
    : fallback;

export function sanitizePresetId(v: unknown): ObPresetId {
  return v === 'custom' || (OB_PRESET_IDS as readonly unknown[]).includes(v)
    ? (v as ObPresetId)
    : DEFAULT_OB_UI_CONFIG.presetId;
}

export function sanitizePacingDial(v: unknown): ObPacingDial {
  return v === 'calm' || v === 'lively' || v === 'frantic'
    ? v
    : DEFAULT_OB_UI_CONFIG.pacingDial;
}

export function sanitizeAudio(v: unknown): ObAudioPolicy {
  if (!isRec(v)) return { mode: 'follow' };
  if (v.mode === 'mix') return { mode: 'mix' };
  if (v.mode === 'master' && typeof v.cam === 'string' && v.cam)
    return { mode: 'master', cam: v.cam };
  return { mode: 'follow' };
}

export function sanitizeTransition(v: unknown): ObTransition {
  const d = DEFAULT_OB_UI_CONFIG.transition;
  if (!isRec(v)) return { ...d };
  const type = (OB_TRANSITION_TYPES as readonly unknown[]).includes(v.type)
    ? (v.type as ObTransition['type'])
    : d.type;
  const out: ObTransition = {
    type,
    durationMs: clampNum(
      v.durationMs,
      OB_TRANSITION_LIMITS.durationMs,
      d.durationMs,
    ),
  };
  if (type === 'dip' && typeof v.holdMs === 'number')
    out.holdMs = clampNum(v.holdMs, OB_TRANSITION_LIMITS.holdMs, 0);
  return out;
}

export function sanitizeRundown(v: unknown): ObRundownItem[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: ObRundownItem[] = [];
  for (const raw of v.slice(0, OB_CONFIG_LIMITS.rundown.max)) {
    if (!isRec(raw) || typeof raw.title !== 'string') continue;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : newSegmentId();
    while (seen.has(id)) id = newSegmentId();
    seen.add(id);
    const item: ObRundownItem = { id, title: raw.title.slice(0, 40) };
    if ((OB_PRESET_IDS as readonly unknown[]).includes(raw.preset))
      item.preset = raw.preset as ObRundownItem['preset'];
    out.push(item);
  }
  return out;
}

export function newSegmentId(): string {
  return `seg-${Math.random().toString(36).slice(2, 8)}`;
}

/** A stored ruleset re-parsed against the preset (null when unreadable). */
export function sanitizeRuleset(
  v: unknown,
  presetId: ObPresetId,
): ObRuleset | null {
  if (v == null) return null;
  return parseObRuleset(v, obPresetRuleset(presetId)).ruleset;
}

/** Anything (a localStorage blob from any version) → a valid UI config. */
export function sanitizeObUiConfig(raw: unknown): ObUiConfig {
  const d = DEFAULT_OB_UI_CONFIG;
  if (!isRec(raw)) return structuredCloneConfig(d);
  const presetId = sanitizePresetId(raw.presetId);
  const auto = isRec(raw.autoPilot) ? raw.autoPilot : {};
  return {
    eventName: str(raw.eventName, OB_CONFIG_LIMITS.eventName.max, d.eventName),
    presetId,
    brief: str(raw.brief, OB_CONFIG_LIMITS.brief.max, ''),
    ruleset: sanitizeRuleset(raw.ruleset, presetId),
    rulesOrigin: raw.rulesOrigin === 'llm' ? 'llm' : 'custom',
    rundown: sanitizeRundown(raw.rundown),
    pacingDial: sanitizePacingDial(raw.pacingDial),
    audio: sanitizeAudio(raw.audio),
    autoPilot: {
      enabled: bool(auto.enabled, d.autoPilot.enabled),
      resumeAfterMs: clampResumeAfterMs(auto.resumeAfterMs),
    },
    transition: sanitizeTransition(raw.transition),
    captions: bool(raw.captions, d.captions),
    titleBugVisible: bool(raw.titleBugVisible, d.titleBugVisible),
    lowerThirdMs: clampNum(
      raw.lowerThirdMs,
      OB_CONFIG_LIMITS.lowerThirdMs,
      d.lowerThirdMs,
    ),
    record: bool(raw.record, d.record),
    resolution: (OB_RESOLUTIONS as readonly unknown[]).includes(raw.resolution)
      ? (raw.resolution as ObResolution)
      : d.resolution,
  };
}

function structuredCloneConfig(c: ObUiConfig): ObUiConfig {
  return JSON.parse(JSON.stringify(c)) as ObUiConfig;
}

/** Server config → UI config; host-only fields come from `local`. */
export function serverConfigToUi(
  cfg: ObConfig,
  local: Pick<ObUiConfig, 'record' | 'resolution' | 'rulesOrigin'>,
): ObUiConfig {
  return {
    eventName: cfg.eventName,
    presetId: cfg.presetId,
    brief: cfg.brief,
    ruleset: cfg.ruleset,
    rulesOrigin: local.rulesOrigin,
    rundown: sanitizeRundown(cfg.rundown),
    pacingDial: cfg.pacingDial,
    audio: sanitizeAudio(cfg.audio),
    autoPilot: {
      enabled: cfg.autoPilot,
      resumeAfterMs: clampResumeAfterMs(cfg.resumeAfterMs),
    },
    transition: sanitizeTransition(cfg.transition),
    captions: cfg.captions,
    titleBugVisible: cfg.titleBugVisible,
    lowerThirdMs: cfg.lowerThirdMs,
    record: local.record,
    resolution: local.resolution,
  };
}

/**
 * UI config → the full server patch. Each top-level key is one "section"
 * for `changedSections`, so a live push only carries what the host touched
 * (and never reverts what the operator panel changed meanwhile).
 */
export function uiConfigToPatch(ui: ObUiConfig): ObConfigPatch {
  return {
    eventName: ui.eventName.trim() || OB_DEFAULT_CONFIG.eventName,
    presetId: ui.presetId,
    ruleset: ui.ruleset,
    brief: ui.brief,
    rundown: ui.rundown.filter((r) => r.title.trim().length > 0),
    pacingDial: ui.pacingDial,
    audio: ui.audio,
    autoPilot: ui.autoPilot.enabled,
    resumeAfterMs: ui.autoPilot.resumeAfterMs,
    transition: ui.transition,
    captions: ui.captions,
    titleBugVisible: ui.titleBugVisible,
    lowerThirdMs: ui.lowerThirdMs,
  };
}

/** Sections the host keeps pushing while ON AIR (the rest is the panel's). */
export const ON_AIR_SECTIONS: readonly (keyof ObConfigPatch)[] = [
  'autoPilot',
  'resumeAfterMs',
  'pacingDial',
];
