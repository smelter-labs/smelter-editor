/**
 * Live puppet renderer: draws an illustrated talent (or the whole studio)
 * from layered `ob-puppet-*` engine images, lip-synced to the cam's own
 * audio. The carrier mp4 keeps playing underneath in a 2×2 px keeper so its
 * audio stays in the mix and the side-channel keeps analysing it — the
 * puppet is purely the picture.
 *
 * Every animation is computed in the render pass from the wall clock and the
 * clip→air clock (cfg.getClock()). A shared 50 ms checker ticks pure math
 * only and forces a re-render just when the quantized pose key changes —
 * every scene update makes the engine rebuild its whole render graph, so
 * updates are rationed, not scheduled. Parked (off-air, 1×1 px) puppets
 * render only the audio keeper and do not tick at all.
 */
import React, { useContext, useRef } from 'react';
import { Image, InputStream, Rescaler, View } from '@swmansion/smelter';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { StoreContext } from '../../app/store';
import {
  advanceFigure,
  clipAirMs,
  confettiPiece,
  createFigureDynamics,
  type FigureDynamicsState,
  figureVisual,
  type FigureVisual,
  mouthScale,
  puppetSeed,
} from './anim';
import { subscribePuppetTick } from './ticker';
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

const CELEBRATE_MS = 5800;
const CONFETTI_PIECES = 36;

/**
 * Smoothing state per input+figure, outside the component: it survives the
 * remounts a TransitionShaderWrapper causes, and the program + recording
 * output roots share one state (advanceFigure is a no-op at the same
 * instant, so double-advancing is safe).
 */
const dynamicsByFigure = new Map<string, FigureDynamicsState>();

function dynamicsFor(
  inputId: string,
  character: PuppetCharacterId,
): FigureDynamicsState {
  const key = `${inputId}:${character}`;
  let st = dynamicsByFigure.get(key);
  if (!st) {
    st = createFigureDynamics();
    dynamicsByFigure.set(key, st);
  }
  return st;
}

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
        top: y,
        left: x,
        width: Math.max(1, w),
        height: Math.max(1, h),
      }}>
      <Rescaler
        style={{
          width: Math.max(1, w),
          height: Math.max(1, h),
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
  /** Pre-quantized visual state — drawing anything not fingerprinted by
   * `visual.key` would make poses drift between key changes. */
  visual: FigureVisual;
  cheer: boolean;
};

/** One puppet, layer by layer. All rects derive from the shared geometry. */
function PuppetFigure(pose: FigurePose) {
  const { character, k, originX, originY, visual, cheer } = pose;
  const { sway, viseme } = visual;
  const box = (b: PuppetBox, dx = 0, dy = 0) => ({
    x: originX + (b.x + dx) * k,
    y: originY + (b.y + dy) * k,
    w: b.w * k,
    h: b.h * k,
  });
  const mk = mouthScale(viseme, visual.bob);
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
      <Sprite id={id(visual.browsUp ? 'brows-up' : 'brows')} {...brows} />
      <Sprite
        id={id(visual.eyesClosed ? 'eyes-closed' : 'eyes-open')}
        {...eyes}
      />
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

type FigureSlot = {
  character: PuppetCharacterId;
  name: string;
  mouth: PuppetMouthTrack | null;
  k: number;
  cx: number;
  feetY: number;
  deskW: number;
};

/** Where each figure sits: the solo close-up, or the studio with the cast. */
function figureSlots(
  cfg: ObPuppetConfig,
  resolution: Resolution,
): FigureSlot[] {
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
  return figures;
}

type PuppetPose = {
  /** Quantized fingerprint of everything drawn — re-render only on change. */
  key: string;
  posed: {
    f: FigureSlot;
    visual: FigureVisual;
    fx: QuizFx;
  }[];
  confetti: { sinceMs: number; seed: number } | null;
};

/**
 * Advance every figure's dynamics to `now` and fingerprint the pose. Used by
 * the shared ticker (key check only) and by the render pass (full pose) —
 * re-running at the same instant is a no-op for the dynamics.
 */
function computePuppetPose(
  cfg: ObPuppetConfig,
  resolution: Resolution,
  inputId: string,
  players: QuizPlayerRow[] | undefined,
  now: number,
): PuppetPose {
  const airMs = clipAirMs(cfg.getClock(), now);
  const posed = figureSlots(cfg, resolution).map((f) => {
    const fig = advanceFigure(
      dynamicsFor(inputId, f.character),
      f.mouth,
      airMs,
      now,
    );
    const fx = quizFxFor(players, f.name, now);
    const visual = figureVisual({
      seed: puppetSeed(f.character),
      amp: fig.amp,
      bobAmp: fig.bobAmp,
      airMs: fig.airMs,
      silenceMs: fig.silenceMs,
      wallMs: now,
      kOut: f.k,
      active: fx.active,
      cheer: fx.cheer,
      sad: fx.sad,
    });
    return { f, visual, fx };
  });
  const celebrating = posed.find((p) => p.fx.celebrateSinceMs != null);
  const confetti =
    celebrating?.fx.celebrateSinceMs != null
      ? {
          sinceMs: celebrating.fx.celebrateSinceMs,
          seed: puppetSeed(celebrating.f.name),
        }
      : null;
  const key = [
    airMs == null ? 'x' : 'a',
    confetti ? `c${Math.floor(confetti.sinceMs / 100)}` : 'c-',
    ...posed.map((p) => p.visual.key),
  ].join('/');
  return { key, posed, confetti };
}

export function ObPuppetInput({
  cfg,
  resolution,
  inputId,
  volume,
  parked = false,
}: {
  cfg: ObPuppetConfig;
  resolution: Resolution;
  inputId: string;
  volume?: number;
  /** Laid out at the 1×1 park rect (off-air): keep only the audio keeper. */
  parked?: boolean;
}) {
  const [, force] = React.useState(0);
  const lastKey = useRef('');
  const lastForceMs = useRef(0);
  const store = useContext(StoreContext);
  // Content equality: publishHud mints a fresh obVan object whenever ANY
  // part of the HUD changed, and an identity-based subscription here would
  // re-render every puppet (→ full-scene engine update) at the HUD rate.
  const players = useStoreWithEqualityFn(
    store,
    (s) => s.obVan?.quiz?.players,
    (a, b) =>
      a === b ||
      (a != null && b != null && JSON.stringify(a) === JSON.stringify(b)),
  );
  const playersRef = useRef(players);
  playersRef.current = players;
  const { width, height } = resolution;

  React.useEffect(() => {
    if (parked) return;
    // Every forced render is a full engine render-graph rebuild, and the
    // studio tile rebuilds ~30 native-size sprites — cap how often one
    // puppet may force an update. The mouth runs on 130 ms viseme slots, so
    // the studio cap still lands on every slot; skipped changes catch up on
    // the next allowed tick (the key comparison keeps them pending).
    const minGapMs = cfg.character === 'studio' ? 140 : 95;
    return subscribePuppetTick(() => {
      const nowMs = Date.now();
      if (nowMs - lastForceMs.current < minGapMs) return;
      const pose = computePuppetPose(
        cfg,
        { width, height },
        inputId,
        playersRef.current,
        nowMs,
      );
      if (pose.key !== lastKey.current) {
        lastKey.current = pose.key;
        lastForceMs.current = nowMs;
        force((n) => (n + 1) % 1e9);
      }
    });
  }, [parked, cfg, inputId, width, height]);

  if (parked) {
    return (
      <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        <View
          style={{ top: 0, left: 0, width: 2, height: 2, overflow: 'hidden' }}>
          <InputStream inputId={inputId} volume={volume} />
        </View>
      </View>
    );
  }

  const now = Date.now();
  const { key, posed, confetti } = computePuppetPose(
    cfg,
    resolution,
    inputId,
    players,
    now,
  );
  // Record what was actually drawn, so a store-driven render (quiz fx) does
  // not earn a redundant forced render on the next tick.
  lastKey.current = key;
  const drawn = posed.map(({ f, visual, fx }) => {
    const originX = f.cx - 450 * f.k;
    const originY = f.feetY - PUPPET_CANVAS.h * f.k;
    const deskTop = originY + 985 * f.k;
    return (
      <View
        key={f.character}
        style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        <FigureGlow
          level={visual.glow}
          k={f.k}
          originX={originX}
          originY={originY}
        />
        <PuppetFigure
          character={f.character}
          k={f.k}
          originX={originX}
          originY={originY}
          visual={visual}
          cheer={fx.cheer}
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
