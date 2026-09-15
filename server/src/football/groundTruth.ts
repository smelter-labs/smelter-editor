import type { FbEventKind, FbSide, FbTeamId } from '@smelter-editor/types';
import { FB_EVENT_KINDS } from '@smelter-editor/types';

/**
 * The events sidecar scripts/alfheim-events.mjs writes next to a clip
 * (`events.json`): the plays the AI EVENTS mode fires at their clip media
 * time. Pure parsing + selection; no fs here so the controller tests stay
 * in-memory.
 */

export type FbGtEvent = {
  /** Clip media time (ms). */
  tMs: number;
  kind: FbEventKind;
  side?: FbSide;
  team: FbTeamId | null;
  /** goal: a candidate for the moderator (this footage has no confirmed goals). */
  candidate?: boolean;
  tag?: number;
  topKmh?: number;
  meters?: number;
  speedMs?: number;
  onTarget?: boolean;
  startMs?: number;
  endMs?: number;
  injected?: boolean;
};

export type FbGroundTruth = {
  t0Utc: number | null;
  durationMs: number | null;
  session: 'pano' | 'tricam' | null;
  /** Real kick-off relative to clip start (negative = the clip begins mid-half). */
  kickoffMs: number | null;
  /** Which goal of the picture each team attacks in this clip, when the file says. */
  attacks: Record<FbTeamId, FbSide> | null;
  events: FbGtEvent[];
  /** Kick-offs and other non-play markers, just counted. */
  otherEvents: number;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const isTeam = (v: unknown): v is FbTeamId => v === 'A' || v === 'B';
const isSide = (v: unknown): v is FbSide => v === 'left' || v === 'right';
const isKind = (v: unknown): v is FbEventKind =>
  typeof v === 'string' && (FB_EVENT_KINDS as readonly string[]).includes(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export function parseFbGroundTruth(json: unknown): FbGroundTruth {
  if (!isRecord(json) || !Array.isArray(json.events)) {
    throw new Error('events.json: expected an object with an `events` array');
  }
  const events: FbGtEvent[] = [];
  let otherEvents = 0;
  json.events.forEach((raw, i) => {
    if (!isRecord(raw))
      throw new Error(`events.json: event #${i} is not an object`);
    if (!isKind(raw.kind)) {
      otherEvents++;
      return;
    }
    const tMs = Number(raw.tMs);
    if (!Number.isFinite(tMs))
      throw new Error(`events.json: event #${i} has no valid tMs`);
    events.push({
      tMs: Math.round(tMs),
      kind: raw.kind,
      ...(isSide(raw.side) ? { side: raw.side } : {}),
      team: isTeam(raw.team) ? raw.team : null,
      ...(raw.candidate === true ? { candidate: true } : {}),
      ...(num(raw.tag) != null ? { tag: num(raw.tag) } : {}),
      ...(num(raw.topKmh) != null ? { topKmh: num(raw.topKmh) } : {}),
      ...(num(raw.meters) != null ? { meters: num(raw.meters) } : {}),
      ...(num(raw.speedMs) != null ? { speedMs: num(raw.speedMs) } : {}),
      ...(typeof raw.onTarget === 'boolean' ? { onTarget: raw.onTarget } : {}),
      ...(num(raw.startMs) != null ? { startMs: num(raw.startMs) } : {}),
      ...(num(raw.endMs) != null ? { endMs: num(raw.endMs) } : {}),
      ...(raw.injected === true ? { injected: true } : {}),
    });
  });
  events.sort((a, b) => a.tMs - b.tMs);
  let attacks: Record<FbTeamId, FbSide> | null = null;
  if (isRecord(json.teams)) {
    const a = isRecord(json.teams.A) ? json.teams.A.attacks : undefined;
    const b = isRecord(json.teams.B) ? json.teams.B.attacks : undefined;
    if (isSide(a) && isSide(b)) attacks = { A: a, B: b };
  }
  return {
    t0Utc: num(json.t0Utc) ?? null,
    durationMs: num(json.durationMs) ?? null,
    session:
      json.session === 'pano' || json.session === 'tricam'
        ? json.session
        : null,
    kickoffMs: num(json.kickoffMs) ?? null,
    attacks,
    events,
    otherEvents,
  };
}

/**
 * The plays AI EVENTS fires: the enabled kinds, with the team re-derived from
 * the play's side when the host overrides which team attacks the left goal.
 */
export function selectAiEvents(
  gt: Pick<FbGroundTruth, 'events'>,
  kinds: readonly FbEventKind[],
  attacksLeft: FbTeamId | null,
): FbGtEvent[] {
  const out: FbGtEvent[] = [];
  for (const e of gt.events) {
    if (!kinds.includes(e.kind)) continue;
    let team = e.team;
    if (attacksLeft && e.side && e.kind !== 'sprint' && e.kind !== 'attack') {
      const attacker: FbTeamId =
        e.side === 'left' ? attacksLeft : attacksLeft === 'A' ? 'B' : 'A';
      team = e.kind === 'goal_kick' ? (attacker === 'A' ? 'B' : 'A') : attacker;
    }
    out.push({ ...e, team });
  }
  return out;
}

/**
 * The "model confidence" an AI event reports: deterministic per play (stable
 * across clip loops). Goal candidates sit at 0.5 → always a REF CALL.
 */
export function aiConfidence(kind: FbEventKind, tMs: number): number {
  if (kind === 'goal') return 0.5;
  if (kind === 'sprint' || kind === 'attack' || kind === 'out') return 0.99;
  return 0.86 + (Math.floor(tMs / 50) % 12) / 100;
}
