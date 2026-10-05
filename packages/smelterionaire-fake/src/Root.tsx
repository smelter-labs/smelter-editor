import React from 'react';
import { Composition } from 'remotion';
import {
  CashOutCameo,
  HostSlate,
  Intro,
  QuestionBeat,
  Wrap,
  type CashOutCameoProps,
  type CastMember,
  type HostSlateProps,
  type IntroProps,
  type QuestionBeatProps,
  type WrapProps,
} from './scenes';
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

const demoCast: CastMember[] = [
  { character: 'host', name: 'Max Smelter' },
  { character: 'nova', name: 'OPUS' },
  { character: 'bit', name: 'GPT' },
  { character: 'prof', name: 'GEMINI' },
  { character: 'lux', name: 'JEV' },
];

const demoPlayers: RailPlayer[] = [
  { name: 'OPUS', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: true, cashedOut: false },
  { name: 'GPT', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
  { name: 'GEMINI', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
  { name: 'JEV', amount: 1_000_000, amountFrom: 1_000_000, changeAtS: null, verdict: null, active: false, cashedOut: false },
];

const introDefaults: IntroProps = {
  durationS: 7,
  cast: demoCast,
  players: demoPlayers.map((p) => ({ ...p, active: false })),
  railAtS: 2.6,
};

const slateDefaults: HostSlateProps = {
  durationS: 7,
  beat: 'Cold open',
  line: 'Welcome to Smelterionaire — four minds, a million tokens each, zero mercy.',
  note: 'BEAT 02 · INTRO',
};

const questionDefaults: QuestionBeatProps = {
  durationS: 24,
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
      ? { ...p, amount: 1_500_000, changeAtS: 17, verdict: 'correct' as const }
      : p,
  ),
  hostPlates: [
    { text: 'Question 1 — OPUS, the spotlight is yours.', atS: 0.5, untilS: 4 },
    { text: 'Correct! OPUS climbs to 1,500,000 TOK.', atS: 17.6, untilS: 22 },
  ],
  speech: [
    { character: 'nova', startS: 6.5, durS: 2.4, mouth: fakeMouth(2.4) },
    { character: 'nova', startS: 13, durS: 3.4, mouth: fakeMouth(3.4) },
  ],
  boardAtS: 4.2,
  thinkingFromS: 6.2,
  lockAtS: 13,
  revealAtS: 17,
};

const cameoDefaults: CashOutCameoProps = {
  durationS: 12,
  character: 'prof',
  playerName: 'GEMINI',
  players: demoPlayers.map((p) =>
    p.name === 'GEMINI' ? { ...p, cashedOut: true, cashOutAtS: 5 } : p,
  ),
  hostPlates: [
    {
      text: 'And GEMINI cashes out 1,000,000 TOK without answering a thing. Security!',
      atS: 5.4,
      untilS: 10.5,
    },
  ],
  speech: [{ character: 'prof', startS: 1, durS: 3.4, mouth: fakeMouth(3.4) }],
  walkAtS: 5,
};

const wrapDefaults: WrapProps = {
  durationS: 8,
  cast: demoCast,
  players: demoPlayers.map((p) => ({
    ...p,
    active: false,
    amount:
      p.name === 'GPT' ? 500_000 : p.name === 'GEMINI' ? 1_000_000 : 1_500_000,
    amountFrom:
      p.name === 'GPT' ? 500_000 : p.name === 'GEMINI' ? 1_000_000 : 1_500_000,
    cashedOut: p.name === 'GEMINI',
  })),
  cheerNames: ['OPUS', 'JEV'],
};

const meta = ({ props }: { props: { durationS: number } }) => ({
  durationInFrames: Math.max(1, Math.ceil(props.durationS * FPS)),
});

export const Root: React.FC = () => (
  <>
    <Composition id='Intro' component={Intro} defaultProps={introDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(introDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='HostSlate' component={HostSlate} defaultProps={slateDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(slateDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='QuestionBeat' component={QuestionBeat} defaultProps={questionDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(questionDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='CashOutCameo' component={CashOutCameo} defaultProps={cameoDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(cameoDefaults.durationS * FPS)} calculateMetadata={meta} />
    <Composition id='Wrap' component={Wrap} defaultProps={wrapDefaults} fps={FPS} width={W} height={H} durationInFrames={Math.ceil(wrapDefaults.durationS * FPS)} calculateMetadata={meta} />
  </>
);
