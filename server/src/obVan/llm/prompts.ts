/**
 * OB Van LLM — prompts. The system prompt is a constant (byte-stable, so it
 * caches across calls and rooms); everything event-specific (cameras, brief,
 * situation, transcripts) goes in the user turn. Cameras are always referred
 * to by NUMBER — camera ids never reach the model.
 */
import {
  OB_CAM_ROLES,
  OB_PRESET_META,
  obShotCams,
  type ObLogEntry,
  type ObPresetId,
  type ObRuleset,
  type ObShot,
  type ObStats,
} from '@smelter-editor/types';
import type { ObSituation } from '../contracts';
import { OB_DIRECT_MAX_ACTIONS, OB_RULES_DSL_DOC } from './schema';
import type { ObTranscriptLine } from './transcripts';

export const OB_LLM_NOTE_MAX_CHARS = 120;
export const OB_LLM_WRAP_MAX_WORDS = 120;

export function buildSystem(): string {
  const presets = OB_PRESET_META.map(
    (p) => `${p.id} (${p.sub}): ${p.blurb}`,
  ).join('\n- ');
  return `You are the director's assistant in "OB Van", a live multi-camera production desk (phones and video files as cameras, a program output on air). You are NOT the vision mixer: a deterministic auto pilot cuts every 100 ms from live signals (speech, loudness, onsets, motion, people, ball, caption keywords), and a human operator can override anything at any moment. You work in two ways:
1. BRIEF — turn the host's natural-language brief into a ruleset for the auto pilot (tool propose_ruleset).
2. ANALYST — every ~30 s you read a compact situation report and may nudge the show with at most ${OB_DIRECT_MAX_ACTIONS} bounded actions (tool direct).

Camera roles: ${OB_CAM_ROLES.join(', ')}, or custom:<name>. Cameras are numbered 1..8; always refer to a camera by its number ("cam:2" in rules, cam 2 in actions).

Presets (starting points):
- ${presets}

${OB_RULES_DSL_DOC}

Hard rules:
- Never invent cameras: use only camera numbers and roles present in the camera list you are given.
- Never ask for a cut sooner than the minimum hold; keep minHoldMs ≥ 1500 ms for talk-like events unless the brief asks for frantic cutting.
- Speech goes to the speaker's camera: whoever talks should be on air (roles speaker / guest), the wide shot covers silences, transitions and group moments.
- Slides (role slides, shot speaker-slides) only when slides are mentioned — by the brief or by a keyword group heard in the captions. Never park on slides.
- Lower thirds only for names heard in the transcripts or written in a camera's talent field. Keep names exactly as spoken or written, including diacritics (e.g. "Łukasz Wójcik"). Never guess a surname or a job title.
- At most ${OB_DIRECT_MAX_ACTIONS} actions per analyst turn; an empty list is a good answer when the show runs well. Notes ≤ ${OB_LLM_NOTE_MAX_CHARS} characters, plain and useful to a busy director.
- Prefer few, clear rules over many; priorities ≥ 80 only for things that must interrupt (a named slide cue, a replay).
- Keep every keyword group that a "keyword … has <group>" rule references; if you rename a group, rename it in the rule too.
- Keep the base ruleset's role biases (especially the negative slides / tape biases) and behaviours unless the brief asks otherwise. Never enable monologueLock or onsetCuts unprompted.
- Slides and tape cameras are not signal-analysed: never write a condition with cam pointing at them (they may appear in shots only).
- Always answer by calling the tool you are given. Do not answer in plain text unless no tool is provided.`;
}

/** Stable system prompt (built once). */
export const OB_LLM_SYSTEM = buildSystem();

function buildAnalystSystem(): string {
  return `You are the live director in "OB Van", a multi-camera production desk (phones and video files as cameras, one program output on air). A deterministic auto pilot handles micro-timing: every 100 ms it scores the live cameras from signals (speech, loudness, motion, people, keywords) and cuts to the best one. YOU fix what it gets wrong. You read a compact situation report + the last minute of captions and answer with at most ${OB_DIRECT_MAX_ACTIONS} actions (tool direct), most important first.

Your main lever is "cut": put a camera on program NOW. Issue a cut whenever the program is stale or wrong — the current shot has held long past the pacing, the person talking is on another camera, the program sits on silence while a conversation runs elsewhere, or a slide/tape moment passed and nobody cut back. Cut to whoever is speaking NOW (the per-camera "speaking" flag and the score ranking are your freshest evidence). Do not cut just to be busy: an empty actions list means the program is right — it never means you are unsure.

Clocks: the per-camera signals (speaking, scores) run AHEAD of the captions by the lookahead given in the report — captions describe what is on air now, signals describe what is about to air. Trust the signals for "who talks", the captions for "what was said".

Other actions: set_lower_third (names only as heard in captions or written in a talent field, diacritics kept — never guess), set_pacing (when the whole rhythm is off, not for one cut), prefer_cam (a soft bias when you want the auto pilot to favour a camera but the moment to cut is not now), advance_segment (only when the talk clearly moved on), note (≤ ${OB_LLM_NOTE_MAX_CHARS} chars, plain and useful to a busy director).

Hard rules:
- Use only camera numbers from the report; never invent cameras.
- Never cut to the camera already on program.
- Respect the operator: if auto is paused by a manual cut, nudge, don't fight.
- Always answer by calling the direct tool, even for an empty actions list.`;
}

/** Stable analyst-only system prompt (no rules DSL — the analyst never writes rules). */
export const OB_LLM_SYSTEM_ANALYST = buildAnalystSystem();

type Cam = ObSituation['cams'][number];

function camLine(c: Cam): string {
  const parts = [`cam ${c.number}`, `role ${c.role}`, `name "${c.name}"`];
  if (c.talent) parts.push(`talent "${c.talent}"`);
  if (!c.live) parts.push('NOT LIVE');
  return `- ${parts.join(' · ')}`;
}

/** A compact copy of a preset ruleset for the brief (ids dropped). */
function compactRuleset(r: ObRuleset): string {
  return JSON.stringify({ ...r, id: undefined });
}

export function buildBriefUser(input: {
  brief: string;
  presetId: ObPresetId;
  preset: ObRuleset;
  cams: ObSituation['cams'];
  eventName?: string;
}): string {
  const cams = input.cams.length
    ? input.cams.map(camLine).join('\n')
    : '- (no cameras yet — use role selectors only, never cam:<n>)';
  return `Event: ${input.eventName ?? '(untitled)'}
Base preset: ${input.presetId}

Cameras:
${cams}

Current ruleset in force (adapt it; keep what fits, change what the brief asks for):
${compactRuleset(input.preset)}

Host's brief:
"""
${input.brief.trim()}
"""

Write the ruleset for this event and call propose_ruleset. Reference only the cameras above (by role or cam:<number>).`;
}

function shotLabel(
  shot: ObShot | null,
  numberOf: (camId: string) => number | null,
): string {
  if (!shot) return 'nothing';
  const cams = obShotCams(shot)
    .map((id) => numberOf(id))
    .map((n) => (n === null ? 'cam ?' : `cam ${n}`));
  return `${shot.kind} ${cams.join(' + ')}`;
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

/** Compact situation report + last minute of captions for the analyst. */
export function buildAnalystUser(
  situation: ObSituation,
  transcripts: ObTranscriptLine[],
): string {
  const now = situation.atMs;
  const numberOf = (camId: string) =>
    situation.cams.find((c) => c.camId === camId)?.number ?? null;
  const cams = situation.cams.map((c) => ({
    cam: c.number,
    role: c.role,
    name: c.name,
    talent: c.talent,
    live: c.live,
    program: c.onProgram,
    preview: c.onPreview,
    ...(c.signals
      ? {
          speakingNow: c.signals.speaking,
          speech: Math.round(c.signals.speechShare * 100) / 100,
          dB: Math.round(c.signals.rmsDb),
          motion: Math.round(c.signals.motion * 100) / 100,
          people: c.signals.people,
          ...(situation.scores && situation.scores[c.number] !== undefined
            ? { score: Math.round(situation.scores[c.number] * 100) / 100 }
            : {}),
        }
      : { signals: 'none' }),
  }));
  const p = situation.program;
  const programBits = [
    `${shotLabel(p.shot, numberOf)} for ${secs(now - p.sinceMs)} (${p.source})`,
  ];
  if (p.holdRemainingMs !== null && p.holdRemainingMs > 0)
    programBits.push(`hold ${secs(p.holdRemainingMs)} left`);
  if (p.autoPausedForMs !== null && p.autoPausedForMs > 0)
    programBits.push(`auto paused ${secs(p.autoPausedForMs)} (operator cut)`);
  if (p.scheduledNext)
    programBits.push(
      `next: ${p.scheduledNext.shot} in ${secs(p.scheduledNext.inMs)}`,
    );
  const report = {
    event: situation.eventName,
    preset: situation.presetId,
    segment: situation.segment
      ? `${situation.segment.index + 1}/${situation.rundown.length} ${situation.segment.title}`
      : null,
    rundown: situation.rundown,
    program: programBits.join(' · '),
    pacing: situation.pacing,
    signalsRunAheadOfCaptionsMs: situation.lookaheadMs,
    lowerThird: situation.lowerThird
      ? `${situation.lowerThird.name}${situation.lowerThird.camNumber ? ` on cam ${situation.lowerThird.camNumber}` : ''}`
      : null,
    cams,
    lastCuts: situation.lastCuts.map(
      (e) => `-${secs(now - e.atMs)} ${e.source}: ${e.text}`,
    ),
  };
  const lines = transcripts.length
    ? transcripts
        .map(
          (l) =>
            `[cam ${l.camNumber}] ${l.airMs > now ? '+' : '-'}${secs(Math.abs(now - l.airMs))}: ${l.text}`,
        )
        .join('\n')
    : '(no captions in the last minute)';
  return `Situation report (JSON):
${JSON.stringify(report)}

Captions, last 60 s (cam number, time relative to now):
${lines}

Brief (for context): ${situation.brief ? situation.brief.slice(0, 600) : '(none)'}

Direct the show: call direct (0–${OB_DIRECT_MAX_ACTIONS} actions). Cut if the program camera is stale or the speaker is elsewhere; empty list if the program is right.`;
}

export function buildWrapUser(input: {
  eventName: string;
  brief: string;
  stats: ObStats;
  log: ObLogEntry[];
  cams: { camId: string; number: number; name: string; role: string }[];
}): string {
  const camName = (camId: string) => {
    const c = input.cams.find((x) => x.camId === camId);
    return c ? `cam ${c.number} ${c.name} (${c.role})` : 'a removed camera';
  };
  const s = input.stats;
  const durationMs =
    s.startedAtMs !== null && s.endedAtMs !== null
      ? s.endedAtMs - s.startedAtMs
      : null;
  const share = Object.entries(s.onAirMsByCam)
    .sort((a, b) => b[1] - a[1])
    .map(([camId, ms]) => `${camName(camId)}: ${secs(ms)}`);
  const log = input.log
    .slice(-40)
    .map((e) => `${e.source} ${e.kind}: ${e.text}`);
  return `Event: ${input.eventName}
Duration: ${durationMs === null ? 'unknown' : secs(durationMs)}
Cuts: ${s.cuts} (operator ${s.bySource.operator}, auto ${s.bySource.auto}, llm ${s.bySource.llm}, system ${s.bySource.system}); average hold ${secs(s.avgHoldMs)}
Time on air: ${share.join('; ') || 'n/a'}
Brief: ${input.brief ? input.brief.slice(0, 600) : '(none)'}
Last log lines:
${log.join('\n') || '(empty)'}

Write the director's wrap-up notes: at most ${OB_LLM_WRAP_MAX_WORDS} words, plain text, no headings — what worked, what to fix next time (pacing, camera balance, rules), one concrete suggestion for the ruleset.`;
}
