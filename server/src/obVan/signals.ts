/**
 * OB Van — signal aggregation. The worker (`ai-models/ob-van/worker.py`)
 * reports raw per-camera samples (audio hops at 10 Hz, video at ~5 Hz); this
 * module places them on the AIR clock and keeps, per camera, the rolling
 * state the auto pilot reads (`ObSignalState`): speech with its onset / end
 * times, the 10 s speech share, loudness, onsets with a beat estimate, motion
 * with spikes and bursts, tracked people, the ball and transcript keywords.
 *
 * Pure bookkeeping: no timers, no I/O. The controller calls `ingest()` for
 * every sample, `expire(nowAir)` once per tick and hands `view()` to the
 * brain. All state is keyed by camera id.
 */
import type { ObSignalSummary } from '@smelter-editor/types';
import { PeopleTracker } from '../ai-models/people-counter/people-tracker';
import type {
  ObAudioSample,
  ObBox,
  ObClock,
  ObSignalSample,
  ObSignalState,
  ObSignalsApi,
  ObTrackedBox,
  ObTranscriptSample,
  ObVideoSample,
} from './contracts';

// ── Air clock ────────────────────────────────────────────────────────────

/** A pts-derived air time further ahead of arrival than delay + this is bogus. */
const SKEW_AHEAD_SLACK_MS = 1000;
/** …or further behind arrival than this (a restarted pipeline / stale pts). */
const SKEW_BEHIND_MS = 5000;
/** Cameras that reported within this window vote on the lookahead. */
const LOOKAHEAD_WINDOW_MS = 5000;

export type ObClockDeps = {
  /** Wall-clock ms at which the Smelter pipeline started (`SmelterInstance.getStartTime()`). */
  smelterStartMs: () => number | null;
  /** Side-channel delay registered for the camera's input (ms). */
  registeredDelayMs: (camId: string) => number;
  now?: () => number;
  log?: (message: string) => void;
};

type WorkerTiming = { ptsNanos?: number; arrivalMs: number; procMs: number };

/**
 * The air clock. A side-channel sample's `ptsNanos` is on the Smelter queue
 * clock, whose zero is the pipeline start, and the output presents that pts
 * at `start + pts` wall time — the same rule `CaptionBridge.scheduleTranscript`
 * uses to land captions. Without a pts (simulated samples) or with a skewed
 * one, the fallback is the presentation hold RoomState applies to AI results:
 * the sample describes media that airs `registeredDelay − procMs` after it
 * arrived.
 */
export function makeObClock(deps: ObClockDeps): ObClock {
  const now = deps.now ?? Date.now;
  const leads = new Map<string, { leadMs: number; atMs: number }>();
  const warned = new Set<string>();

  const fallback = (camId: string, s: WorkerTiming): number =>
    s.arrivalMs - s.procMs + deps.registeredDelayMs(camId);

  const fromPts = (camId: string, s: WorkerTiming): number | null => {
    const start = deps.smelterStartMs();
    if (start === null || s.ptsNanos === undefined) return null;
    const airMs = start + s.ptsNanos / 1e6;
    const ahead = airMs - s.arrivalMs;
    const maxAhead = deps.registeredDelayMs(camId) + SKEW_AHEAD_SLACK_MS;
    if (ahead <= maxAhead && ahead >= -SKEW_BEHIND_MS) return airMs;
    if (!warned.has(camId)) {
      warned.add(camId);
      deps.log?.(
        `[ob-van] ${camId}: pts places samples ${Math.round(ahead)} ms from arrival — using arrival + delay instead`,
      );
    }
    return null;
  };

  return {
    airMsOf(camId, s) {
      const airMs = fromPts(camId, s) ?? fallback(camId, s);
      leads.set(camId, { leadMs: airMs - s.arrivalMs, atMs: s.arrivalMs });
      return airMs;
    },
    nowAir: () => now(),
    lookaheadMs() {
      const t = now();
      const fresh = [...leads.values()]
        .filter((l) => t - l.atMs <= LOOKAHEAD_WINDOW_MS)
        .map((l) => l.leadMs);
      return Math.max(0, Math.round(median(fresh) ?? 0));
    },
  };
}

// ── Tunables ─────────────────────────────────────────────────────────────

export const OB_SIGNAL_DEFAULTS = {
  audioStaleMs: 1500,
  videoStaleMs: 2500,
  offlineMs: 10000,
  speechShareWindowMs: 10000,
  onsetRateWindowMs: 4000,
  beatWindowMs: 8000,
  keywordWindowMs: 15000,
  ballLostMs: 2000,
  rmsEmaMs: 2000,
  motionEmaMs: 800,
  /** A spike: motion this high AND this far above its running mean. */
  spikeMin: 0.3,
  spikeJump: 0.2,
  /** A spike stays visible this long (a 5 Hz stream and a 10 Hz brain). */
  spikeHoldMs: 600,
  /** A burst starts after two samples above this motion (lower when loud). */
  burstOn: 0.45,
  burstOnLoud: 0.35,
  burstLoudDb: 4,
  burstOff: 0.2,
  burstOffMs: 800,
  /** A person track must survive this long before it counts as a NEW person. */
  newPersonMinAgeMs: 700,
  /** Track identity memory: a dropout shorter than this keeps the same id. */
  personIdentityMs: 4000,
};
export type ObSignalsOptions = Partial<typeof OB_SIGNAL_DEFAULTS>;

// ── Pure helpers (exported for tests) ────────────────────────────────────

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Exponential moving average with a time constant (irregular sampling). */
function emaStep(
  prev: number,
  value: number,
  dtMs: number,
  tauMs: number,
): number {
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return prev + alpha * (value - prev);
}

const MIN_BEAT_MS = 250;
const MAX_BEAT_MS = 2000;
const BEAT_TOLERANCE = 0.12;
const MIN_BEAT_CONFIDENCE = 0.5;

export type ObBeat = ObSignalState['beat'];

/**
 * Tempo from onset times: the median inter-onset interval, confidence = the
 * share of intervals that are one or two periods (a skipped hit is still on
 * the grid), phase anchored on the newest onset.
 */
export function estimateBeat(onsetsAirMs: number[]): ObBeat {
  const none: ObBeat = { periodMs: null, phaseAirMs: null, confidence: 0 };
  if (onsetsAirMs.length < 4) return none;
  const iois = onsetsAirMs
    .slice(1)
    .map((t, i) => t - onsetsAirMs[i])
    .filter((d) => d >= MIN_BEAT_MS && d <= MAX_BEAT_MS);
  const period = median(iois);
  if (period === null || iois.length < 3) return none;
  const onGrid = (d: number, k: number) =>
    Math.abs(d - k * period) <= BEAT_TOLERANCE * period;
  const single = iois.filter((d) => onGrid(d, 1));
  const matches = iois.filter((d) => onGrid(d, 1) || onGrid(d, 2)).length;
  const confidence = matches / iois.length;
  if (confidence < MIN_BEAT_CONFIDENCE || single.length === 0)
    return { ...none, confidence };
  const refined = single.reduce((a, b) => a + b, 0) / single.length;
  return {
    periodMs: Math.round(refined),
    phaseAirMs: onsetsAirMs[onsetsAirMs.length - 1],
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Lower-case words (letters, digits, `&`, `'`) separated by single spaces. */
export function normaliseWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&']+/gu, ' ')
    .trim();
}

/** Whole-word / whole-phrase, case-insensitive match. */
export function containsPhrase(
  normalisedText: string,
  normalisedPhrase: string,
): boolean {
  if (!normalisedPhrase) return false;
  return ` ${normalisedText} `.includes(` ${normalisedPhrase} `);
}

const center = (b: ObBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const area = (b: ObBox) => b.w * b.h;

// ── Per-camera accumulator ───────────────────────────────────────────────

function emptyState(camId: string): ObSignalState {
  return {
    camId,
    lastAudioAirMs: null,
    lastVideoAirMs: null,
    staleAudio: true,
    staleVideo: true,
    offline: false,
    speech: false,
    speechSinceAirMs: null,
    silenceSinceAirMs: null,
    speechShare10s: 0,
    speechProb: 0,
    rmsDb: -90,
    rmsEma: -90,
    lastOnsetAirMs: null,
    onsetsPerSec: 0,
    beat: { periodMs: null, phaseAirMs: null, confidence: 0 },
    motion: 0,
    motionEma: 0,
    motionSpike: false,
    burst: { active: false, sinceAirMs: null, endedAirMs: null, peak: 0 },
    people: { count: 0, largest: null, centroid: null, tracks: [] },
    ball: null,
    frame: null,
    keywords: [],
    host: { active: false, trackId: null, confidence: 0, sinceAirMs: null },
  };
}

class CamSignals {
  readonly state: ObSignalState;
  private lastAudioArrivalMs: number | null = null;
  private lastVideoArrivalMs: number | null = null;
  private firstAudioAirMs: number | null = null;
  private hops: { airMs: number; speech: boolean }[] = [];
  private onsets: number[] = [];
  private readonly tracker: PeopleTracker;
  /** Per track id: when it appeared, and whether it was announced as new. */
  private seenTracks = new Map<
    number,
    { firstSeenAirMs: number; lastSeenAirMs: number; announced: boolean }
  >();
  /** New-person events waiting for `drainNewPersons()`. */
  pendingNewPersons: { trackId: number; airMs: number }[] = [];
  private lastBall: {
    x: number;
    y: number;
    conf: number;
    airMs: number;
  } | null = null;
  private lastSpikeAirMs: number | null = null;
  private burstHighSamples = 0;
  private burstCalmSinceAirMs: number | null = null;

  constructor(
    camId: string,
    private readonly opts: typeof OB_SIGNAL_DEFAULTS,
  ) {
    this.state = emptyState(camId);
    this.tracker = new PeopleTracker({
      maxMisses: 3,
      withLead: false,
      identityMs: opts.personIdentityMs,
    });
  }

  ingestAudio(airMs: number, s: ObAudioSample): void {
    const st = this.state;
    const first = st.lastAudioAirMs === null;
    const dt = first ? 0 : airMs - (st.lastAudioAirMs ?? airMs);
    this.firstAudioAirMs ??= airMs;
    this.lastAudioArrivalMs = s.arrivalMs;
    st.lastAudioAirMs = airMs;
    st.staleAudio = false;
    st.offline = false;
    st.rmsDb = s.rms;
    st.rmsEma = first
      ? s.rms
      : emaStep(st.rmsEma, s.rms, dt, this.opts.rmsEmaMs);
    st.speechProb = s.speechProb;
    this.updateSpeech(airMs, s.speech, first);
    this.updateOnsets(airMs, s.onset);
  }

  private updateSpeech(airMs: number, speech: boolean, first: boolean): void {
    const st = this.state;
    if (first || speech !== st.speech) {
      st.speechSinceAirMs = speech ? airMs : null;
      st.silenceSinceAirMs = speech ? null : airMs;
    }
    st.speech = speech;
    this.hops.push({ airMs, speech });
    const from = airMs - this.opts.speechShareWindowMs;
    this.hops = this.hops.filter((h) => h.airMs > from);
    st.speechShare10s =
      this.hops.filter((h) => h.speech).length / this.hops.length;
  }

  private updateOnsets(airMs: number, onset: boolean): void {
    const st = this.state;
    if (onset) {
      this.onsets.push(airMs);
      st.lastOnsetAirMs = airMs;
    }
    this.onsets = this.onsets.filter((t) => t > airMs - this.opts.beatWindowMs);
    const window = this.opts.onsetRateWindowMs;
    const covered = Math.min(window, airMs - (this.firstAudioAirMs ?? airMs));
    const recent = this.onsets.filter((t) => t > airMs - window).length;
    st.onsetsPerSec = recent / (Math.max(1000, covered) / 1000);
    st.beat = estimateBeat(this.onsets);
  }

  ingestVideo(airMs: number, s: ObVideoSample): void {
    const st = this.state;
    const first = st.lastVideoAirMs === null;
    const dt = first ? 0 : airMs - (st.lastVideoAirMs ?? airMs);
    const prevEma = st.motionEma;
    this.lastVideoArrivalMs = s.arrivalMs;
    st.lastVideoAirMs = airMs;
    st.staleVideo = false;
    st.offline = false;
    st.frame = { w: s.frameW, h: s.frameH };
    st.motion = s.motion;
    st.motionEma = first
      ? s.motion
      : emaStep(prevEma, s.motion, dt, this.opts.motionEmaMs);
    const jump = s.motion - prevEma;
    if (
      !first &&
      s.motion >= this.opts.spikeMin &&
      jump >= this.opts.spikeJump
    ) {
      this.lastSpikeAirMs = airMs;
    }
    st.motionSpike =
      this.lastSpikeAirMs !== null &&
      airMs - this.lastSpikeAirMs <= this.opts.spikeHoldMs;
    this.updateBurst(airMs, s.motion);
    this.updatePeople(airMs, s.persons);
    this.updateBall(airMs, s.ball);
  }

  private updateBurst(airMs: number, motion: number): void {
    const burst = this.state.burst;
    const o = this.opts;
    if (!burst.active) {
      const loud =
        !this.state.staleAudio &&
        this.state.rmsDb >= this.state.rmsEma + o.burstLoudDb;
      const high = motion >= (loud ? o.burstOnLoud : o.burstOn);
      this.burstHighSamples = high ? this.burstHighSamples + 1 : 0;
      if (this.burstHighSamples === 1) burst.sinceAirMs = airMs;
      if (this.burstHighSamples >= 2) {
        burst.active = true;
        burst.endedAirMs = null;
        burst.peak = motion;
        this.burstCalmSinceAirMs = null;
      }
      return;
    }
    burst.peak = Math.max(burst.peak, motion);
    if (motion >= o.burstOff) {
      this.burstCalmSinceAirMs = null;
      return;
    }
    this.burstCalmSinceAirMs ??= airMs;
    if (airMs - this.burstCalmSinceAirMs >= o.burstOffMs) {
      burst.active = false;
      burst.endedAirMs = this.burstCalmSinceAirMs;
      this.burstHighSamples = 0;
    }
  }

  private updatePeople(airMs: number, persons: ObBox[]): void {
    const tracks: ObTrackedBox[] = this.tracker
      .update(persons, airMs)
      .map(({ x, y, w, h, conf, id }) =>
        conf === undefined ? { x, y, w, h, id } : { x, y, w, h, conf, id },
      );
    const largest = tracks.reduce<ObTrackedBox | null>(
      (best, t) => (!best || area(t) > area(best) ? t : best),
      null,
    );
    const centroid =
      tracks.length === 0
        ? null
        : {
            x: tracks.reduce((a, t) => a + center(t).x, 0) / tracks.length,
            y: tracks.reduce((a, t) => a + center(t).y, 0) / tracks.length,
          };
    this.state.people = { count: tracks.length, largest, centroid, tracks };
    this.updateNewPersons(airMs, tracks);
  }

  /**
   * Announce a track as a NEW person once it has survived `newPersonMinAgeMs`
   * (kills one-frame YOLO flicker). Seen ids are remembered a little longer
   * than the tracker's identity window, so a track that drops out and is
   * re-adopted under the same id is not announced twice.
   */
  private updateNewPersons(airMs: number, tracks: ObTrackedBox[]): void {
    const o = this.opts;
    for (const t of tracks) {
      const seen = this.seenTracks.get(t.id);
      if (!seen) {
        this.seenTracks.set(t.id, {
          firstSeenAirMs: airMs,
          lastSeenAirMs: airMs,
          announced: false,
        });
        continue;
      }
      seen.lastSeenAirMs = airMs;
      if (!seen.announced && airMs - seen.firstSeenAirMs >= o.newPersonMinAgeMs) {
        seen.announced = true;
        this.pendingNewPersons.push({ trackId: t.id, airMs });
      }
    }
    const forgetAfterMs = o.personIdentityMs + 2000;
    for (const [id, seen] of this.seenTracks) {
      if (airMs - seen.lastSeenAirMs > forgetAfterMs) this.seenTracks.delete(id);
    }
  }

  private updateBall(airMs: number, ball: ObBox | null): void {
    if (ball) this.lastBall = { ...center(ball), conf: ball.conf ?? 0, airMs };
    const ageMs = this.lastBall ? airMs - this.lastBall.airMs : Infinity;
    this.state.ball =
      this.lastBall && ageMs <= this.opts.ballLostMs
        ? {
            x: this.lastBall.x,
            y: this.lastBall.y,
            conf: this.lastBall.conf,
            ageMs,
          }
        : null;
  }

  addKeywords(hits: { word: string; group: string; airMs: number }[]): void {
    this.state.keywords.push(...hits);
  }

  expire(nowMs: number): void {
    const st = this.state;
    const o = this.opts;
    st.staleAudio =
      this.lastAudioArrivalMs === null ||
      nowMs - this.lastAudioArrivalMs > o.audioStaleMs;
    st.staleVideo =
      this.lastVideoArrivalMs === null ||
      nowMs - this.lastVideoArrivalMs > o.videoStaleMs;
    const lastArrival = Math.max(
      this.lastAudioArrivalMs ?? -Infinity,
      this.lastVideoArrivalMs ?? -Infinity,
    );
    st.offline =
      lastArrival !== -Infinity && nowMs - lastArrival >= o.offlineMs;
    st.keywords = st.keywords.filter(
      (k) => k.airMs > nowMs - o.keywordWindowMs,
    );
  }

  snapshot(): ObSignalState {
    const st = this.state;
    return {
      ...st,
      beat: { ...st.beat },
      burst: { ...st.burst },
      people: {
        ...st.people,
        largest: st.people.largest ? { ...st.people.largest } : null,
        centroid: st.people.centroid ? { ...st.people.centroid } : null,
        tracks: st.people.tracks.map((t) => ({ ...t })),
      },
      ball: st.ball ? { ...st.ball } : null,
      frame: st.frame ? { ...st.frame } : null,
      keywords: st.keywords.map((k) => ({ ...k })),
      host: { ...st.host },
    };
  }

  summary(): ObSignalSummary {
    const st = this.state;
    const audio = !st.staleAudio;
    const video = !st.staleVideo;
    return {
      speech: audio && st.speech,
      speechProb: audio ? st.speechProb : 0,
      rmsDb: audio ? st.rmsDb : -90,
      onset:
        audio &&
        st.lastOnsetAirMs !== null &&
        st.lastAudioAirMs !== null &&
        st.lastAudioAirMs - st.lastOnsetAirMs <= SUMMARY_ONSET_MS,
      motion: video ? st.motion : 0,
      people: video ? st.people.count : 0,
      ball: video && st.ball !== null,
      host: st.host.active,
      stale: !audio && !video,
    };
  }
}

/** An onset is shown in the UI summary this long after it aired. */
const SUMMARY_ONSET_MS = 300;

// ── Aggregator ───────────────────────────────────────────────────────────

export class ObSignals implements ObSignalsApi {
  private readonly cams = new Map<string, CamSignals>();
  private readonly opts: typeof OB_SIGNAL_DEFAULTS;
  private keywordGroups: { group: string; phrase: string; word: string }[] = [];

  constructor(
    private readonly clock: ObClock,
    opts: ObSignalsOptions = {},
  ) {
    this.opts = { ...OB_SIGNAL_DEFAULTS, ...opts };
  }

  ingest(camId: string, sample: ObSignalSample): void {
    const cam = this.cam(camId);
    switch (sample.kind) {
      case 'audio':
        cam.ingestAudio(this.clock.airMsOf(camId, sample), sample);
        return;
      case 'video':
        cam.ingestVideo(this.clock.airMsOf(camId, sample), sample);
        return;
      case 'transcript':
        cam.addKeywords(this.matchKeywords(sample));
        return;
    }
  }

  expire(nowAirMs: number): void {
    for (const cam of this.cams.values()) cam.expire(nowAirMs);
  }

  view(): Record<string, ObSignalState> {
    const out: Record<string, ObSignalState> = {};
    for (const [camId, cam] of this.cams) out[camId] = cam.snapshot();
    return out;
  }

  summary(): Record<string, ObSignalSummary> {
    const out: Record<string, ObSignalSummary> = {};
    for (const [camId, cam] of this.cams) out[camId] = cam.summary();
    return out;
  }

  setKeywordGroups(groups: Record<string, string[]> | undefined): void {
    this.keywordGroups = Object.entries(groups ?? {}).flatMap(
      ([group, words]) =>
        words
          .map((word) => ({ group, word, phrase: normaliseWords(word) }))
          .filter((k) => k.phrase.length > 0),
    );
  }

  setHost(
    camId: string | null,
    info?: { trackId: number | null; confidence: number },
  ): void {
    for (const [id, cam] of this.cams) {
      const host = cam.state.host;
      if (camId !== null && id === camId) {
        host.sinceAirMs = host.active ? host.sinceAirMs : this.clock.nowAir();
        host.active = true;
        host.trackId = info?.trackId ?? null;
        host.confidence = info?.confidence ?? host.confidence;
      } else if (host.active) {
        cam.state.host = {
          active: false,
          trackId: null,
          confidence: 0,
          sinceAirMs: null,
        };
      }
    }
  }

  drainNewPersons(): { camId: string; trackId: number; airMs: number }[] {
    const out: { camId: string; trackId: number; airMs: number }[] = [];
    for (const [camId, cam] of this.cams) {
      for (const p of cam.pendingNewPersons) out.push({ camId, ...p });
      cam.pendingNewPersons = [];
    }
    return out;
  }

  removeCam(camId: string): void {
    this.cams.delete(camId);
  }

  reset(): void {
    this.cams.clear();
  }

  private cam(camId: string): CamSignals {
    let cam = this.cams.get(camId);
    if (!cam) {
      cam = new CamSignals(camId, this.opts);
      this.cams.set(camId, cam);
    }
    return cam;
  }

  /** Keyword hits of a caption line, stamped with the air time it finished. */
  private matchKeywords(
    sample: ObTranscriptSample,
  ): { word: string; group: string; airMs: number }[] {
    const text = normaliseWords(sample.text);
    const airMs = sample.airMs + Math.max(0, sample.durationMs);
    return this.keywordGroups
      .filter((k) => containsPhrase(text, k.phrase))
      .map((k) => ({ word: k.word, group: k.group, airMs }));
  }
}
