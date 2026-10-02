import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  InputStream,
  Rescaler,
  Shader,
  Text,
  View,
} from '@swmansion/smelter';
import type { Api } from '@swmansion/smelter';
import { obQuizFormatDelta, obQuizFormatMoney } from '@smelter-editor/types';
import type { ObQuizLetter } from '@smelter-editor/types';
import type { ObHudState } from '../app/store';
import { TransitionShaderWrapper } from './transitionWrapper';

type TextWeight = Api.TextWeight;
type Resolution = { width: number; height: number };
type QuizHud = NonNullable<ObHudState['quiz']>;

/**
 * "Who Wants to Be a Smelterionaire?" overlays: money rail, ABCD board,
 * reveal flash, floating deltas, the Ask-the-AI plate and the title splash.
 * Drawn by ObHud's SceneChrome on top of the ob-stage cameras.
 *
 * Same contract as the rest of ObHud: static plates are PNGs from
 * scripts/ob-render-assets.mjs (`ob-quiz-*`), 1080p design coordinates × k,
 * and every animated value is computed in the render body from snapshot
 * timestamps — never seeded through state + effects (the engine ships each
 * commit before effects run).
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const CHALK = '#F2F4F8';
const DIM = '#F2F4F8B3';
const GOLD = '#FFD166';
const RED = '#FF2D2D';
const GREEN = '#22C55E';
const SKY = '#38BDF8';
const FRAME_MS = 33;

const LETTERS: readonly ObQuizLetter[] = ['A', 'B', 'C', 'D'];

/** Money count-up/down duration after a reveal. */
const COUNT_MS = 1400;
/** Money text keeps the verdict colour this long after the change. */
const COUNT_TINT_MS = 3000;
const FLASH_MS = 1800;
const FLOAT_MS = 1900;
const BOARD_FADE_MS = 250;
const HINT_FADE_MS = 250;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Absolutely-positioned full-frame holder. Every `<Shader>` (transition
 * wrapper, reveal flash) must sit inside one: an unpositioned child of a
 * View is laid out in flow, so a second bare Shader sibling would be pushed
 * a full frame to the right — off screen (ObMatchHud does the same).
 */
function Frame({
  resolution,
  children,
}: {
  resolution: Resolution;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {children}
    </View>
  );
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const alphaHex = (a: number): string =>
  Math.round(clamp01(a) * 255)
    .toString(16)
    .padStart(2, '0');

function Art({
  id,
  x,
  y,
  w,
  h,
  k,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
}) {
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width,
        height,
        overflow: 'hidden',
      }}>
      <Rescaler style={{ width, height, rescaleMode: 'fit' }}>
        <Image imageId={id} />
      </Rescaler>
    </View>
  );
}

function Group({
  x,
  y,
  w,
  h,
  k,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.round(w * k),
        height: Math.round(h * k),
        overflow: 'visible',
      }}>
      {children}
    </View>
  );
}

const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

function Label({
  x,
  y = 0,
  w,
  text,
  fs,
  k,
  color = CHALK,
  font = DISPLAY,
  weight = 'extra_bold',
  align = 'left',
  centerIn,
}: {
  x: number;
  y?: number;
  w: number;
  text: string;
  fs: number;
  k: number;
  color?: string;
  font?: string;
  weight?: TextWeight;
  align?: 'left' | 'center' | 'right';
  centerIn?: number;
}) {
  const width = Math.round(w * k);
  const top =
    centerIn != null ? y + centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
  return (
    <View
      style={{
        top: Math.round(top * k),
        left: Math.round(x * k),
        width,
        height: Math.round(fs * 1.45 * k),
        overflow: 'hidden',
      }}>
      <Text
        style={{
          fontSize: Math.round(fs * k),
          color,
          width,
          align,
          fontFamily: font,
          fontWeight: weight,
        }}>
        {text}
      </Text>
    </View>
  );
}

function useFrameTicker(untilMs: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (untilMs == null || Date.now() >= untilMs) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= untilMs) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [untilMs]);
}

// ── Money rail (top right) ────────────────────────────────────────────────

const LOGO_CHIP = { x: 1484, y: 44, w: 380, h: 64 };
const RAIL = { x: 1484, y: 120, w: 380, h: 64, gap: 76 };

function railY(index: number): number {
  return RAIL.y + index * RAIL.gap;
}

function MoneyChip({
  player,
  index,
  k,
}: {
  player: QuizHud['players'][number];
  index: number;
  k: number;
}) {
  const changedAt = player.changedAtMs;
  useFrameTicker(changedAt != null ? changedAt + COUNT_TINT_MS : null);
  const now = Date.now();
  const t =
    changedAt == null ? 1 : clamp01((now - changedAt) / COUNT_MS);
  const value = Math.round(
    player.amountFrom + (player.amount - player.amountFrom) * easeOutCubic(t),
  );
  const tinted = changedAt != null && now - changedAt < COUNT_TINT_MS;
  const color = !tinted
    ? CHALK
    : player.verdict === 'wrong'
      ? RED
      : GOLD;
  const y = railY(index);
  return (
    <Group x={RAIL.x} y={y} w={RAIL.w} h={RAIL.h} k={k}>
      <Art
        id={player.active ? 'ob-quiz-money-chip-active' : 'ob-quiz-money-chip'}
        x={0}
        y={0}
        w={RAIL.w}
        h={RAIL.h}
        k={k}
      />
      <Label
        x={18}
        y={0}
        w={150}
        text={player.name.toUpperCase()}
        fs={22}
        k={k}
        weight='bold'
        color={player.active ? GOLD : DIM}
        centerIn={RAIL.h}
      />
      <Label
        x={150}
        y={0}
        w={214}
        text={obQuizFormatMoney(value)}
        fs={24}
        k={k}
        font={MONO}
        weight='semi_bold'
        color={color}
        align='right'
        centerIn={RAIL.h}
      />
      {player.lifelineUsed ? null : (
        <Label
          x={352}
          y={6}
          w={24}
          text='◆'
          fs={13}
          k={k}
          color={SKY}
          align='center'
        />
      )}
    </Group>
  );
}

/** Floating "+$506,250" / "−$843,750" above the answering player's chip. */
function MoneyFloat({
  atMs,
  delta,
  index,
  k,
}: {
  atMs: number;
  delta: number;
  index: number;
  k: number;
}) {
  useFrameTicker(atMs + FLOAT_MS);
  const t = clamp01((Date.now() - atMs) / FLOAT_MS);
  if (t >= 1) return null;
  const rise = easeOutCubic(t) * 150;
  const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  const color = `${delta >= 0 ? GOLD : RED}${alphaHex(alpha)}`;
  return (
    <Label
      x={RAIL.x - 260}
      y={railY(index) + 12 - rise}
      w={240}
      text={obQuizFormatDelta(delta)}
      fs={40 + Math.round(8 * easeOutCubic(Math.min(1, t * 3)))}
      k={k}
      weight='black'
      color={color}
      align='right'
    />
  );
}

// ── The ABCD board ────────────────────────────────────────────────────────

const BOARD_TAG = { x: 208, y: 648, w: 1504, h: 34 };
const QUESTION = { x: 208, y: 690, w: 1504, h: 132 };
const ANSWER = { w: 740, h: 96 };
const ANSWER_POS = [
  { x: 208, y: 846 },
  { x: 972, y: 846 },
  { x: 208, y: 956 },
  { x: 972, y: 956 },
];

function answerPlate(
  letter: ObQuizLetter,
  board: NonNullable<QuizHud['board']>,
): string {
  if (board.reveal) {
    if (letter === board.reveal.correct) return 'ob-quiz-answer-correct';
    if (letter === board.locked && board.reveal.verdict === 'wrong')
      return 'ob-quiz-answer-wrong';
    return 'ob-quiz-answer-idle';
  }
  return letter === board.locked
    ? 'ob-quiz-answer-locked'
    : 'ob-quiz-answer-idle';
}

function QuizBoard({
  board,
  k,
  resolution,
}: {
  board: NonNullable<QuizHud['board']>;
  k: number;
  resolution: Resolution;
}) {
  return (
    <TransitionShaderWrapper
      transition={{
        type: 'fade',
        durationMs: BOARD_FADE_MS,
        direction: 'in',
        startedAtMs: board.shownAtMs,
      }}
      resolution={resolution}>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
          overflow: 'visible',
        }}>
        <Label
          x={BOARD_TAG.x + 8}
          y={BOARD_TAG.y}
          w={BOARD_TAG.w - 16}
          text={`QUESTION ${board.number} · ${board.forName.toUpperCase()}`}
          fs={18}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={GOLD}
          centerIn={BOARD_TAG.h}
        />
        <Group
          x={QUESTION.x}
          y={QUESTION.y}
          w={QUESTION.w}
          h={QUESTION.h}
          k={k}>
          <Art
            id='ob-quiz-question-plate'
            x={0}
            y={0}
            w={QUESTION.w}
            h={QUESTION.h}
            k={k}
          />
          <Label
            x={56}
            y={0}
            w={QUESTION.w - 112}
            text={board.q}
            fs={38}
            k={k}
            weight='bold'
            align='center'
            centerIn={QUESTION.h}
          />
        </Group>
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
            <Group
              key={letter}
              x={pos.x}
              y={pos.y}
              w={ANSWER.w}
              h={ANSWER.h}
              k={k}>
              <Art id={plate} x={0} y={0} w={ANSWER.w} h={ANSWER.h} k={k} />
              <Label
                x={40}
                y={0}
                w={44}
                text={letter}
                fs={34}
                k={k}
                weight='black'
                color={lettered}
                centerIn={ANSWER.h}
              />
              <Label
                x={104}
                y={0}
                w={ANSWER.w - 150}
                text={board.answers[i]}
                fs={28}
                k={k}
                weight='bold'
                color={texted}
                centerIn={ANSWER.h}
              />
            </Group>
          );
        })}
      </View>
    </TransitionShaderWrapper>
  );
}

// ── Reveal flash ──────────────────────────────────────────────────────────

/** Edge-glow envelope: sharp attack, long decay (hitFlashEnvelope-style). */
function flashOpacity(atMs: number, now: number): number {
  const t = (now - atMs) / FLASH_MS;
  if (t < 0 || t >= 1) return 0;
  const attack = clamp01(t / 0.08);
  const decay = Math.pow(1 - clamp01((t - 0.08) / 0.92), 2);
  return 0.85 * attack * decay;
}

function RevealFlash({
  atMs,
  verdict,
  resolution,
}: {
  atMs: number;
  verdict: 'correct' | 'wrong';
  resolution: Resolution;
}) {
  useFrameTicker(atMs + FLASH_MS);
  const opacity = flashOpacity(atMs, Date.now());
  if (opacity <= 0) return null;
  return (
    <Shader
      shaderId='opacity'
      resolution={resolution}
      shaderParam={{
        type: 'struct',
        value: [{ type: 'f32', fieldName: 'opacity', value: opacity }],
      }}>
      <View
        style={{
          width: resolution.width,
          height: resolution.height,
          overflow: 'hidden',
        }}>
        <Rescaler
          style={{
            width: resolution.width,
            height: resolution.height,
            rescaleMode: 'fill',
          }}>
          <Image
            imageId={
              verdict === 'correct' ? 'ob-quiz-flash-win' : 'ob-quiz-flash-lose'
            }
          />
        </Rescaler>
      </View>
    </Shader>
  );
}

// ── Ask the AI ────────────────────────────────────────────────────────────

const HINT = { x: 56, y: 132, w: 980, h: 150 };

function HintPlate({
  hint,
  k,
  resolution,
}: {
  hint: NonNullable<QuizHud['hint']>;
  k: number;
  resolution: Resolution;
}) {
  useFrameTicker(hint.untilMs);
  const now = Date.now();
  const fadingOut = hint.untilMs - now < HINT_FADE_MS;
  return (
    <TransitionShaderWrapper
      transition={{
        type: 'fade',
        durationMs: HINT_FADE_MS,
        direction: fadingOut ? 'out' : 'in',
        startedAtMs: fadingOut ? hint.untilMs - HINT_FADE_MS : hint.atMs,
      }}
      resolution={resolution}>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
          overflow: 'visible',
        }}>
        <Group x={HINT.x} y={HINT.y} w={HINT.w} h={HINT.h} k={k}>
          <Art id='ob-quiz-hint-plate' x={0} y={0} w={HINT.w} h={HINT.h} k={k} />
          <Label
            x={48}
            y={16}
            w={HINT.w - 96}
            text={
              hint.letter ? `THE AI SAYS: ${hint.letter}` : 'THE AI DIRECTOR'
            }
            fs={26}
            k={k}
            weight='black'
            color={SKY}
          />
          <Label
            x={48}
            y={58}
            w={HINT.w - 96}
            text={hint.text}
            fs={24}
            k={k}
            font={MONO}
            weight='medium'
            color={CHALK}
          />
        </Group>
      </View>
    </TransitionShaderWrapper>
  );
}

// ── Splash + stinger ──────────────────────────────────────────────────────

function QuizSplash({ k }: { k: number }) {
  return <Art id='ob-quiz-logo' x={580} y={340} w={760} h={200} k={k} />;
}

/**
 * Stinger audio: a bundled mp4 mixed in through a hidden 2×2 stream. No
 * videoState gate: the clip is black anyway, and waiting for 'playing' loses
 * the sting when the reveal cut churns the scene in the same commit window.
 */
function QuizSfx({ sfx }: { sfx: NonNullable<QuizHud['sfx']> }) {
  return (
    <View style={{ top: 0, left: 0, width: 2, height: 2, overflow: 'hidden' }}>
      <InputStream inputId={sfx.inputId} volume={0.7} />
    </View>
  );
}

// ── Overlay root ──────────────────────────────────────────────────────────

/** Track the last reveal so the float survives the board fading away. */
function useLastReveal(
  board: QuizHud['board'],
  activeIndex: number,
): { atMs: number; delta: number; index: number } | null {
  const reveal = board?.reveal ?? null;
  const ref = useRef<{ atMs: number; delta: number; index: number } | null>(
    null,
  );
  if (reveal && ref.current?.atMs !== reveal.atMs)
    ref.current = {
      atMs: reveal.atMs,
      delta: reveal.delta,
      index: Math.max(0, activeIndex),
    };
  return ref.current;
}

export function ObQuizOverlay({
  quiz,
  k,
  resolution,
}: {
  quiz: QuizHud;
  k: number;
  resolution: Resolution;
}) {
  const activeIndex = quiz.players.findIndex((p) => p.active);
  const float = useLastReveal(quiz.board, activeIndex);
  const reveal = quiz.board?.reveal ?? null;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {reveal ? (
        <Frame key={`flash-${reveal.atMs}`} resolution={resolution}>
          <RevealFlash
            atMs={reveal.atMs}
            verdict={reveal.verdict}
            resolution={resolution}
          />
        </Frame>
      ) : null}
      {quiz.splash ? <QuizSplash k={k} /> : null}
      <Art
        id='ob-quiz-logo-chip'
        x={LOGO_CHIP.x}
        y={LOGO_CHIP.y}
        w={LOGO_CHIP.w}
        h={LOGO_CHIP.h}
        k={k}
      />
      {quiz.players.map((p, i) => (
        <MoneyChip key={p.name + i} player={p} index={i} k={k} />
      ))}
      {float ? (
        <MoneyFloat
          key={`float-${float.atMs}`}
          atMs={float.atMs}
          delta={float.delta}
          index={float.index}
          k={k}
        />
      ) : null}
      {quiz.board ? (
        <Frame key={`board-${quiz.board.shownAtMs}`} resolution={resolution}>
          <QuizBoard board={quiz.board} k={k} resolution={resolution} />
        </Frame>
      ) : null}
      {quiz.hint ? (
        <Frame key={`hint-${quiz.hint.atMs}`} resolution={resolution}>
          <HintPlate hint={quiz.hint} k={k} resolution={resolution} />
        </Frame>
      ) : null}
      {quiz.sfx ? <QuizSfx sfx={quiz.sfx} /> : null}
    </View>
  );
}
