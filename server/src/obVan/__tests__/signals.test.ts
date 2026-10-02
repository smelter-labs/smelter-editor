import { describe, expect, it } from 'vitest';
import type { ObAudioSample, ObVideoSample } from '../contracts';
import {
  ObSignals,
  containsPhrase,
  estimateBeat,
  makeObClock,
  normaliseWords,
} from '../signals';

const START = 1_700_000_000_000;
const DELAY = 3000;

function fakeClock(start: number | null = START) {
  const t = { now: START + 60_000 };
  const clock = makeObClock({
    smelterStartMs: () => start,
    registeredDelayMs: () => DELAY,
    now: () => t.now,
  });
  return { t, clock };
}

/** An audio hop describing media at pts (ms since pipeline start), arriving DELAY early. */
function audio(
  ptsMs: number,
  patch: Partial<ObAudioSample> = {},
): ObAudioSample {
  return {
    kind: 'audio',
    ptsNanos: ptsMs * 1e6,
    arrivalMs: START + ptsMs - DELAY,
    procMs: 3,
    rms: -30,
    speechProb: 0.02,
    speech: false,
    onset: false,
    ...patch,
  };
}

function video(
  ptsMs: number,
  patch: Partial<ObVideoSample> = {},
): ObVideoSample {
  return {
    kind: 'video',
    ptsNanos: ptsMs * 1e6,
    arrivalMs: START + ptsMs - DELAY,
    procMs: 40,
    frameW: 1280,
    frameH: 720,
    persons: [],
    ball: null,
    motion: 0,
    ...patch,
  };
}

describe('air clock', () => {
  it('airMsOf = pipeline start + pts', () => {
    const { clock } = fakeClock();
    expect(
      clock.airMsOf('c1', {
        ptsNanos: 61_500 * 1e6,
        arrivalMs: START + 58_600,
        procMs: 12,
      }),
    ).toBe(START + 61_500);
  });

  it('falls back to arrival − procMs + registered delay without pts', () => {
    const { clock } = fakeClock();
    expect(clock.airMsOf('c1', { arrivalMs: 5000, procMs: 200 })).toBe(
      5000 - 200 + DELAY,
    );
  });

  it('falls back when the pipeline has not started', () => {
    const { clock } = fakeClock(null);
    expect(
      clock.airMsOf('c1', { ptsNanos: 1e9, arrivalMs: 5000, procMs: 0 }),
    ).toBe(8000);
  });

  it('skew guard: pts far outside [−5 s, delay + 1 s] of arrival uses the fallback and logs once', () => {
    const logs: string[] = [];
    const clock = makeObClock({
      smelterStartMs: () => START,
      registeredDelayMs: () => DELAY,
      log: (m) => logs.push(m),
    });
    const arrival = START + 10_000;
    expect(
      clock.airMsOf('c1', {
        ptsNanos: 30_000 * 1e6,
        arrivalMs: arrival,
        procMs: 0,
      }),
    ).toBe(arrival + DELAY);
    expect(
      clock.airMsOf('c1', {
        ptsNanos: 1_000 * 1e6,
        arrivalMs: arrival,
        procMs: 0,
      }),
    ).toBe(arrival + DELAY);
    expect(logs).toHaveLength(1);
    expect(
      clock.airMsOf('c1', {
        ptsNanos: 12_900 * 1e6,
        arrivalMs: arrival,
        procMs: 0,
      }),
    ).toBe(START + 12_900);
  });

  it('audio and video with equal pts land on the same air time', () => {
    const { clock } = fakeClock();
    const a = clock.airMsOf('c1', {
      ptsNanos: 70_000 * 1e6,
      arrivalMs: START + 67_010,
      procMs: 4,
    });
    const v = clock.airMsOf('c1', {
      ptsNanos: 70_000 * 1e6,
      arrivalMs: START + 67_200,
      procMs: 180,
    });
    expect(a).toBe(v);
  });

  it('lookahead = median lead of the cameras that reported recently', () => {
    const { t, clock } = fakeClock();
    clock.airMsOf('c1', {
      ptsNanos: 62_900 * 1e6,
      arrivalMs: START + 60_000,
      procMs: 0,
    });
    clock.airMsOf('c2', {
      ptsNanos: 62_950 * 1e6,
      arrivalMs: START + 60_000,
      procMs: 0,
    });
    clock.airMsOf('c3', {
      ptsNanos: 63_000 * 1e6,
      arrivalMs: START + 60_000,
      procMs: 0,
    });
    expect(clock.lookaheadMs()).toBe(2950);
    expect(clock.nowAir()).toBe(t.now);
    t.now += 6000;
    expect(clock.lookaheadMs()).toBe(0);
  });
});

describe('ObSignals', () => {
  it('tracks speech on / off times and the 10 s speech share', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    // 20 s of 1 s speech / 1 s silence at 10 Hz.
    for (let i = 0; i < 200; i++) {
      const speech = Math.floor(i / 10) % 2 === 1;
      s.ingest(
        'c1',
        audio(60_000 + i * 100, { speech, speechProb: speech ? 0.9 : 0.05 }),
      );
    }
    const st = s.view().c1;
    expect(st.speechShare10s).toBeGreaterThan(0.45);
    expect(st.speechShare10s).toBeLessThan(0.55);
    expect(st.speech).toBe(true);
    expect(st.speechSinceAirMs).toBe(START + 60_000 + 190 * 100);
    expect(st.silenceSinceAirMs).toBeNull();
    expect(st.lastAudioAirMs).toBe(START + 60_000 + 199 * 100);
  });

  it('onsets → onsetsPerSec and a beat estimate', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    for (let i = 0; i < 80; i++)
      s.ingest('c1', audio(60_000 + i * 100, { onset: i % 5 === 0 }));
    const st = s.view().c1;
    expect(st.onsetsPerSec).toBeCloseTo(2, 1);
    expect(st.beat.periodMs).toBe(500);
    expect(st.beat.phaseAirMs).toBe(START + 60_000 + 75 * 100);
    expect(st.beat.confidence).toBe(1);
    expect(st.lastOnsetAirMs).toBe(START + 60_000 + 7500);
  });

  it('beat estimate tolerates a missed hit and rejects noise', () => {
    expect(estimateBeat([0, 500, 1000, 2000, 2500, 3000]).periodMs).toBe(500);
    expect(
      estimateBeat([0, 310, 1200, 1500, 2900, 3000, 4400]).periodMs,
    ).toBeNull();
    expect(estimateBeat([0, 500]).periodMs).toBeNull();
  });

  it('stale audio after 1.5 s, stale video after 2.5 s, offline after 10 s', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest('c1', audio(60_000));
    s.ingest('c1', video(60_000));
    const arrival = START + 60_000 - DELAY;
    s.expire(arrival + 1400);
    expect(s.view().c1).toMatchObject({
      staleAudio: false,
      staleVideo: false,
      offline: false,
    });
    s.expire(arrival + 1600);
    expect(s.view().c1).toMatchObject({
      staleAudio: true,
      staleVideo: false,
      offline: false,
    });
    s.expire(arrival + 2600);
    expect(s.view().c1).toMatchObject({
      staleAudio: true,
      staleVideo: true,
      offline: false,
    });
    expect(s.summary().c1.stale).toBe(true);
    s.expire(arrival + 10_000);
    expect(s.view().c1.offline).toBe(true);
    s.ingest('c1', audio(80_000));
    expect(s.view().c1).toMatchObject({ staleAudio: false, offline: false });
  });

  it('keeps stable person ids across frames and reports largest / centroid', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    const ids: number[][] = [];
    for (let i = 0; i < 10; i++) {
      s.ingest(
        'c1',
        video(60_000 + i * 200, {
          persons: [
            { x: 0.1 + i * 0.005, y: 0.2, w: 0.1, h: 0.3, conf: 0.9 },
            { x: 0.6, y: 0.3, w: 0.2, h: 0.5, conf: 0.8 },
          ],
        }),
      );
      ids.push(
        s
          .view()
          .c1.people.tracks.map((t) => t.id)
          .sort(),
      );
    }
    expect(new Set(ids.map((x) => x.join())).size).toBe(1);
    const people = s.view().c1.people;
    expect(people.count).toBe(2);
    expect(people.largest).toMatchObject({ x: 0.6, w: 0.2 });
    expect(people.centroid?.x).toBeCloseTo((0.195 + 0.7) / 2, 5);
  });

  it('ball: age grows until it is lost after 2 s', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest(
      'c1',
      video(60_000, { ball: { x: 0.5, y: 0.5, w: 0.02, h: 0.04, conf: 0.7 } }),
    );
    expect(s.view().c1.ball).toMatchObject({
      x: 0.51,
      y: 0.52,
      conf: 0.7,
      ageMs: 0,
    });
    s.ingest('c1', video(61_500));
    expect(s.view().c1.ball?.ageMs).toBe(1500);
    s.ingest('c1', video(62_100));
    expect(s.view().c1.ball).toBeNull();
  });

  it('motion spike stays up briefly; a burst starts, then ends after a calm', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    for (let i = 0; i < 5; i++)
      s.ingest('c1', video(60_000 + i * 200, { motion: 0.05 }));
    s.ingest('c1', video(61_000, { motion: 0.6 }));
    expect(s.view().c1.motionSpike).toBe(true);
    s.ingest('c1', video(61_200, { motion: 0.6 }));
    const burst = s.view().c1.burst;
    expect(burst.active).toBe(true);
    expect(burst.sinceAirMs).toBe(START + 61_000);
    s.ingest('c1', video(61_900, { motion: 0.4 })); // still busy, no new jump, > 600 ms after the last spike
    expect(s.view().c1.motionSpike).toBe(false);
    for (let i = 1; i <= 6; i++)
      s.ingest('c1', video(61_900 + i * 200, { motion: 0.05 }));
    const ended = s.view().c1.burst;
    expect(ended.active).toBe(false);
    expect(ended.endedAirMs).toBe(START + 62_100);
    expect(ended.peak).toBe(0.6);
  });

  it('matches keywords as whole words / phrases, case-insensitive, and forgets them after 15 s', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.setKeywordGroups({
      slides: ['slide', 'as you can see'],
      audience: ['q&a'],
    });
    s.ingest('c1', {
      kind: 'transcript',
      airMs: START + 60_000,
      text: 'Sliders are fun. As you can SEE, next slide!',
      durationMs: 2000,
    });
    s.ingest('c2', {
      kind: 'transcript',
      airMs: START + 60_000,
      text: 'Time for Q&A',
      durationMs: 1000,
    });
    s.ingest('c3', {
      kind: 'transcript',
      airMs: START + 60_000,
      text: 'a landslide',
      durationMs: 1000,
    });
    const v = s.view();
    expect(v.c1.keywords.map((k) => k.word).sort()).toEqual([
      'as you can see',
      'slide',
    ]);
    expect(v.c1.keywords[0]).toMatchObject({
      group: 'slides',
      airMs: START + 62_000,
    });
    expect(v.c2.keywords.map((k) => k.group)).toEqual(['audience']);
    expect(v.c3.keywords).toEqual([]);
    s.expire(START + 62_000 + 15_001);
    expect(s.view().c1.keywords).toEqual([]);
  });

  it('whole-word helpers', () => {
    expect(
      containsPhrase(
        normaliseWords('Next-slide, please'),
        normaliseWords('next slide'),
      ),
    ).toBe(true);
    expect(containsPhrase(normaliseWords('slideshow'), 'slide')).toBe(false);
  });

  it('summary reflects fresh streams only; removeCam / reset forget cameras', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest(
      'c1',
      audio(60_000, { speech: true, speechProb: 0.9, onset: true, rms: -20 }),
    );
    s.ingest(
      'c1',
      video(60_000, { motion: 0.4, persons: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] }),
    );
    expect(s.summary().c1).toEqual({
      speech: true,
      speechProb: 0.9,
      rmsDb: -20,
      onset: true,
      motion: 0.4,
      people: 1,
      ball: false,
      host: false,
      stale: false,
    });
    s.expire(START + 60_000 - DELAY + 2000);
    expect(s.summary().c1).toMatchObject({
      speech: false,
      rmsDb: -90,
      motion: 0.4,
    });
    s.ingest('c2', audio(60_000));
    s.removeCam('c1');
    expect(Object.keys(s.view())).toEqual(['c2']);
    s.reset();
    expect(s.view()).toEqual({});
  });

  it('view() returns copies the caller cannot corrupt', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest(
      'c1',
      video(60_000, { persons: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] }),
    );
    const v = s.view();
    v.c1.people.tracks.pop();
    v.c1.burst.active = true;
    expect(s.view().c1.people.tracks).toHaveLength(1);
    expect(s.view().c1.burst.active).toBe(false);
  });
});

describe('new persons & host', () => {
  const person = { x: 0.4, y: 0.2, w: 0.2, h: 0.6 };

  /** Video samples every 200 ms (5 Hz) from `fromMs`, with/without the person. */
  function feed(
    s: ObSignals,
    camId: string,
    fromMs: number,
    present: boolean[],
  ) {
    present.forEach((p, i) => {
      s.ingest(camId, video(fromMs + i * 200, { persons: p ? [person] : [] }));
    });
  }

  it('announces a track once it survives the debounce, exactly once', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    feed(s, 'c1', 60_000, [true, true, true]); // 400 ms old — too young
    expect(s.drainNewPersons()).toEqual([]);
    feed(s, 'c1', 60_600, [true, true]); // now ≥ 700 ms old
    const events = s.drainNewPersons();
    expect(events).toHaveLength(1);
    expect(events[0].camId).toBe('c1');
    expect(events[0].airMs).toBe(START + 60_800);
    // Drained; the same track never announces again.
    feed(s, 'c1', 61_000, [true, true, true]);
    expect(s.drainNewPersons()).toEqual([]);
  });

  it('a one-frame YOLO flicker never announces', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    // Detected once, then coasts for maxMisses (3) samples and hides at
    // 600 ms of age — under the 700 ms debounce.
    feed(s, 'c1', 60_000, [true, false, false, false, false, false]);
    expect(s.drainNewPersons()).toEqual([]);
  });

  it('identity across a short dropout: no second announcement', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    feed(s, 'c1', 60_000, [true, true, true, true, true]);
    expect(s.drainNewPersons()).toHaveLength(1);
    // Gone for 1.4 s (coasting + identity memory), then back nearby.
    feed(s, 'c1', 61_000, [false, false, false, false, false, false, false]);
    feed(s, 'c1', 62_400, [true, true, true, true, true, true]);
    expect(s.drainNewPersons()).toEqual([]);
  });

  it('setHost marks one camera, moves and clears', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest('c1', video(60_000));
    s.ingest('c2', video(60_000));
    s.setHost('c1', { trackId: 5, confidence: 0.9 });
    expect(s.view().c1.host).toMatchObject({
      active: true,
      trackId: 5,
      confidence: 0.9,
    });
    expect(s.view().c1.host.sinceAirMs).not.toBeNull();
    expect(s.summary().c1.host).toBe(true);
    expect(s.summary().c2.host).toBe(false);
    s.setHost('c2', { trackId: 2, confidence: 0.7 });
    expect(s.view().c1.host.active).toBe(false);
    expect(s.view().c2.host.active).toBe(true);
    s.setHost(null);
    expect(s.view().c2.host).toEqual({
      active: false,
      trackId: null,
      confidence: 0,
      sinceAirMs: null,
    });
  });

  it('setQuizTurn mirrors setHost: exclusive, moves, clears, creates the slot', () => {
    const { clock } = fakeClock();
    const s = new ObSignals(clock);
    s.ingest('c1', video(60_000));
    // c2 has never reported (OB_SIM case) — the slot must still be created.
    s.setQuizTurn('c2');
    expect(s.view().c2.quizTurn.active).toBe(true);
    expect(s.view().c2.quizTurn.sinceAirMs).not.toBeNull();
    expect(s.view().c1.quizTurn.active).toBe(false);
    s.setQuizTurn('c1');
    expect(s.view().c2.quizTurn.active).toBe(false);
    expect(s.view().c1.quizTurn.active).toBe(true);
    s.setQuizTurn(null);
    expect(s.view().c1.quizTurn).toEqual({ active: false, sinceAirMs: null });
  });
});
