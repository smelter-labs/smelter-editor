/**
 * OB Van — the AI PANEL state machine.
 *
 * Pure, like `quiz.ts`: no timers (timeouts resolve inside `tick()`), no I/O —
 * the `quizTurn` signal, model asks and log lines come back as effects for
 * the controller to apply. The whole segment is unit-testable with a fake
 * clock.
 *
 * Flow per question: the host's transcript turn closes → `hostTurn()` (idle →
 * `thinking`, an `ask` effect carries the question + rolling history + the
 * answer order, alternating per question) → the controller fetches both
 * answers and calls `resolveAnswers()` (canned lines fill any failure) →
 * `answering`: the controller plays the clips in order and brackets each with
 * `speechStarted()` / `speechEnded()` (the turn signal moves the big tile) →
 * after the last one, back to `idle`; a question the host asked meanwhile
 * (`pendingQuestion`, latest wins) is asked right away.
 */
import type {
  ObCamRole,
  ObLogTone,
  ObPanelHistoryEntry,
  ObPanelPhase,
  ObPanelSpeakerId,
  ObPanelSpeakerStatus,
  ObPanelState,
  ObQuizModelId,
} from '@smelter-editor/types';
import {
  OB_PANEL_ANSWER_LEAD_MS,
  OB_PANEL_ANSWER_TIMEOUT_MS,
  OB_PANEL_HISTORY_MAX,
} from '@smelter-editor/types';

export type ObPanelEffect =
  | { type: 'turn'; camId: string | null }
  | {
      type: 'ask';
      seq: number;
      question: string;
      /** Prior conversation (the current question is NOT in it). */
      history: ObPanelHistoryEntry[];
      /** Who answers first alternates per question. */
      order: ObPanelSpeakerId[];
      /** Don't start the first answer clip before this wall-clock time. */
      notBeforeMs: number;
    }
  | {
      type: 'log';
      tone: ObLogTone;
      label: string;
      text: string;
      camId?: string;
    };

export type ObPanelCamView = {
  id: string;
  role: ObCamRole;
  name: string;
  talent: string | null;
  /** Model the talent name maps to (controller resolves the alias). */
  model: ObQuizModelId | null;
  live: boolean;
};

/** One model's final, speakable line (canned already substituted). */
export type ObPanelLine = {
  model: ObPanelSpeakerId;
  camId: string;
  text: string;
  canned: boolean;
};

/** In-character shrugs when a model's adapter is offline or times out. */
const CANNED_LINES: Record<ObPanelSpeakerId, string[]> = {
  opus: [
    "That's a profound question. I'd need a few more tokens to do it justice.",
    'I have thoughts, but my context window just walked off the set.',
    'Let me be direct: yes, no, and it depends. Mostly it depends.',
  ],
  gpt: [
    "Great question! I'd elaborate, but my rate limit says hello.",
    'As a large language model, I agree with whatever sounds smartest.',
    "I'll summarize: the future is uncertain, and so is my API key.",
  ],
};

type PanelSpeaker = {
  model: ObPanelSpeakerId;
  camId: string;
  name: string;
  status: ObPanelSpeakerStatus;
  lastText: string | null;
};

type PanelCurrent = {
  seq: number;
  question: string;
  order: ObPanelSpeakerId[];
  notBeforeMs: number;
  askedAtMs: number;
  resolved: boolean;
  lines: ObPanelLine[];
  speakingModel: ObPanelSpeakerId | null;
  spokenCount: number;
};

type PendingQuestion = { text: string; airEndMs: number };

export class ObPanelDiscussion {
  private speakers: PanelSpeaker[] = [];
  private current: PanelCurrent | null = null;
  private pending: PendingQuestion | null = null;
  private history: ObPanelHistoryEntry[] = [];
  private askSeq = 0;
  private nextFirst: ObPanelSpeakerId = 'opus';

  phase(): ObPanelPhase {
    if (!this.current) return 'idle';
    return this.current.resolved ? 'answering' : 'thinking';
  }

  /**
   * Reconcile panelists with the camera roster: the first live-or-not guest
   * cam mapping to each of opus / gpt. Statuses and last lines survive by
   * camId. When the roster loses every panelist mid-question, the question
   * is abandoned (its late answers then fail the seq guard).
   */
  syncSpeakers(cams: ObPanelCamView[]): {
    changed: boolean;
    effects: ObPanelEffect[];
  } {
    const effects: ObPanelEffect[] = [];
    const byId = new Map(this.speakers.map((s) => [s.camId, s]));
    const taken = new Set<ObPanelSpeakerId>();
    const next: PanelSpeaker[] = [];
    for (const c of cams) {
      if (c.role !== 'guest') continue;
      if (c.model !== 'opus' && c.model !== 'gpt') continue;
      if (taken.has(c.model)) continue;
      taken.add(c.model);
      const prior = byId.get(c.id);
      const name = c.talent?.trim() || c.name;
      next.push(
        prior
          ? { ...prior, model: c.model, name }
          : {
              model: c.model,
              camId: c.id,
              name,
              status: 'idle',
              lastText: null,
            },
      );
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.speakers);
    this.speakers = next;
    if (this.current && next.length === 0) {
      this.current = null;
      effects.push({ type: 'turn', camId: null });
      effects.push({
        type: 'log',
        tone: 'amber',
        label: 'PANEL',
        text: 'panelists left — question dropped',
      });
    }
    return { changed: changed || effects.length > 0, effects };
  }

  /**
   * A host transcript turn closed. Idle → ask the models; busy → park it as
   * the pending question (latest wins) for right after the last answer.
   * `airEndMs` is when the question finishes airing on program.
   */
  hostTurn(text: string, airEndMs: number, now: number): ObPanelEffect[] {
    if (this.speakers.length === 0)
      return [
        {
          type: 'log',
          tone: 'dim',
          label: 'PANEL',
          text: 'host asked, but no AI panelists are seated',
        },
      ];
    if (this.current) {
      this.pending = { text, airEndMs };
      return [
        {
          type: 'log',
          tone: 'dim',
          label: 'PANEL',
          text: `question queued: “${trimForLog(text)}”`,
        },
      ];
    }
    return this.ask(text, airEndMs, now);
  }

  /**
   * The controller fetched both answers (null = adapter offline / failed →
   * a canned line). Returns the final speakable lines in on-air order.
   * Guarded by the ask sequence — answers for an abandoned question land
   * nowhere.
   */
  resolveAnswers(
    seq: number,
    answers: { model: ObPanelSpeakerId; text: string | null }[],
  ): { ok: boolean; lines: ObPanelLine[]; effects: ObPanelEffect[] } {
    const c = this.current;
    if (!c || c.seq !== seq || c.resolved)
      return { ok: false, lines: [], effects: [] };
    const byModel = new Map(answers.map((a) => [a.model, a.text]));
    const effects: ObPanelEffect[] = [];
    c.lines = c.order.flatMap((model) => {
      const speaker = this.speakers.find((s) => s.model === model);
      if (!speaker) return [];
      const given = byModel.get(model) ?? null;
      const text = given ?? cannedLine(model, seq);
      speaker.lastText = text;
      this.pushHistory({ speaker: model, text });
      effects.push({
        type: 'log',
        tone: given ? 'ai' : 'amber',
        label: speaker.name,
        text: trimForLog(text),
        camId: speaker.camId,
      });
      return [{ model, camId: speaker.camId, text, canned: given === null }];
    });
    c.resolved = true;
    return { ok: true, lines: [...c.lines], effects };
  }

  /** An answer clip is about to play on air — the big tile moves there. */
  speechStarted(seq: number, model: ObPanelSpeakerId): ObPanelEffect[] {
    const c = this.current;
    if (!c || c.seq !== seq || !c.resolved) return [];
    const speaker = this.speakers.find((s) => s.model === model);
    if (!speaker) return [];
    c.speakingModel = model;
    speaker.status = 'speaking';
    return [{ type: 'turn', camId: speaker.camId }];
  }

  /**
   * An answer clip finished. After the last one: idle, pending fires. The
   * clips' brackets overlap a little (the next turn rises before this one's
   * tail lands), so the turn only clears when this speaker still holds it —
   * the featured tile then flows A → B directly, never flashing the host.
   */
  speechEnded(
    seq: number,
    model: ObPanelSpeakerId,
    now: number,
  ): ObPanelEffect[] {
    const c = this.current;
    if (!c || c.seq !== seq || !c.resolved) return [];
    const speaker = this.speakers.find((s) => s.model === model);
    if (speaker) speaker.status = 'done';
    c.spokenCount++;
    const effects: ObPanelEffect[] = [];
    if (c.speakingModel === model) {
      c.speakingModel = null;
      effects.push({ type: 'turn', camId: null });
    }
    if (c.spokenCount >= c.lines.length) effects.push(...this.finish(now));
    return effects;
  }

  /**
   * TTS is off: the answers only show on the desk — close the turn at once
   * (no speech brackets will come).
   */
  finishWithoutSpeech(seq: number, now: number): ObPanelEffect[] {
    const c = this.current;
    if (!c || c.seq !== seq || !c.resolved) return [];
    for (const line of c.lines) {
      const speaker = this.speakers.find((s) => s.model === line.model);
      if (speaker) speaker.status = 'done';
    }
    return this.finish(now);
  }

  /** Safety net: answers that never resolved nor played. Call every tick. */
  tick(now: number): { changed: boolean; effects: ObPanelEffect[] } {
    const c = this.current;
    if (!c || now - c.askedAtMs < OB_PANEL_ANSWER_TIMEOUT_MS)
      return { changed: false, effects: [] };
    // Resolved and mid-playback is the speech queue's business — only a
    // stuck `thinking` (or a resolved turn whose clips never started) dies.
    if (c.resolved && c.speakingModel !== null)
      return { changed: false, effects: [] };
    const effects: ObPanelEffect[] = [
      { type: 'turn', camId: null },
      {
        type: 'log',
        tone: 'amber',
        label: 'PANEL',
        text: 'answers timed out — moving on',
      },
      ...this.finish(now),
    ];
    this.current = null;
    return { changed: true, effects };
  }

  state(): ObPanelState {
    return {
      phase: this.phase(),
      seq: this.current?.seq ?? this.askSeq,
      question: this.current?.question ?? null,
      pendingQuestion: this.pending?.text ?? null,
      speakers: this.speakers.map((s) => ({ ...s })),
      turnCamId: this.current?.speakingModel
        ? (this.speakers.find((s) => s.model === this.current?.speakingModel)
            ?.camId ?? null)
        : null,
    };
  }

  reset(): void {
    this.current = null;
    this.pending = null;
    this.history = [];
    this.nextFirst = 'opus';
    this.speakers = this.speakers.map((s) => ({
      ...s,
      status: 'idle',
      lastText: null,
    }));
  }

  // ── Internals ───────────────────────────────────────────────────────

  private ask(text: string, airEndMs: number, now: number): ObPanelEffect[] {
    const present = this.speakers.map((s) => s.model);
    if (present.length === 0)
      return [
        {
          type: 'log',
          tone: 'dim',
          label: 'PANEL',
          text: 'host asked, but no AI panelists are seated',
        },
      ];
    const first = present.includes(this.nextFirst)
      ? this.nextFirst
      : present[0];
    const order = [first, ...present.filter((m) => m !== first)];
    this.nextFirst = order.length > 1 ? order[1] : order[0];
    const seq = ++this.askSeq;
    this.current = {
      seq,
      question: text,
      order,
      notBeforeMs: airEndMs + OB_PANEL_ANSWER_LEAD_MS,
      askedAtMs: now,
      resolved: false,
      lines: [],
      speakingModel: null,
      spokenCount: 0,
    };
    for (const s of this.speakers) s.status = 'thinking';
    const history = this.history.map((h) => ({ ...h }));
    this.pushHistory({ speaker: 'host', text });
    return [
      {
        type: 'ask',
        seq,
        question: text,
        history,
        order,
        notBeforeMs: this.current.notBeforeMs,
      },
      {
        type: 'log',
        tone: 'chalk',
        label: 'PANEL',
        text: `Q${seq} → ${order.map((m) => m.toUpperCase()).join(', ')}: “${trimForLog(text)}”`,
      },
    ];
  }

  private finish(now: number): ObPanelEffect[] {
    this.current = null;
    for (const s of this.speakers) if (s.status !== 'idle') s.status = 'idle';
    if (!this.pending) return [];
    const { text, airEndMs } = this.pending;
    this.pending = null;
    // A parked question that already aired starts as soon as the queue
    // allows; one still airing waits for its own air-end.
    return this.ask(text, Math.max(airEndMs, now), now);
  }

  private pushHistory(entry: ObPanelHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > OB_PANEL_HISTORY_MAX)
      this.history.splice(0, this.history.length - OB_PANEL_HISTORY_MAX);
  }
}

function cannedLine(model: ObPanelSpeakerId, seed: number): string {
  const lines = CANNED_LINES[model];
  return lines[Math.abs(seed * 31 + model.length) % lines.length];
}

function trimForLog(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Split a spoken line into caption-sized chunks at sentence (then word)
 * boundaries, so a long answer plays as a sequence of readable subtitles
 * paced proportionally across its TTS clip.
 */
export function panelCaptionChunks(text: string, maxChars = 90): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const sentence of sentences) {
    if ((cur + sentence).trim().length <= maxChars) {
      cur += sentence;
      continue;
    }
    push();
    if (sentence.trim().length <= maxChars) {
      cur = sentence;
      continue;
    }
    // One overlong sentence: break at words.
    for (const word of sentence.trim().split(' ')) {
      if (cur.length + 1 + word.length > maxChars) push();
      cur = cur ? `${cur} ${word}` : word;
    }
    push();
  }
  push();
  return chunks;
}
