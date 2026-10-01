/**
 * Live puppet renderer: draws an illustrated talent (or the whole studio)
 * from layered `ob-puppet-*` engine images, lip-synced to the cam's own
 * audio. The carrier mp4 keeps playing underneath in a 2×2 px keeper so its
 * audio stays in the mix and the side-channel keeps analysing it — the
 * puppet is purely the picture.
 *
 * Every animation is computed in the render pass from the wall clock and the
 * clip→air clock (cfg.getClock()), so a 30 fps ticker is the only state.
 */
import React, { useContext, useRef } from 'react';
import { Image, InputStream, Rescaler, View } from '@swmansion/smelter';
import { useStore } from 'zustand';
import { StoreContext } from '../../app/store';
import {
  blinkClosed,
  clipAirMs,
  confettiPiece,
  glowLevel,
  mouthScale,
  pickViseme,
  puppetSeed,
  puppetSway,
  sampleMouth,
  smoothAmp,
} from './anim';
import {
  PUPPET_BODY_BOX,
  PUPPET_BROWS_BOX,
  PUPPET_CANVAS,
  PUPPET_DESK,
  PUPPET_EYES_BOX,
  PUPPET_GLOW,
  PUPPET_HEAD_BOX,
  PUPPET_MOUTH_BOX,
  type PuppetBox,
} from './geometry';
import type {
  ObPuppetConfig,
  PuppetCastMember,
  PuppetCharacterId,
  PuppetMouthTrack,
} from './types';

type Resolution = { width: number; height: number };

const TICK_MS = 33;
const CELEBRATE_MS = 5800;
const CONFETTI_PIECES = 36;

/** Per-figure smoothing carried across ticks (mutated in render, like a ref). */
type FigureState = { amp: number; lastVoicedMs: number };

function Sprite({
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
    <View
      style={{
        top: Math.round(y),
        left: Math.round(x),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, Math.round(h)),
      }}>
      <Rescaler
        style={{
          width: Math.max(1, Math.round(w)),
          height: Math.max(1, Math.round(h)),
          rescaleMode: 'fit',
        }}>
        <Image imageId={id} />
      </Rescaler>
    </View>
  );
}

type FigurePose = {
  character: PuppetCharacterId;
  /** Canvas→px scale and the canvas origin in tile px. */
  k: number;
  originX: number;
  originY: number;
  amp: number;
  airMs: number;
  silenceMs: number;
  wallMs: number;
  cheer: boolean;
  sadBlink: boolean;
  browsUp: boolean;
};

/** One puppet, layer by layer. All rects derive from the shared geometry. */
function PuppetFigure(pose: FigurePose) {
  const {
    character,
    k,
    originX,
    originY,
    amp,
    airMs,
    silenceMs,
    wallMs,
    cheer,
  } = pose;
  const seed = puppetSeed(character);
  const sway = puppetSway(wallMs, seed, amp);
  const box = (b: PuppetBox, dx = 0, dy = 0) => ({
    x: originX + (b.x + dx) * k,
    y: originY + (b.y + dy) * k,
    w: b.w * k,
    h: b.h * k,
  });
  const viseme = pickViseme(amp, airMs, seed, silenceMs);
  const mk = mouthScale(viseme, amp);
  const eyesClosed = pose.sadBlink || blinkClosed(wallMs, seed);
  const id = (layer: string) => `ob-puppet-${character}-${layer}`;

  const body = box(PUPPET_BODY_BOX, sway.bodyX, 0);
  const headDx = sway.bodyX + sway.headX;
  const headDy = sway.headY;
  const head = box(PUPPET_HEAD_BOX, headDx, headDy);
  const brows = box(PUPPET_BROWS_BOX, headDx, headDy);
  const eyes = box(PUPPET_EYES_BOX, headDx, headDy);
  const mouthBase = box(PUPPET_MOUTH_BOX, headDx, headDy);
  const mouth = {
    x: mouthBase.x - (mouthBase.w * (mk - 1)) / 2,
    y: mouthBase.y - (mouthBase.h * (mk - 1)) / 2,
    w: mouthBase.w * mk,
    h: mouthBase.h * mk,
  };

  return (
    <>
      <Sprite id={id(cheer ? 'body-cheer' : 'body')} {...body} />
      <Sprite id={id('head')} {...head} />
      <Sprite
        id={id(pose.browsUp || cheer ? 'brows-up' : 'brows')}
        {...brows}
      />
      <Sprite id={id(eyesClosed ? 'eyes-closed' : 'eyes-open')} {...eyes} />
      <Sprite id={id(`mouth-${viseme}`)} {...mouth} />
    </>
  );
}

/** Face-centred speaking glow behind a figure. */
function FigureGlow({
  level,
  k,
  originX,
  originY,
}: {
  level: 0 | 1 | 2 | 3;
  k: number;
  originX: number;
  originY: number;
}) {
  if (level === 0) return null;
  const size = PUPPET_GLOW.w * k * 1.5;
  return (
    <Sprite
      id={`ob-puppet-glow-${level}`}
      x={originX + 450 * k - size / 2}
      y={originY + 430 * k - size / 2}
      w={size}
      h={size}
    />
  );
}

function Desk({ cx, topY, w }: { cx: number; topY: number; w: number }) {
  const h = w * (PUPPET_DESK.h / PUPPET_DESK.w);
  return (
    <Sprite id='ob-puppet-studio-desk' x={cx - w / 2} y={topY} w={w} h={h} />
  );
}

function Confetti({
  sinceMs,
  seed,
  resolution,
}: {
  sinceMs: number;
  seed: number;
  resolution: Resolution;
}) {
  const pieces = [];
  for (let i = 0; i < CONFETTI_PIECES; i++) {
    const p = confettiPiece(
      i,
      seed,
      sinceMs,
      resolution.width,
      resolution.height,
    );
    if (p.y < -20 || p.y > resolution.height) continue;
    pieces.push(
      <View
        key={`c-${i}`}
        style={{
          top: p.y,
          left: Math.max(0, Math.min(resolution.width - p.w, p.x)),
          width: p.w,
          height: p.h,
          backgroundColor: p.color,
          borderRadius: 2,
        }}
      />,
    );
  }
  return <>{pieces}</>;
}

/** Quiz-player fx for a puppet, matched by display name. */
type QuizFx = {
  active: boolean;
  cheer: boolean;
  sad: boolean;
  celebrateSinceMs: number | null;
};

const NO_FX: QuizFx = {
  active: false,
  cheer: false,
  sad: false,
  celebrateSinceMs: null,
};

type QuizPlayerRow = {
  name: string;
  active: boolean;
  verdict: 'correct' | 'wrong' | null;
  changedAtMs: number | null;
};

function quizFxFor(
  players: QuizPlayerRow[] | undefined,
  name: string,
  now: number,
): QuizFx {
  const p = players?.find((pl) => pl.name === name);
  if (!p) return NO_FX;
  const since =
    p.changedAtMs != null && p.verdict != null ? now - p.changedAtMs : null;
  const fresh = since != null && since < CELEBRATE_MS;
  return {
    active: p.active,
    cheer: fresh && p.verdict === 'correct',
    sad: since != null && since < 1400 && p.verdict === 'wrong',
    celebrateSinceMs: fresh && p.verdict === 'correct' ? since : null,
  };
}

/** Advance a figure's smoothed amplitude for this tick (ref-backed). */
function figureDynamics(
  states: Record<string, FigureState>,
  character: PuppetCharacterId,
  mouth: PuppetMouthTrack | null,
  airMs: number | null,
  now: number,
): { amp: number; airMs: number; silenceMs: number } {
  const st = (states[character] ??= { amp: 0, lastVoicedMs: 0 });
  const raw = airMs == null ? 0 : sampleMouth(mouth, airMs);
  if (raw >= 0.05) st.lastVoicedMs = now;
  st.amp = smoothAmp(st.amp, raw);
  return {
    amp: st.amp,
    airMs: airMs ?? 0,
    silenceMs: st.lastVoicedMs === 0 ? 10_000 : now - st.lastVoicedMs,
  };
}

type FigureSlot = {
  character: PuppetCharacterId;
  name: string;
  mouth: PuppetMouthTrack | null;
  k: number;
  cx: number;
  feetY: number;
  deskW: number;
};

export function ObPuppetInput({
  cfg,
  resolution,
  inputId,
  volume,
}: {
  cfg: ObPuppetConfig;
  resolution: Resolution;
  inputId: string;
  volume?: number;
}) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => force((n) => (n + 1) % 1e9), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const states = useRef<Record<string, FigureState>>({});
  const store = useContext(StoreContext);
  const players = useStore(store, (s) => s.obVan?.quiz?.players);

  const now = Date.now();
  const airMs = clipAirMs(cfg.getClock(), now);
  const { width, height } = resolution;

  const figures: FigureSlot[] = [];
  if (cfg.character === 'studio') {
    const cast = cfg.cast ?? [];
    const host = cast.find((c) => c.character === 'host');
    const guests = cast.filter((c) => c.character !== 'host').slice(0, 4);
    const kHost = (height / 1071) * 0.46;
    const kGuest = (height / 1071) * 0.36;
    const guestX = [0.115, 0.345, 0.655, 0.885];
    if (host) {
      figures.push({
        character: host.character,
        name: host.name,
        mouth: host.mouth,
        k: kHost,
        cx: width * 0.5,
        feetY: height * 0.94,
        deskW: PUPPET_CANVAS.w * kHost * 1.3,
      });
    }
    guests.forEach((g: PuppetCastMember, i: number) => {
      figures.push({
        character: g.character,
        name: g.name,
        mouth: g.mouth,
        k: kGuest,
        cx: width * (guestX[i] ?? 0.5),
        feetY: height * 1.0,
        deskW: PUPPET_CANVAS.w * kGuest * 1.18,
      });
    });
  } else {
    const k = height / 1071;
    figures.push({
      character: cfg.character,
      name: cfg.name,
      mouth: cfg.mouth,
      k,
      cx: width / 2,
      feetY: height + 20 * k,
      deskW: PUPPET_CANVAS.w * k * 1.3,
    });
  }

  const posed = figures.map((f) => ({
    f,
    fig: figureDynamics(states.current, f.character, f.mouth, airMs, now),
    fx: quizFxFor(players, f.name, now),
  }));
  const celebrating = posed.find((p) => p.fx.celebrateSinceMs != null);
  const confetti =
    celebrating?.fx.celebrateSinceMs != null
      ? {
          sinceMs: celebrating.fx.celebrateSinceMs,
          seed: puppetSeed(celebrating.f.name),
        }
      : null;
  const drawn = posed.map(({ f, fig, fx }) => {
    const originX = f.cx - 450 * f.k;
    const originY = f.feetY - PUPPET_CANVAS.h * f.k;
    const deskTop = originY + 985 * f.k;
    return (
      <View
        key={f.character}
        style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        <FigureGlow
          level={glowLevel(fig.amp)}
          k={f.k}
          originX={originX}
          originY={originY}
        />
        <PuppetFigure
          character={f.character}
          k={f.k}
          originX={originX}
          originY={originY}
          amp={fig.amp}
          airMs={fig.airMs}
          silenceMs={fig.silenceMs}
          wallMs={now}
          cheer={fx.cheer}
          sadBlink={fx.sad}
          browsUp={fx.active && fig.amp < 0.08}
        />
        <Desk cx={f.cx} topY={deskTop} w={f.deskW} />
      </View>
    );
  });

  return (
    <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
      {/* The carrier stream: 2×2 px under the wall keeps audio + side channel. */}
      <View
        style={{ top: 0, left: 0, width: 2, height: 2, overflow: 'hidden' }}>
        <InputStream inputId={inputId} volume={volume} />
      </View>
      <Sprite id='ob-puppet-studio-wall' x={0} y={0} w={width} h={height} />
      {drawn}
      {confetti != null ? (
        <Confetti
          sinceMs={confetti.sinceMs}
          seed={confetti.seed}
          resolution={resolution}
        />
      ) : null}
    </View>
  );
}
