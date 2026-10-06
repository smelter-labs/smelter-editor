/**
 * Smelterionaire HUD plates, rebuilt from server/src/inputs/ObQuizHud.tsx at
 * the same 1080p design coordinates — the static plates are the very PNGs
 * the live show registers (copied into public/plates by the orchestrator).
 */
import React from 'react';
import { Img, staticFile } from 'remotion';
import {
  CHALK,
  DIM,
  DISPLAY,
  GOLD,
  LETTERS,
  MONO,
  RED,
  SKY,
  clamp01,
  easeOutCubic,
  formatTok,
  type HostPlateCue,
  type QuizLetter,
  type RailPlayer,
} from './theme';

const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

export function Art({
  id,
  x,
  y,
  w,
  h,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return (
    <Img
      src={staticFile(`plates/${id}.png`)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        filter: 'drop-shadow(0 10px 22px rgba(0,0,0,0.45))',
      }}
    />
  );
}

type Weight = 400 | 500 | 600 | 700 | 800 | 900;

export function Label({
  x,
  y = 0,
  w,
  text,
  fs,
  color = CHALK,
  font = DISPLAY,
  weight = 800,
  align = 'left',
  centerIn,
}: {
  x: number;
  y?: number;
  w: number;
  text: string;
  fs: number;
  color?: string;
  font?: string;
  weight?: Weight;
  align?: 'left' | 'center' | 'right';
  centerIn?: number;
}) {
  const top =
    centerIn != null ? y + centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: Math.round(top),
        width: w,
        height: Math.round(fs * 1.45),
        // Visible: with lineHeight 1 a diacritic (Ś in AŚKA) pokes above the
        // line box and overflow:hidden would shave it off.
        overflow: 'visible',
        fontFamily: font,
        fontWeight: weight,
        fontSize: fs,
        lineHeight: 1,
        color,
        textAlign: align,
        whiteSpace: 'nowrap',
      }}>
      {text}
    </div>
  );
}

/** Naive two-line wrap at a character budget (same as the live HUD). */
export function wrapTwoLines(
  text: string,
  perLine: number,
): [string, string | null] {
  if (text.length <= perLine) return [text, null];
  const cut = text.lastIndexOf(' ', perLine);
  const at = cut > perLine * 0.5 ? cut : perLine;
  const rest = text.slice(at).trim();
  return [
    text.slice(0, at).trim(),
    rest.length > perLine ? `${rest.slice(0, perLine - 1).trimEnd()}…` : rest,
  ];
}

const FADE_S = 0.25;

/** Fade-in (and optional fade-out) opacity for a plate shown atS..untilS. */
function plateOpacity(tS: number, atS: number, untilS: number | null): number {
  if (tS < atS) return 0;
  const fadeIn = clamp01((tS - atS) / FADE_S);
  if (untilS == null) return fadeIn;
  if (tS >= untilS) return 0;
  return Math.min(fadeIn, clamp01((untilS - tS) / FADE_S));
}

// ── Money rail (top right) ────────────────────────────────────────────────

const LOGO_CHIP = { x: 1484, y: 44, w: 380, h: 64 };
const RAIL = { x: 1484, y: 120, w: 380, h: 64, gap: 76 };
const COUNT_S = 1.4;
const COUNT_TINT_S = 3.0;

export function LogoChip() {
  return <Art id='ob-quiz-logo-chip' {...LOGO_CHIP} />;
}

export function MoneyChip({
  player,
  index,
  tS,
}: {
  player: RailPlayer;
  index: number;
  tS: number;
}) {
  const changed = player.changeAtS != null && tS >= player.changeAtS;
  const t = !changed ? 0 : clamp01((tS - player.changeAtS!) / COUNT_S);
  const value = changed
    ? Math.round(
        player.amountFrom + (player.amount - player.amountFrom) * easeOutCubic(t),
      )
    : player.amountFrom;
  const tinted = changed && tS - player.changeAtS! < COUNT_TINT_S;
  const color = !tinted ? CHALK : player.verdict === 'wrong' ? RED : GOLD;
  const cashedOut = player.cashedOut && tS >= (player.cashOutAtS ?? 0);
  const faded = '#F2F4F866';
  const y = RAIL.y + index * RAIL.gap;
  return (
    <div
      style={{
        position: 'absolute',
        left: RAIL.x,
        top: y,
        width: RAIL.w,
        height: RAIL.h,
      }}>
      <Art
        id={
          player.active && !cashedOut
            ? 'ob-quiz-money-chip-active'
            : 'ob-quiz-money-chip'
        }
        x={0}
        y={0}
        w={RAIL.w}
        h={RAIL.h}
      />
      <Label
        x={18}
        w={150}
        text={player.name.toUpperCase()}
        fs={22}
        weight={700}
        color={cashedOut ? faded : player.active ? GOLD : DIM}
        centerIn={RAIL.h}
      />
      <Label
        x={150}
        w={214}
        text={formatTok(value)}
        fs={24}
        font={MONO}
        weight={600}
        color={cashedOut ? faded : color}
        align='right'
        centerIn={RAIL.h}
      />
      {cashedOut ? null : (
        <Label x={352} y={6} w={24} text='◆' fs={13} color={SKY} align='center' />
      )}
    </div>
  );
}

export function MoneyRail({
  players,
  tS,
}: {
  players: RailPlayer[];
  tS: number;
}) {
  return (
    <>
      <LogoChip />
      {players.map((p, i) => (
        <MoneyChip key={p.name} player={p} index={i} tS={tS} />
      ))}
    </>
  );
}

// ── Question board ────────────────────────────────────────────────────────

const BOARD_TAG = { x: 208, y: 648, w: 1504, h: 34 };
const QUESTION = { x: 208, y: 690, w: 1504, h: 132 };
const ANSWER = { w: 740, h: 96 };
const ANSWER_POS = [
  { x: 208, y: 846 },
  { x: 972, y: 846 },
  { x: 208, y: 956 },
  { x: 972, y: 956 },
];

export type BoardState = {
  number: number;
  forName: string;
  q: string;
  answers: [string, string, string, string];
  locked: QuizLetter | null;
  reveal: { correct: QuizLetter; verdict: 'correct' | 'wrong' } | null;
};

function answerPlate(letter: QuizLetter, board: BoardState): string {
  if (board.reveal) {
    if (letter === board.reveal.correct) return 'ob-quiz-answer-correct';
    if (letter === board.locked && board.reveal.verdict === 'wrong')
      return 'ob-quiz-answer-wrong';
    return 'ob-quiz-answer-idle';
  }
  return letter === board.locked ? 'ob-quiz-answer-locked' : 'ob-quiz-answer-idle';
}

export function QuizBoard({
  board,
  shownAtS,
  tS,
}: {
  board: BoardState;
  shownAtS: number;
  tS: number;
}) {
  const opacity = plateOpacity(tS, shownAtS, null);
  if (opacity <= 0) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <Label
        x={BOARD_TAG.x + 8}
        y={BOARD_TAG.y}
        w={BOARD_TAG.w - 16}
        text={`QUESTION ${board.number} · ${board.forName.toUpperCase()}`}
        fs={18}
        font={MONO}
        weight={600}
        color={GOLD}
        centerIn={BOARD_TAG.h}
      />
      <Art id='ob-quiz-question-plate' {...QUESTION} />
      <Label
        x={QUESTION.x + 56}
        y={QUESTION.y}
        w={QUESTION.w - 112}
        text={board.q}
        fs={38}
        weight={700}
        align='center'
        centerIn={QUESTION.h}
      />
      {LETTERS.map((letter, i) => {
        const pos = ANSWER_POS[i];
        const plate = answerPlate(letter, board);
        const lettered =
          plate === 'ob-quiz-answer-idle'
            ? GOLD
            : plate === 'ob-quiz-answer-locked'
              ? '#1A1206'
              : CHALK;
        const texted = plate === 'ob-quiz-answer-locked' ? '#1A1206' : CHALK;
        return (
          <div
            key={letter}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: ANSWER.w,
              height: ANSWER.h,
            }}>
            <Art id={plate} x={0} y={0} w={ANSWER.w} h={ANSWER.h} />
            <Label
              x={40}
              w={44}
              text={letter}
              fs={34}
              weight={900}
              color={lettered}
              centerIn={ANSWER.h}
            />
            <Label
              x={104}
              w={ANSWER.w - 150}
              text={board.answers[i]}
              fs={28}
              weight={700}
              color={texted}
              centerIn={ANSWER.h}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── HINT slot: thinking / landed answer ───────────────────────────────────

const HINT = { x: 56, y: 132, w: 980, h: 150 };

const VENDORS: Record<string, string> = {
  opus: 'ANTHROPIC',
  gpt: 'OPENAI',
  gemini: 'GOOGLE',
  jev: 'TYPESAFE AI',
};

export function ThinkingPlate({
  name,
  model,
  sinceS,
  untilS,
  tS,
}: {
  name: string;
  model: string;
  sinceS: number;
  untilS: number;
  tS: number;
}) {
  const opacity = plateOpacity(tS, sinceS, untilS);
  if (opacity <= 0) return null;
  const dots = '.'.repeat(1 + (Math.floor(((tS - sinceS) * 1000) / 400) % 3));
  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <div
        style={{
          position: 'absolute',
          left: HINT.x,
          top: HINT.y,
          width: HINT.w,
          height: HINT.h,
        }}>
        <Art id='ob-quiz-hint-plate' x={0} y={0} w={HINT.w} h={HINT.h} />
        <Label
          x={48}
          y={16}
          w={HINT.w - 96}
          text={`${name.toUpperCase()} IS THINKING${dots}`}
          fs={26}
          weight={900}
          color={SKY}
        />
        <Label
          x={48}
          y={58}
          w={HINT.w - 96}
          text={`${VENDORS[model] ?? model.toUpperCase()} · LIVE ANSWER IN PROGRESS`}
          fs={24}
          font={MONO}
          weight={500}
          color={DIM}
        />
      </div>
    </div>
  );
}

export function AnswerPlate({
  name,
  letter,
  confidence,
  quip,
  atS,
  untilS,
  tS,
}: {
  name: string;
  letter: QuizLetter;
  confidence: number | null;
  quip: string | null;
  atS: number;
  untilS: number | null;
  tS: number;
}) {
  const opacity = plateOpacity(tS, atS, untilS);
  if (opacity <= 0) return null;
  const title =
    confidence !== null
      ? `${name.toUpperCase()} LOCKS ${letter} · ${Math.round(confidence * 100)}% SURE`
      : `${name.toUpperCase()} LOCKS ${letter}`;
  const line =
    quip ??
    (confidence !== null
      ? 'A typed decision. No second thoughts — no thoughts at all.'
      : '');
  const [line1, line2] = wrapTwoLines(line, 70);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <div
        style={{
          position: 'absolute',
          left: HINT.x,
          top: HINT.y,
          width: HINT.w,
          height: HINT.h,
        }}>
        <Art id='ob-quiz-hint-plate' x={0} y={0} w={HINT.w} h={HINT.h} />
        <Label x={48} y={16} w={HINT.w - 96} text={title} fs={26} weight={900} color={GOLD} />
        {line ? (
          <Label
            x={48}
            y={line2 ? 54 : 58}
            w={HINT.w - 96}
            text={line1}
            fs={22}
            font={MONO}
            weight={500}
            color={CHALK}
          />
        ) : null}
        {line2 ? (
          <Label
            x={48}
            y={90}
            w={HINT.w - 96}
            text={line2}
            fs={22}
            font={MONO}
            weight={500}
            color={CHALK}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Host line plate (top, left of the money rail) ─────────────────────────

const HOST_LINE = { x: 720, y: 40, w: 740, h: 72 };

export function HostLinePlate({ cue, tS }: { cue: HostPlateCue; tS: number }) {
  const opacity = plateOpacity(tS, cue.atS, cue.untilS);
  if (opacity <= 0) return null;
  const [line1, line2] = wrapTwoLines(cue.text, 58);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity }}>
      <div
        style={{
          position: 'absolute',
          left: HOST_LINE.x,
          top: HOST_LINE.y,
          width: HOST_LINE.w,
          height: HOST_LINE.h,
        }}>
        <Art id='ob-quiz-host-plate' x={0} y={0} w={HOST_LINE.w} h={HOST_LINE.h} />
        <Label x={26} y={6} w={HOST_LINE.w - 52} text='MAX SMELTER' fs={12} font={MONO} weight={600} color={GOLD} />
        <Label x={26} y={line2 ? 24 : 32} w={HOST_LINE.w - 52} text={line1} fs={19} weight={700} color={CHALK} />
        {line2 ? (
          <Label x={26} y={46} w={HOST_LINE.w - 52} text={line2} fs={19} weight={700} color={CHALK} />
        ) : null}
      </div>
    </div>
  );
}

/** First host plate cue active at `tS`, if any. */
export function HostPlates({ cues, tS }: { cues: HostPlateCue[]; tS: number }) {
  const cue = cues.find((c) => tS >= c.atS && tS < c.untilS + FADE_S);
  return cue ? <HostLinePlate cue={cue} tS={tS} /> : null;
}

// ── Reveal flash ──────────────────────────────────────────────────────────

const FLASH_S = 1.8;

export function RevealFlash({
  atS,
  verdict,
  tS,
  width,
  height,
}: {
  atS: number;
  verdict: 'correct' | 'wrong';
  tS: number;
  width: number;
  height: number;
}) {
  const t = (tS - atS) / FLASH_S;
  if (t < 0 || t >= 1) return null;
  const attack = clamp01(t / 0.08);
  const decay = Math.pow(1 - clamp01((t - 0.08) / 0.92), 2);
  const opacity = 0.85 * attack * decay;
  return (
    <Img
      src={staticFile(
        `plates/${verdict === 'correct' ? 'ob-quiz-flash-win' : 'ob-quiz-flash-lose'}.png`,
      )}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        opacity,
        objectFit: 'fill',
      }}
    />
  );
}

// ── Segment wipe (view-switch transition baked into every clip) ───────────

const WIPE_S = 0.45;

/**
 * A gold skewed bar sweeping the frame at the start and before the end of
 * each clip — butt-joined segments on the Premiere timeline read as switcher
 * transitions instead of hard cuts.
 */
export function SegmentWipe({
  tS,
  durationS,
  width,
  height,
}: {
  tS: number;
  durationS: number;
  width: number;
  height: number;
}) {
  let p: number | null = null;
  if (tS < WIPE_S) p = tS / WIPE_S;
  else if (tS > durationS - WIPE_S) p = (tS - (durationS - WIPE_S)) / WIPE_S;
  if (p == null || p < 0 || p > 1) return null;
  const barW = width * 0.55;
  const x = -barW - width * 0.15 + p * (width + barW + width * 0.3);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: -120,
        width: barW,
        height: height + 240,
        transform: 'skewX(-12deg)',
        background:
          'linear-gradient(90deg, rgba(255,209,102,0) 0%, #FFD166 18%, #FFE9B0 50%, #FFD166 82%, rgba(255,209,102,0) 100%)',
        opacity: 0.97,
      }}
    />
  );
}

/** Centre-splash logo (intro / wrap). */
export function QuizSplash({ opacity = 1, scale = 1 }: { opacity?: number; scale?: number }) {
  return (
    <Img
      src={staticFile('plates/ob-quiz-logo.png')}
      style={{
        position: 'absolute',
        left: 580,
        top: 340,
        width: 760,
        height: 200,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: '50% 50%',
      }}
    />
  );
}
