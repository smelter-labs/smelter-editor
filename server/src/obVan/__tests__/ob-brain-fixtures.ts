/**
 * Test fixtures for the OB Van signals / rules / brain tests: hand-built
 * signal states and contexts, and a small show simulator that feeds worker
 * samples through `ObSignals` and plays the brain's decisions onto a fake
 * program bus the way the controller does (scheduled at `atAirMs`, pending
 * until then, rule holds).
 */
import type { ObPresetId, ObRuleset, ObShot } from '@smelter-editor/types';
import { obPresetRuleset } from '@smelter-editor/types';
import { createObBrain } from '../brain';
import type {
  ObBox,
  ObBrain,
  ObBrainCam,
  ObBrainContext,
  ObClock,
  ObBrainProgram,
  ObDecision,
  ObSignalState,
} from '../contracts';
import { ObSignals, makeObClock } from '../signals';

export function cam(
  number: number,
  role: ObBrainCam['role'],
  extra: Partial<ObBrainCam> = {},
): ObBrainCam {
  return {
    camId: `c${number}`,
    number,
    role,
    name: `CAM ${number}`,
    talent: null,
    live: true,
    ...extra,
  };
}

/** A fresh (audio + video) signal state at air time `T`, silent and still. */
export function sig(
  camId: string,
  T: number,
  patch: Partial<ObSignalState> = {},
): ObSignalState {
  return {
    camId,
    lastAudioAirMs: T,
    lastVideoAirMs: T,
    staleAudio: false,
    staleVideo: false,
    offline: false,
    speech: false,
    speechSinceAirMs: null,
    silenceSinceAirMs: T - 1000,
    speechShare10s: 0,
    speechProb: 0.02,
    rmsDb: -50,
    rmsEma: -50,
    lastOnsetAirMs: null,
    onsetsPerSec: 0,
    beat: { periodMs: null, phaseAirMs: null, confidence: 0 },
    motion: 0,
    motionEma: 0,
    motionSpike: false,
    burst: { active: false, sinceAirMs: null, endedAirMs: null, peak: 0 },
    people: { count: 0, largest: null, centroid: null, tracks: [] },
    ball: null,
    frame: { w: 1280, h: 720 },
    keywords: [],
    host: { active: false, trackId: null, confidence: 0, sinceAirMs: null },
    quizTurn: { active: false, sinceAirMs: null },
    ...patch,
  };
}

/** Speaking since `sinceAirMs`. */
export function talking(
  camId: string,
  T: number,
  sinceAirMs: number,
  patch: Partial<ObSignalState> = {},
): ObSignalState {
  return sig(camId, T, {
    speech: true,
    speechSinceAirMs: sinceAirMs,
    silenceSinceAirMs: null,
    speechProb: 0.95,
    speechShare10s: 0.6,
    rmsDb: -22,
    rmsEma: -24,
    ...patch,
  });
}

export function program(patch: Partial<ObBrainProgram> = {}): ObBrainProgram {
  return {
    shot: null,
    sinceAirMs: 0,
    history: [],
    pending: false,
    manualUntilAirMs: null,
    holdUntilAirMs: null,
    ...patch,
  };
}

export function context(
  patch: Partial<ObBrainContext> & { ruleset: ObRuleset },
): ObBrainContext {
  return {
    nowAir: 100_000,
    lookaheadMs: 0,
    cams: [],
    signals: {},
    program: program(),
    segment: null,
    pacingFactor: 1,
    overrides: {},
    ...patch,
  };
}

/** A ruleset with only scoring (no rules) on a preset's weights / pacing. */
export function scoringOnly(
  preset: Exclude<ObPresetId, 'custom'>,
  patch: Partial<ObRuleset> = {},
): ObRuleset {
  return { ...obPresetRuleset(preset), rules: [], ...patch };
}

export const solo = (camId: string): ObShot => ({ kind: 'solo', cam: camId });

// ── Show simulator ───────────────────────────────────────────────────────

export type AudioFrame = {
  speech?: boolean;
  speechProb?: number;
  rms?: number;
  onset?: boolean;
};
export type VideoFrame = {
  persons?: ObBox[];
  ball?: ObBox | null;
  motion?: number;
};
/** What each camera's worker reports for the media airing at `airMs`. */
export type Script = (
  camId: string,
  airMs: number,
) => { audio?: AudioFrame | null; video?: VideoFrame | null };

export type ShowEvent = { nowAir: number; decision: ObDecision };
export type AirChange = { atAirMs: number; shot: ObShot; decision: ObDecision };

export class Show {
  now: number;
  readonly lookaheadMs: number;
  readonly signals: ObSignals;
  readonly brain: ObBrain;
  prog: ObBrainProgram;
  readonly events: ShowEvent[] = [];
  readonly changes: AirChange[] = [];
  private scheduled: ObDecision | null = null;
  private readonly clock: ObClock;

  constructor(
    readonly ruleset: ObRuleset,
    readonly cams: ObBrainCam[],
    opts: { startAir?: number; lookaheadMs?: number; initial?: ObShot } = {},
  ) {
    this.now = opts.startAir ?? 1_000_000;
    this.lookaheadMs = opts.lookaheadMs ?? 3000;
    const clock = makeObClock({
      smelterStartMs: () => 0,
      registeredDelayMs: () => this.lookaheadMs,
      now: () => this.now,
    });
    this.signals = new ObSignals(clock);
    this.signals.setKeywordGroups(ruleset.keywords);
    this.brain = createObBrain(ruleset);
    this.clock = clock;
    this.prog = program(
      opts.initial
        ? {
            shot: opts.initial,
            sinceAirMs: this.now,
            history: [{ shot: opts.initial, atAirMs: this.now }],
          }
        : {},
    );
  }

  /** Feed the samples for the media airing at `airMs` (they arrive `lookaheadMs` early). */
  private feed(script: Script, airMs: number, withVideo: boolean): void {
    for (const c of this.cams) {
      const { audio, video } = script(c.camId, airMs);
      const timing = {
        ptsNanos: airMs * 1e6,
        arrivalMs: airMs - this.lookaheadMs,
        procMs: 5,
      };
      if (audio) {
        this.signals.ingest(c.camId, {
          kind: 'audio',
          ...timing,
          rms: audio.rms ?? (audio.speech ? -22 : -50),
          speechProb: audio.speechProb ?? (audio.speech ? 0.95 : 0.02),
          speech: audio.speech ?? false,
          onset: audio.onset ?? false,
        });
      }
      if (video && withVideo) {
        this.signals.ingest(c.camId, {
          kind: 'video',
          ...timing,
          frameW: 1280,
          frameH: 720,
          persons: video.persons ?? [],
          ball: video.ball ?? null,
          motion: video.motion ?? 0,
        });
      }
    }
  }

  transcript(camId: string, text: string): void {
    this.signals.ingest(camId, {
      kind: 'transcript',
      airMs: this.now,
      text,
      durationMs: 800,
    });
  }

  /** Run `ms` of show in 100 ms ticks. */
  run(
    script: Script,
    ms: number,
    ctxPatch: Partial<ObBrainContext> = {},
  ): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 100;
      this.feed(
        script,
        this.now + this.lookaheadMs,
        (this.now / 100) % 2 === 0,
      );
      this.signals.expire(this.now);
      this.land();
      const ctx: ObBrainContext = {
        nowAir: this.now,
        lookaheadMs: this.clock.lookaheadMs(),
        cams: this.cams,
        signals: this.signals.view(),
        program: this.prog,
        ruleset: this.ruleset,
        segment: null,
        pacingFactor: 1,
        overrides: {},
        ...ctxPatch,
      };
      const decision = this.brain.step(ctx);
      if (decision) this.accept(decision);
    }
  }

  private accept(decision: ObDecision): void {
    this.events.push({ nowAir: this.now, decision });
    if (decision.shot) {
      this.scheduled = decision;
      this.prog = { ...this.prog, pending: true };
      this.land();
    } else if (decision.replay && decision.holdMs > 0) {
      // Like the controller: only decisions that change the picture may
      // extend the hold gate.
      this.prog = {
        ...this.prog,
        holdUntilAirMs: decision.atAirMs + decision.holdMs,
      };
    }
  }

  private land(): void {
    const d = this.scheduled;
    if (!d?.shot || d.atAirMs > this.now) return;
    this.scheduled = null;
    this.changes.push({ atAirMs: d.atAirMs, shot: d.shot, decision: d });
    this.prog = {
      ...this.prog,
      shot: d.shot,
      sinceAirMs: d.atAirMs,
      history: [
        ...this.prog.history,
        { shot: d.shot, atAirMs: d.atAirMs },
      ].slice(-20),
      pending: false,
      holdUntilAirMs: d.atAirMs + d.holdMs,
    };
  }
}
