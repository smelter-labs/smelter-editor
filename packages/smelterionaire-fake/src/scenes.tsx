/**
 * The five Smelterionaire fake-episode scenes. Every animated value is a
 * pure function of the frame and the cue times in props — the orchestrator
 * (server/scripts/smelterionaire-fake.mjs) computes the cue times from the
 * synthesized TTS durations and passes them in via --props.
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { puppetSeed } from './anim';
import {
  AnswerPlate,
  HostPlates,
  MoneyRail,
  QuizBoard,
  QuizSplash,
  RevealFlash,
  ThinkingPlate,
  type BoardState,
} from './hud';
import {
  Confetti,
  PuppetFigure,
  StudioWall,
  soloSlot,
  speechAt,
  type PuppetFx,
} from './puppet';
import {
  CHALK,
  DIM,
  DISPLAY,
  GOLD,
  INK,
  MONO,
  SKY,
  clamp01,
  type HostPlateCue,
  type PuppetCharacterId,
  type QuizLetter,
  type RailPlayer,
  type SpeechCue,
} from './theme';

const useSceneTime = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tS = frame / fps;
  return { tS, timeMs: tS * 1000, width, height };
};

// ── Intro ─────────────────────────────────────────────────────────────────

export type IntroProps = {
  durationS: number;
  players: RailPlayer[];
  /** When the money rail slides in. */
  railAtS: number;
};

// No shared studio view in the fake — the intro/wrap are pure title cards.
export const Intro: React.FC<IntroProps> = ({ players, railAtS }) => {
  const { tS, width, height } = useSceneTime();
  const splashIn = clamp01((tS - 0.4) / 0.6);
  const scale = 1.18 - 0.18 * (1 - Math.pow(1 - splashIn, 3));
  const railX = interpolate(tS, [railAtS, railAtS + 0.6], [460, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} />
      <AbsoluteFill style={{ opacity: splashIn }}>
        <QuizSplash scale={scale} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${railX}px)` }}>
        <MoneyRail players={players} tS={tS} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Host slate (placeholder the user replaces with their own footage) ─────

export type HostSlateProps = {
  durationS: number;
  beat: string;
  line: string;
  note: string;
};

export const HostSlate: React.FC<HostSlateProps> = ({
  durationS,
  beat,
  line,
  note,
}) => {
  const { tS, width, height } = useSceneTime();
  const pulse = 0.5 + 0.5 * Math.sin(tS * Math.PI * 1.2);
  const cx = width / 2;
  const headY = height * 0.46;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {/* Framing guide: head-and-shoulders silhouette + eyeline rule. */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, opacity: 0.5 + pulse * 0.2 }}>
        <ellipse
          cx={cx}
          cy={headY}
          rx={150}
          ry={190}
          fill='none'
          stroke={SKY}
          strokeWidth={3}
          strokeDasharray='14 12'
        />
        <path
          d={`M ${cx - 420} ${height * 0.98} C ${cx - 330} ${height * 0.68}, ${cx - 210} ${height * 0.62}, ${cx} ${height * 0.62} C ${cx + 210} ${height * 0.62}, ${cx + 330} ${height * 0.68}, ${cx + 420} ${height * 0.98}`}
          fill='none'
          stroke={SKY}
          strokeWidth={3}
          strokeDasharray='14 12'
        />
        <line
          x1={120}
          y1={height / 3}
          x2={width - 120}
          y2={height / 3}
          stroke='#F2F4F833'
          strokeWidth={2}
          strokeDasharray='6 10'
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 70,
          width,
          textAlign: 'center',
          fontFamily: MONO,
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: 10,
          color: SKY,
        }}>
        HOST SHOT · PODMIEŃ NA SIEBIE
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 120,
          width,
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 900,
          fontSize: 64,
          color: CHALK,
        }}>
        {beat.toUpperCase()}
      </div>
      {/* The line to deliver. */}
      <div
        style={{
          position: 'absolute',
          left: width * 0.14,
          top: height * 0.68,
          width: width * 0.72,
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 52,
          lineHeight: 1.18,
          color: GOLD,
        }}>
        “{line}”
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 48,
          width,
          textAlign: 'center',
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 24,
          color: DIM,
        }}>
        {note} · {durationS.toFixed(1)} s · GUIDE VOICE NA ŚCIEŻCE A2
      </div>
    </AbsoluteFill>
  );
};

// ── Question beat ─────────────────────────────────────────────────────────

export type QuestionBeatProps = {
  durationS: number;
  character: PuppetCharacterId;
  playerName: string;
  model: string;
  number: number;
  q: string;
  answers: [string, string, string, string];
  correct: QuizLetter;
  pick: QuizLetter;
  verdict: 'correct' | 'wrong';
  confidence: number | null;
  quip: string | null;
  players: RailPlayer[];
  hostPlates: HostPlateCue[];
  speech: SpeechCue[];
  boardAtS: number;
  thinkingFromS: number;
  lockAtS: number;
  revealAtS: number;
};

export const QuestionBeat: React.FC<QuestionBeatProps> = (p) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const slot = soloSlot(p.character, p.playerName, width, height);
  const { env, airMs } = speechAt(p.speech, p.character, tS);
  const revealed = tS >= p.revealAtS;
  const fx: PuppetFx = {
    active: !revealed,
    cheer: revealed && p.verdict === 'correct' && tS < p.revealAtS + 6,
    sad: revealed && p.verdict === 'wrong' && tS < p.revealAtS + 1.4,
  };
  const board: BoardState = {
    number: p.number,
    forName: p.playerName,
    q: p.q,
    answers: p.answers,
    locked: tS >= p.lockAtS ? p.pick : null,
    reveal: revealed ? { correct: p.correct, verdict: p.verdict } : null,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} />
      <PuppetFigure slot={slot} timeMs={timeMs} env={env} airMs={airMs} fx={fx} />
      {revealed && p.verdict === 'correct' ? (
        <Confetti
          sinceMs={(tS - p.revealAtS) * 1000}
          seed={puppetSeed(p.playerName)}
          width={width}
          height={height}
        />
      ) : null}
      <RevealFlash atS={p.revealAtS} verdict={p.verdict} tS={tS} width={width} height={height} />
      <MoneyRail players={p.players} tS={tS} />
      {tS >= p.boardAtS ? <QuizBoard board={board} shownAtS={p.boardAtS} tS={tS} /> : null}
      {tS >= p.lockAtS ? (
        <AnswerPlate
          name={p.playerName}
          letter={p.pick}
          confidence={p.confidence}
          quip={p.quip}
          atS={p.lockAtS}
          untilS={null}
          tS={tS}
        />
      ) : tS >= p.thinkingFromS ? (
        <ThinkingPlate
          name={p.playerName}
          model={p.model}
          sinceS={p.thinkingFromS}
          untilS={p.lockAtS}
          tS={tS}
        />
      ) : null}
      <HostPlates cues={p.hostPlates} tS={tS} />
    </AbsoluteFill>
  );
};

// ── Cash-out cameo (GEMINI walks) ─────────────────────────────────────────

export type CashOutCameoProps = {
  durationS: number;
  character: PuppetCharacterId;
  playerName: string;
  players: RailPlayer[];
  hostPlates: HostPlateCue[];
  speech: SpeechCue[];
  /** When the figure starts walking off (after the farewell). */
  walkAtS: number;
};

export const CashOutCameo: React.FC<CashOutCameoProps> = (p) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const slot = soloSlot(p.character, p.playerName, width, height);
  const { env, airMs } = speechAt(p.speech, p.character, tS);
  const walk = clamp01((tS - p.walkAtS) / 1.8);
  const walkEase = 1 - Math.pow(1 - walk, 2);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} />
      <AbsoluteFill
        style={{
          transform: `translateX(${walkEase * width * 0.75}px)`,
          opacity: 1 - walkEase * 0.9,
        }}>
        <PuppetFigure
          slot={slot}
          timeMs={timeMs}
          env={env}
          airMs={airMs}
          fx={{ active: tS < p.walkAtS, cheer: tS >= p.walkAtS - 0.4, sad: false }}
        />
      </AbsoluteFill>
      <RevealFlash atS={p.walkAtS} verdict='wrong' tS={tS} width={width} height={height} />
      <MoneyRail players={p.players} tS={tS} />
      <HostPlates cues={p.hostPlates} tS={tS} />
    </AbsoluteFill>
  );
};

// ── Wrap ──────────────────────────────────────────────────────────────────

export type WrapProps = {
  durationS: number;
  players: RailPlayer[];
};

export const Wrap: React.FC<WrapProps> = ({ players }) => {
  const { tS, width, height } = useSceneTime();
  const splashIn = clamp01((tS - 0.5) / 0.5);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} />
      <Confetti
        sinceMs={(tS - 0.8) * 1000}
        seed={puppetSeed('wrap')}
        width={width}
        height={height}
      />
      <AbsoluteFill style={{ opacity: splashIn }}>
        <QuizSplash />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 560,
            width,
            textAlign: 'center',
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: 8,
            color: CHALK,
          }}>
          SMELTERIONAIRE, OUT.
        </div>
      </AbsoluteFill>
      <MoneyRail players={players} tS={tS} />
    </AbsoluteFill>
  );
};
