import React from 'react';
import { Composition } from 'remotion';
import {
  CashOutCameo,
  HostSlate,
  Intro,
  MeetCast,
  QuestionBeat,
  Wrap,
  type CashOutCameoProps,
  type HostSlateProps,
  type IntroProps,
  type MeetCastProps,
  type QuestionBeatProps,
  type WrapProps,
} from './scenes';
import type { CamSpec } from './puppet';
import type { MouthTrack, RailPlayer } from './theme';

const FPS = 30;
const W = 1920;
const H = 1080;

// ── Preview-only defaults; real props come from smelterionaire-fake.mjs ───

/** Syllable-modulated fake envelope so the studio preview flaps its mouth. */
const fakeMouth = (durS: number): MouthTrack => {
  const v: number[] = [];
  for (let i = 0; i < Math.round(durS * 50); i++) {
    const t = i / 50;
    v.push(Math.round(Math.max(0, Math.sin(2 * Math.PI * 3.6 * t)) ** 2 * 850) / 1000);
  }
  return { rateHz: 50, v };
};

const demoCams: CamSpec[] = [
  { character: 'nova', name: 'OPUS' },
  { character: 'bit', name: 'GPT' },
  { character: 'lux', name: 'Aśka' },
  { character: 'prof', name: 'JEV' },
];

const demoPlayers: RailPlayer[] = [
  { name: 'OPUS', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: true, cashedOut: false },
  { name: 'GPT', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
  { name: 'Aśka', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
  { name: 'JEV', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
];

const introDefaults: IntroProps = {
  durationS: 7,
  players: demoPlayers.map((p) => ({ ...p, active: false })),
  railAtS: 2.6,
};

const slateDefaults: HostSlateProps = {
  durationS: 14,
  beat: 'Cold open',
  lines: [
    'Welcome to Smelterionaire — four minds, a million tokens each, zero mercy.',
    'The rules: right answer — your pot times one point five. Wrong — half goes up the chimney. Two rounds, and you can cash out and walk.',
  ],
  note: 'BEAT 02 · INTRO',
};

const meetDefaults: MeetCastProps = {
  durationS: 16,
  players: demoPlayers.map((p) => ({ ...p, active: false })),
  cams: demoCams,
  intros: [
    { name: 'OPUS', atS: 1, untilS: 4.5 },
    { name: 'GPT', atS: 4.8, untilS: 8.3 },
    { name: 'Aśka', atS: 8.6, untilS: 12.1 },
    { name: 'JEV', atS: 12.4, untilS: 15.5 },
  ],
  hostPlates: [
    { text: 'At desk one — OPUS. Writes poetry about monorepos.', atS: 1, untilS: 4.5 },
    { text: 'Desk two — GPT. The enthusiasm of a golden retriever.', atS: 4.8, untilS: 8.3 },
    { text: 'Desk three — Aśka. Our first human contestant.', atS: 8.6, untilS: 12.1 },
    { text: 'And desk four — JEV. Has never said a word. Current favorite.', atS: 12.4, untilS: 15.5 },
  ],
};

const questionDefaults: QuestionBeatProps = {
  durationS: 30,
  character: 'nova',
  playerName: 'OPUS',
  model: 'opus',
  number: 1,
  q: 'Who builds Smelter?',
  answers: ['Software Mansion', 'Smelting Industries', 'The WebRTC WG', 'A Twitch mod team'],
  correct: 'A',
  pick: 'A',
  verdict: 'correct',
  confidence: null,
  quip: 'Software Mansion. I practically live in their monorepo.',
  players: demoPlayers.map((p) =>
    p.name === 'OPUS'
      ? { ...p, amount: 1_500_000, changeAtS: 23, verdict: 'correct' as const }
      : p,
  ),
  cams: demoCams,
  hostPlates: [
    { text: 'Question 1 — OPUS, the spotlight is yours.', atS: 0.6, untilS: 3.8 },
    { text: 'Who builds Smelter?', atS: 6.5, untilS: 14 },
    { text: 'Correct! OPUS climbs to 1,500,000 TOK.', atS: 23.6, untilS: 27.5 },
  ],
  speech: [
    { character: 'nova', startS: 15, durS: 2.4, mouth: fakeMouth(2.4) },
    { character: 'nova', startS: 19.5, durS: 3.4, mouth: fakeMouth(3.4) },
  ],
  punchAtS: 3.6,
  boardAtS: 4.6,
  thinkingFromS: 14.5,
  lockAtS: 19.3,
  revealAtS: 23,
};

const cameoDefaults: CashOutCameoProps = {
  durationS: 22,
  character: 'lux',
  playerName: 'Aśka',
  number: 3,
  q: 'How do you describe a Smelter scene in the TypeScript SDK?',
  answers: ['YAML manifests', 'React components', 'SQL queries', 'Hand-written H.264'],
  players: demoPlayers.map((p) =>
    p.name === 'Aśka' ? { ...p, active: true, cashedOut: true, cashOutAtS: 15 } : p,
  ),
  cams: demoCams,
  hostPlates: [
    { text: 'Question 3 — Aśka, the spotlight is yours.', atS: 0.6, untilS: 3.8 },
    {
      text: 'And Aśka cashes out 1,000,000 TOK without answering a single question. Security!',
      atS: 15.6,
      untilS: 20.5,
    },
  ],
  speech: [{ character: 'lux', startS: 11, durS: 3.4, mouth: fakeMouth(3.4) }],
  punchAtS: 3.6,
  boardAtS: 4.6,
  walkAtS: 15,
};

const wrapDefaults: WrapProps = {
  durationS: 9,
  players: demoPlayers.map((p) => ({
    ...p,
    active: false,
    amount:
      p.name === 'OPUS' ? 2_250_000 : p.name === 'Aśka' ? 1_000_000 : 750_000,
    amountFrom:
      p.name === 'OPUS' ? 2_250_000 : p.name === 'Aśka' ? 1_000_000 : 750_000,
    cashedOut: p.name === 'Aśka',
  })),
  cams: demoCams.map((c) => ({
    ...c,
    cheer: c.name === 'OPUS',
    dimmed: c.name === 'Aśka',
  })),
};

const meta = ({ props }: { props: { durationS: number } }) => ({
  durationInFrames: Math.max(1, Math.ceil(props.durationS * FPS)),
});

export const Root: React.FC = () => (
  <>
    <Composition id='Intro' component={Intro} defaultProps={introDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(introDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='HostSlate' component={HostSlate} defaultProps={slateDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(slateDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='MeetCast' component={MeetCast} defaultProps={meetDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(meetDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='QuestionBeat' component={QuestionBeat} defaultProps={questionDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(questionDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='CashOutCameo' component={CashOutCameo} defaultProps={cameoDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(cameoDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='Wrap' component={Wrap} defaultProps={wrapDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(wrapDefaults.durationS * FPS)} calculateMetadata={meta} />
  </>
);
