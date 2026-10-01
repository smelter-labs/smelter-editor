// OB Van — the four built-in director presets, written in the rules DSL
// (`ObRuleset`). Shared by the server (auto pilot) and the editor (preset
// cards, rules editor). `obPresetRuleset()` returns a deep copy.

import type { ObPresetId, ObRuleset } from "./ob-van-events.js";

const TALK: ObRuleset = {
  id: "preset-talk",
  name: "TALK · conference / panel",
  preset: "talk",
  pacing: {
    minHoldMs: 2500,
    maxHoldMs: 20000,
    transition: "cut",
    anticipateMs: 200,
  },
  weights: {
    speech: 1.6,
    motion: 0.2,
    people: 0.3,
    ball: 0,
    novelty: 0.4,
    stay: 0.5,
    roleBias: {
      speaker: 0.3,
      guest: 0.2,
      wide: 0.1,
      audience: -0.3,
      slides: -0.4,
      tape: -0.6,
    },
  },
  behaviours: { dialogueSplit: true, anticipate: true },
  keywords: {
    slides: [
      "slide",
      "next slide",
      "as you can see",
      "chart",
      "diagram",
      "on the screen",
    ],
    audience: ["question", "questions", "q and a", "q&a", "applause"],
    tape: [
      "roll the tape",
      "go to the tape",
      "the tape",
      "roll it",
      "highlights",
    ],
  },
  rules: [
    {
      id: "tape-kw",
      name: "Roll the tape",
      priority: 85,
      cooldownMs: 20000,
      holdMs: 9000,
      when: { signal: "keyword", op: "has", value: "tape" },
      then: {
        shot: { kind: "solo", cam: "tape" },
        transition: { type: "cut" },
      },
    },
    {
      id: "slides-kw",
      name: "Slides when they mention them",
      priority: 80,
      cooldownMs: 15000,
      holdMs: 8000,
      when: {
        all: [
          { signal: "keyword", op: "has", value: "slides" },
          { signal: "speech", cam: "any" },
        ],
      },
      then: {
        shot: { kind: "speaker-slides", speaker: "trigger", slides: "slides" },
        transition: { type: "cut" },
      },
    },
    {
      id: "dialogue",
      name: "Split on a back-and-forth",
      priority: 60,
      cooldownMs: 10000,
      holdMs: 6000,
      when: { signal: "dialogue", op: "==", value: true },
      then: {
        shot: { kind: "split", cams: ["program", "trigger"] },
        transition: { type: "dissolve", durationMs: 300 },
      },
    },
    {
      id: "lt-new-voice",
      name: "Lower third on a new voice",
      priority: 50,
      cooldownMs: 45000,
      when: {
        all: [
          { signal: "speech", cam: "not-program", forMs: 1500 },
          { signal: "hold", op: ">", value: 2500 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "trigger" },
        lowerThird: { cam: "trigger", mode: "talent", holdMs: 5000 },
      },
    },
    {
      id: "qa-audience",
      name: "Audience on Q&A",
      priority: 40,
      cooldownMs: 30000,
      holdMs: 5000,
      when: { signal: "keyword", op: "has", value: "audience" },
      then: {
        shot: { kind: "solo", cam: "audience" },
        transition: { type: "dissolve", durationMs: 400 },
      },
    },
    {
      id: "silence-wide",
      name: "Wide on a long silence",
      priority: 10,
      cooldownMs: 20000,
      when: { signal: "silence", forMs: 6000 },
      then: {
        shot: { kind: "solo", cam: "wide" },
        transition: { type: "dissolve", durationMs: 600 },
      },
    },
  ],
};

const MATCH: ObRuleset = {
  id: "preset-match",
  name: "MATCH · sport",
  preset: "match",
  pacing: { minHoldMs: 1500, maxHoldMs: 12000, transition: "cut" },
  weights: {
    speech: 0,
    motion: 1.2,
    people: 0.4,
    ball: 1.8,
    novelty: 0.2,
    stay: 0.8,
    roleBias: { wide: 0.4, audience: -0.4 },
  },
  behaviours: { burstReplay: true },
  rules: [
    {
      id: "burst-replay",
      name: "Replay after a burst",
      priority: 90,
      cooldownMs: 40000,
      holdMs: 5000,
      when: {
        all: [
          { signal: "burst", cam: "any" },
          {
            signal: "motion",
            cam: "trigger",
            op: "<",
            value: 0.15,
            forMs: 1500,
          },
        ],
      },
      then: {
        replay: { cam: "trigger", beforeMs: 4000, afterMs: 1000 },
        transition: { type: "wipe", durationMs: 300 },
      },
    },
    {
      id: "goal-left",
      name: "Goal cam left on a scramble",
      priority: 75,
      cooldownMs: 8000,
      holdMs: 3000,
      when: {
        all: [
          { signal: "motionSpike", cam: "goal-left" },
          { signal: "people", cam: "goal-left", op: ">=", value: 3 },
        ],
      },
      then: { shot: { kind: "solo", cam: "goal-left" } },
    },
    {
      id: "goal-right",
      name: "Goal cam right on a scramble",
      priority: 75,
      cooldownMs: 8000,
      holdMs: 3000,
      when: {
        all: [
          { signal: "motionSpike", cam: "goal-right" },
          { signal: "people", cam: "goal-right", op: ">=", value: 3 },
        ],
      },
      then: { shot: { kind: "solo", cam: "goal-right" } },
    },
    {
      id: "follow-ball",
      name: "Virtual camera follows the ball",
      priority: 70,
      when: {
        all: [
          { signal: "ball", cam: "wide" },
          { signal: "ballAge", cam: "wide", op: "<", value: 1500 },
        ],
      },
      then: {
        shot: { kind: "virtual", cam: "wide", target: "ball", zoom: "normal" },
      },
    },
    {
      id: "lost-wide",
      name: "Wide when the ball is lost",
      priority: 20,
      cooldownMs: 5000,
      when: { signal: "ballAge", cam: "wide", op: ">", value: 2000 },
      then: {
        shot: { kind: "solo", cam: "wide" },
        transition: { type: "dissolve", durationMs: 500 },
      },
    },
  ],
};

const STAGE: ObRuleset = {
  id: "preset-stage",
  name: "STAGE · theatre",
  preset: "stage",
  pacing: {
    minHoldMs: 6000,
    maxHoldMs: 45000,
    transition: "dissolve",
    transitionMs: 900,
  },
  weights: {
    speech: 1.2,
    motion: 0.5,
    people: 0.3,
    ball: 0,
    novelty: 0.1,
    stay: 1.2,
    roleBias: { wide: 0.3, audience: -0.5 },
  },
  behaviours: { monologueLock: true },
  rules: [
    {
      id: "monologue-zoom",
      name: "Push in on the speaking actor",
      priority: 60,
      cooldownMs: 15000,
      holdMs: 8000,
      when: { signal: "speech", cam: "wide", forMs: 4000 },
      then: {
        shot: {
          kind: "virtual",
          cam: "wide",
          target: "speaker",
          zoom: "tight",
        },
        effects: { spotlight: true },
        transition: { type: "dissolve", durationMs: 1200 },
      },
    },
    {
      id: "entrance-left",
      name: "Entrance stage left",
      priority: 50,
      cooldownMs: 20000,
      holdMs: 5000,
      when: {
        all: [
          { signal: "motionSpike", cam: "stage-left" },
          { signal: "people", cam: "stage-left", op: ">=", value: 1 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "stage-left" },
        transition: { type: "dissolve", durationMs: 900 },
      },
    },
    {
      id: "entrance-right",
      name: "Entrance stage right",
      priority: 50,
      cooldownMs: 20000,
      holdMs: 5000,
      when: {
        all: [
          { signal: "motionSpike", cam: "stage-right" },
          { signal: "people", cam: "stage-right", op: ">=", value: 1 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "stage-right" },
        transition: { type: "dissolve", durationMs: 900 },
      },
    },
    {
      id: "ensemble-wide",
      name: "Wide on the ensemble",
      priority: 40,
      cooldownMs: 20000,
      when: { signal: "people", cam: "wide", op: ">=", value: 4, forMs: 3000 },
      then: {
        shot: { kind: "solo", cam: "wide" },
        effects: { spotlight: false },
      },
    },
    {
      id: "silence-wide",
      name: "Wide in the silence",
      priority: 10,
      cooldownMs: 30000,
      when: { signal: "silence", forMs: 10000 },
      then: {
        shot: { kind: "solo", cam: "wide" },
        effects: { spotlight: false },
        transition: { type: "dissolve", durationMs: 1500 },
      },
    },
  ],
};

const GIG: ObRuleset = {
  id: "preset-gig",
  name: "GIG · concert",
  preset: "gig",
  pacing: {
    minHoldMs: 1200,
    maxHoldMs: 8000,
    transition: "cut",
    anticipateMs: 80,
  },
  weights: {
    speech: 0.2,
    motion: 1,
    people: 0.5,
    ball: 0,
    novelty: 0.9,
    stay: 0.2,
    roleBias: { wide: 0.2, audience: 0.3 },
  },
  behaviours: { onsetCuts: true },
  rules: [
    {
      id: "loud-wide",
      name: "Wide and neon on the loud parts",
      priority: 70,
      cooldownMs: 6000,
      holdMs: 4000,
      when: {
        all: [
          { signal: "rms", cam: "any", op: ">", value: -14, forMs: 1500 },
          { signal: "onsetsPerSec", cam: "trigger", op: ">", value: 2 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "wide" },
        effects: { grade: "neon" },
      },
    },
    {
      id: "beat-cut",
      name: "Cut on the beat",
      priority: 50,
      when: {
        all: [
          { signal: "onset", cam: "any" },
          { signal: "hold", op: ">", value: 1200 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "not-program" },
        transition: { type: "cut" },
      },
    },
    {
      id: "crowd",
      name: "Punch to the crowd",
      priority: 30,
      cooldownMs: 25000,
      holdMs: 2500,
      when: { signal: "motion", cam: "audience", op: ">", value: 0.3 },
      then: {
        shot: { kind: "solo", cam: "audience" },
        transition: { type: "zoom-punch", durationMs: 200 },
      },
    },
    {
      id: "quiet",
      name: "Slow down in the quiet parts",
      priority: 10,
      cooldownMs: 10000,
      when: { signal: "rms", cam: "any", op: "<", value: -35, forMs: 4000 },
      then: {
        pacing: { minHoldMs: 4000, transition: "dissolve", transitionMs: 800 },
        effects: { grade: "none" },
      },
    },
  ],
};

const FOLLOW: ObRuleset = {
  id: "preset-follow",
  name: "FOLLOW · host cam",
  preset: "follow",
  pacing: { minHoldMs: 2000, maxHoldMs: 60000, transition: "cut" },
  weights: {
    speech: 1,
    motion: 0.6,
    people: 0.3,
    ball: 0,
    novelty: 0.3,
    stay: 0.6,
  },
  // Deterministic demo: no locks / splits — the three rules below carry it.
  behaviours: {},
  rules: [
    {
      id: "host-follow",
      name: "Follow the host",
      priority: 90,
      cooldownMs: 2000,
      holdMs: 4000,
      when: { signal: "host", cam: "any", op: "==", value: true },
      then: {
        shot: { kind: "solo", cam: "trigger" },
        transition: { type: "cut" },
      },
    },
    {
      // `any`, not `not-program`: the default grid counts EVERY camera as
      // on-program, so a not-program selector would never find the spike.
      id: "spike-solo",
      name: "Something happening",
      priority: 45,
      cooldownMs: 12000,
      holdMs: 5000,
      when: {
        all: [
          { signal: "motionSpike", cam: "any" },
          { signal: "people", cam: "trigger", op: ">=", value: 1 },
        ],
      },
      then: {
        shot: { kind: "solo", cam: "trigger" },
        transition: { type: "cut" },
      },
    },
    {
      id: "burst-solo",
      name: "Stay on a burst",
      priority: 44,
      cooldownMs: 15000,
      holdMs: 6000,
      when: {
        all: [
          { signal: "burst", cam: "any" },
          { signal: "people", cam: "trigger", op: ">=", value: 1 },
        ],
      },
      then: { shot: { kind: "solo", cam: "trigger" } },
    },
    {
      // `hold >= 0` is reliably true (holdMs is Infinity with no program
      // shot), so with no host and no action this keeps the grid on air and
      // its `held` result blocks score-based cuts. Requires audio mix: an
      // empty grid resolves to no on-air cams, so `follow` would mute all.
      id: "default-grid",
      name: "Grid when nothing stands out",
      priority: 10,
      cooldownMs: 3000,
      holdMs: 4000,
      when: { signal: "hold", op: ">=", value: 0 },
      then: {
        shot: { kind: "grid", cams: [] },
        transition: { type: "dissolve", durationMs: 300 },
      },
    },
  ],
};

export const OB_PRESET_RULESETS: Readonly<
  Record<Exclude<ObPresetId, "custom">, ObRuleset>
> = { talk: TALK, match: MATCH, stage: STAGE, gig: GIG, follow: FOLLOW };

export type ObPresetMeta = {
  id: Exclude<ObPresetId, "custom">;
  label: string;
  sub: string;
  blurb: string;
};
export const OB_PRESET_META: readonly ObPresetMeta[] = [
  {
    id: "talk",
    label: "TALK",
    sub: "conference · panel",
    blurb:
      "Cuts to whoever speaks, splits a dialogue, slides on cue, lower thirds.",
  },
  {
    id: "match",
    label: "MATCH",
    sub: "sport",
    blurb: "Virtual camera follows the ball, goal cams on scrambles, replays.",
  },
  {
    id: "stage",
    label: "STAGE",
    sub: "theatre · culture",
    blurb:
      "Slow dissolves, never cuts a monologue, pushes in with a spotlight.",
  },
  {
    id: "gig",
    label: "GIG",
    sub: "concert",
    blurb: "Cuts on the beat, wide and neon on the loud parts, crowd punches.",
  },
  {
    id: "follow",
    label: "FOLLOW",
    sub: "host · 4 cams",
    blurb:
      "Grid of everything, solo on action; the AI recognises the host and follows, gestures drive effects.",
  },
];

/** Deep copy of a preset's ruleset (`custom` falls back to TALK). */
export function obPresetRuleset(id: ObPresetId): ObRuleset {
  const base = id === "custom" ? TALK : OB_PRESET_RULESETS[id];
  return JSON.parse(JSON.stringify(base)) as ObRuleset;
}
