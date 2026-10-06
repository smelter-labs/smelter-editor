/**
 * The Smelterionaire fake-episode scenes. Every animated value is a pure
 * function of the frame and the cue times in props — the orchestrator
 * (server/scripts/smelterionaire-fake.mjs) computes the cue times from the
 * synthesized TTS durations and passes them in via --props.
 *
 * Question beats open on a 2×2 multiviewer of all contestant cams and
 * punch-in to the assigned one; every clip starts and ends with a gold wipe
 * so butt-joined segments read as switcher transitions on the timeline.
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
  SegmentWipe,
  ThinkingPlate,
  type BoardState,
} from './hud';
import {
  CamGrid,
  Confetti,
  PUNCH_S,
  PuppetFigure,
  StudioWall,
  soloSlot,
  speechAt,
  type CamSpec,
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

// No shared studio view in the fake — the intro is a pure title card.
export const Intro: React.FC<IntroProps> = ({ durationS, players, railAtS }) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const splashIn = clamp01((tS - 0.4) / 0.6);
  const scale = 1.18 - 0.18 * (1 - Math.pow(1 - splashIn, 3));
  const railX = interpolate(tS, [railAtS, railAtS + 0.6], [460, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} timeMs={timeMs} />
      <AbsoluteFill style={{ opacity: splashIn }}>
        <QuizSplash scale={scale} />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${railX}px)` }}>
        <MoneyRail players={players} tS={tS} />
      </AbsoluteFill>
      <SegmentWipe tS={tS} durationS={durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── Host slate (placeholder the user replaces with their own footage) ─────

export type HostSlateProps = {
  durationS: number;
  beat: string;
  /** Lines to deliver, read back-to-back on the A2 guide track. */
  lines: string[];
  note: string;
};

const slateFs = (len: number) => (len > 160 ? 34 : len > 90 ? 44 : 52);

export const HostSlate: React.FC<HostSlateProps> = ({
  durationS,
  beat,
  lines,
  note,
}) => {
  const { tS, width, height } = useSceneTime();
  const pulse = 0.5 + 0.5 * Math.sin(tS * Math.PI * 1.2);
  const cx = width / 2;
  const headY = height * 0.44;
  const long = lines.join(' ').length > 160;
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
          d={`M ${cx - 420} ${height * 0.98} C ${cx - 330} ${height * 0.66}, ${cx - 210} ${height * 0.6}, ${cx} ${height * 0.6} C ${cx + 210} ${height * 0.6}, ${cx + 330} ${height * 0.66}, ${cx + 420} ${height * 0.98}`}
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
      {/* The lines to deliver. */}
      <div
        style={{
          position: 'absolute',
          left: width * 0.12,
          top: height * (long ? 0.56 : 0.66),
          width: width * 0.76,
          textAlign: 'center',
        }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: slateFs(line.length),
              lineHeight: 1.18,
              color: GOLD,
              marginBottom: 22,
            }}>
            “{line}”
          </div>
        ))}
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
      <SegmentWipe tS={tS} durationS={durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── Meet the cast: the host introduces each contestant on the grid ────────

export type MeetCastProps = {
  durationS: number;
  players: RailPlayer[];
  cams: CamSpec[];
  /** Who is being introduced when — the tally walks the grid. */
  intros: { name: string; atS: number; untilS: number }[];
  hostPlates: HostPlateCue[];
};

export const MeetCast: React.FC<MeetCastProps> = (p) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const current = p.intros.find((i) => tS >= i.atS && tS < i.untilS);
  const activeIndex = current
    ? p.cams.findIndex((c) => c.name === current.name)
    : -1;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <CamGrid
        cams={p.cams}
        activeIndex={activeIndex}
        tS={tS}
        timeMs={timeMs}
        punchAtS={null}
        width={width}
        height={height}
      />
      <MoneyRail players={p.players} tS={tS} />
      <HostPlates cues={p.hostPlates} tS={tS} />
      <SegmentWipe tS={tS} durationS={p.durationS} width={width} height={height} />
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
  cams: CamSpec[];
  hostPlates: HostPlateCue[];
  speech: SpeechCue[];
  /** When the multiviewer punches in to this beat's contestant. */
  punchAtS: number;
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
      <StudioWall width={width} height={height} timeMs={timeMs} />
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
      <CamGrid
        cams={p.cams}
        activeIndex={p.cams.findIndex((c) => c.name === p.playerName)}
        tS={tS}
        timeMs={timeMs}
        punchAtS={p.punchAtS}
        width={width}
        height={height}
      />
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
      <SegmentWipe tS={tS} durationS={p.durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── Cash-out cameo: Joanna gets a question, answers with a goodbye ──────────

export type CashOutCameoProps = {
  durationS: number;
  character: PuppetCharacterId;
  playerName: string;
  number: number;
  q: string;
  answers: [string, string, string, string];
  players: RailPlayer[];
  cams: CamSpec[];
  hostPlates: HostPlateCue[];
  speech: SpeechCue[];
  punchAtS: number;
  boardAtS: number;
  /** When the figure starts walking off (after the farewell). */
  walkAtS: number;
  /** From when the solo is a stand-in to be replaced with real footage. */
  standInFromS: number;
};

export const CashOutCameo: React.FC<CashOutCameoProps> = (p) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const slot = soloSlot(p.character, p.playerName, width, height);
  const { env, airMs } = speechAt(p.speech, p.character, tS);
  const walk = clamp01((tS - p.walkAtS) / 1.8);
  const walkEase = 1 - Math.pow(1 - walk, 2);
  // The board stays up, unanswered — that is the joke.
  const board: BoardState = {
    number: p.number,
    forName: p.playerName,
    q: p.q,
    answers: p.answers,
    locked: null,
    reveal: null,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <StudioWall width={width} height={height} timeMs={timeMs} />
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
      <CamGrid
        cams={p.cams}
        activeIndex={p.cams.findIndex((c) => c.name === p.playerName)}
        tS={tS}
        timeMs={timeMs}
        punchAtS={p.punchAtS}
        width={width}
        height={height}
      />
      <MoneyRail players={p.players} tS={tS} />
      {tS >= p.boardAtS ? <QuizBoard board={board} shownAtS={p.boardAtS} tS={tS} /> : null}
      <HostPlates cues={p.hostPlates} tS={tS} />
      {/* Like the host slates, this whole solo is a placeholder: the real
          Joanna gets filmed and dropped over it; her line sits on A2. */}
      {tS >= p.standInFromS ? (
        <div
          style={{
            position: 'absolute',
            left: 24,
            bottom: 24,
            padding: '8px 14px',
            backgroundColor: 'rgba(7,11,24,.85)',
            border: `2px dashed ${SKY}`,
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 20,
            letterSpacing: 3,
            color: SKY,
          }}>
          STAND-IN · PODMIEŃ NA ŻYWĄ JOANNĘ · GŁOS NA A2
        </div>
      ) : null}
      <SegmentWipe tS={tS} durationS={p.durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── Wrap ──────────────────────────────────────────────────────────────────

export type WrapProps = {
  durationS: number;
  players: RailPlayer[];
  /** Final multiviewer state (winner cheering, Joanna's tile cashed out). */
  cams: CamSpec[];
};

export const Wrap: React.FC<WrapProps> = ({ durationS, players, cams }) => {
  const { tS, timeMs, width, height } = useSceneTime();
  const splashIn = clamp01((tS - 0.6) / 0.5);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <CamGrid
        cams={cams}
        activeIndex={-1}
        tS={tS}
        timeMs={timeMs}
        punchAtS={null}
        width={width}
        height={height}
      />
      {/* Dark wash so the logo reads over the grid. */}
      <AbsoluteFill
        style={{ backgroundColor: 'rgba(7,11,24,.45)', opacity: splashIn }}
      />
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
      <SegmentWipe tS={tS} durationS={durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};
