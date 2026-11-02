/**
 * The Smelterionaire puppets, rebuilt from the live renderer
 * (server/src/obVan/puppets/PuppetInput.tsx): the same layered PNG sprites
 * on the shared 900×1200 logical canvas, the same solo / studio seating,
 * desks with live nameplate text, speaking glow and confetti.
 */
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import {
  blinkClosed,
  confettiPiece,
  figureEnvelope,
  glowLevel,
  mouthScale,
  pickViseme,
  puppetSeed,
  puppetSway,
  type FigureEnvelope,
} from './anim';
import {
  DISPLAY,
  GOLD,
  INK,
  MONO,
  RED,
  clamp01,
  type PuppetCharacterId,
  type SpeechCue,
} from './theme';

export const PUPPET_CANVAS = { w: 900, h: 1200 };
type Box = { x: number; y: number; w: number; h: number };
const BODY_BOX: Box = { x: 40, y: 490, w: 820, h: 710 };
const HEAD_BOX: Box = { x: 170, y: 130, w: 560, h: 860 };
const EYES_BOX: Box = { x: 235, y: 355, w: 430, h: 180 };
const BROWS_BOX: Box = { x: 290, y: 318, w: 320, h: 112 };
const MOUTH_BOX: Box = { x: 330, y: 520, w: 240, h: 190 };
const DESK = { w: 900, h: 330 };
const GLOW = { w: 800, h: 800 };

function Sprite({ id, x, y, w, h }: { id: string } & Box) {
  return (
    <Img
      src={staticFile(`puppets/${id}.png`)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: Math.max(1, w),
        height: Math.max(1, h),
      }}
    />
  );
}

export type PuppetFx = { active: boolean; cheer: boolean; sad: boolean };
export const NO_FX: PuppetFx = { active: false, cheer: false, sad: false };

export type FigureSlot = {
  character: PuppetCharacterId;
  name: string;
  k: number;
  cx: number;
  feetY: number;
  deskW: number;
};

/** Solo close-up seating (live: figureSlots for a non-studio character). */
export function soloSlot(
  character: PuppetCharacterId,
  name: string,
  width: number,
  height: number,
): FigureSlot {
  const k = height / 1071;
  return {
    character,
    name,
    k,
    cx: width / 2,
    feetY: height + 20 * k,
    deskW: PUPPET_CANVAS.w * k * 1.3,
  };
}

/** Studio seating: host centre, up to 4 guests across the stage. */
export function studioSlots(
  cast: { character: PuppetCharacterId; name: string }[],
  width: number,
  height: number,
): FigureSlot[] {
  const host = cast.find((c) => c.character === 'host');
  const guests = cast.filter((c) => c.character !== 'host').slice(0, 4);
  const kHost = (height / 1071) * 0.46;
  const kGuest = (height / 1071) * 0.36;
  const guestX = [0.115, 0.345, 0.655, 0.885];
  const slots: FigureSlot[] = [];
  if (host) {
    slots.push({
      character: host.character,
      name: host.name,
      k: kHost,
      cx: width * 0.5,
      feetY: height * 0.94,
      deskW: PUPPET_CANVAS.w * kHost * 1.3,
    });
  }
  guests.forEach((g, i) => {
    slots.push({
      character: g.character,
      name: g.name,
      k: kGuest,
      cx: width * (guestX[i] ?? 0.5),
      feetY: height * 1.0,
      deskW: PUPPET_CANVAS.w * kGuest * 1.18,
    });
  });
  return slots;
}

/** The active speech cue (if any) for a character at scene time `tS`. */
export function speechAt(
  speech: SpeechCue[],
  character: PuppetCharacterId,
  tS: number,
): { env: FigureEnvelope; airMs: number } {
  // Keep the mouth sampled a touch past the cue end so the release can close.
  const cue = speech.find(
    (c) =>
      c.character === character && tS >= c.startS && tS < c.startS + c.durS + 0.3,
  );
  if (!cue) return { env: figureEnvelope(null, null), airMs: 0 };
  const airMs = (tS - cue.startS) * 1000;
  return { env: figureEnvelope(cue.mouth, airMs), airMs };
}

function Desk({ slot }: { slot: FigureSlot }) {
  const w = slot.deskW;
  const h = w * (DESK.h / DESK.w);
  const kd = w / DESK.w;
  const fs = Math.round(76 * kd);
  const originY = slot.feetY - PUPPET_CANVAS.h * slot.k;
  const topY = originY + 985 * slot.k;
  return (
    <div
      style={{
        position: 'absolute',
        left: Math.round(slot.cx - w / 2),
        top: Math.round(topY),
        width: Math.round(w),
        height: Math.round(h),
        overflow: 'hidden',
      }}>
      <Sprite id='puppet-studio-desk' x={0} y={0} w={w} h={h} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: Math.round(34 * kd),
          width: Math.round(w),
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: fs,
          lineHeight: 1.1,
          color: GOLD,
        }}>
        {slot.name.toUpperCase()}
      </div>
    </div>
  );
}

/** One puppet, layer by layer — glow, body, head, brows, eyes, mouth, desk. */
export function PuppetFigure({
  slot,
  timeMs,
  env,
  airMs,
  fx,
}: {
  slot: FigureSlot;
  /** Scene wall-clock ms (blinks, sway). */
  timeMs: number;
  env: FigureEnvelope;
  airMs: number;
  fx: PuppetFx;
}) {
  const { character, k, cx, feetY } = slot;
  const seed = puppetSeed(character);
  const originX = cx - 450 * k;
  const originY = feetY - PUPPET_CANVAS.h * k;
  const viseme = pickViseme(env.amp, airMs, seed, env.silenceMs);
  const eyesClosed = fx.sad || blinkClosed(timeMs, seed);
  const browsUp = (fx.active && env.bobAmp < 0.08) || fx.cheer;
  const sway = puppetSway(timeMs, seed, env.bobAmp);
  const glow = glowLevel(env.bobAmp);
  const mk = mouthScale(viseme, env.bobAmp);
  const box = (b: Box, dx = 0, dy = 0): Box => ({
    x: originX + (b.x + dx) * k,
    y: originY + (b.y + dy) * k,
    w: b.w * k,
    h: b.h * k,
  });
  const id = (layer: string) => `puppet-${character}-${layer}`;
  const body = box(BODY_BOX, sway.bodyX, 0);
  const headDx = sway.bodyX + sway.headX;
  const headDy = sway.headY;
  const head = box(HEAD_BOX, headDx, headDy);
  const brows = box(BROWS_BOX, headDx, headDy);
  const eyes = box(EYES_BOX, headDx, headDy);
  const mouthBase = box(MOUTH_BOX, headDx, headDy);
  const mouth = {
    x: mouthBase.x - (mouthBase.w * (mk - 1)) / 2,
    y: mouthBase.y - (mouthBase.h * (mk - 1)) / 2,
    w: mouthBase.w * mk,
    h: mouthBase.h * mk,
  };
  const glowSize = GLOW.w * k * 1.5;
  return (
    <>
      {glow > 0 ? (
        <Sprite
          id={`puppet-glow-${glow}`}
          x={originX + 450 * k - glowSize / 2}
          y={originY + 430 * k - glowSize / 2}
          w={glowSize}
          h={glowSize}
        />
      ) : null}
      <Sprite id={id(fx.cheer ? 'body-cheer' : 'body')} {...body} />
      <Sprite id={id('head')} {...head} />
      <Sprite id={id(browsUp ? 'brows-up' : 'brows')} {...brows} />
      <Sprite id={id(eyesClosed ? 'eyes-closed' : 'eyes-open')} {...eyes} />
      <Sprite id={id(`mouth-${viseme}`)} {...mouth} />
      <Desk slot={slot} />
    </>
  );
}

export function StudioWall({ width, height }: { width: number; height: number }) {
  return (
    <Img
      src={staticFile('puppets/puppet-studio-wall.png')}
      style={{ position: 'absolute', left: 0, top: 0, width, height }}
    />
  );
}

// ── Multiviewer: the "all inputs at once" grid with a punch-in cut ─────────

export type CamSpec = {
  character: PuppetCharacterId;
  name: string;
  /** Cashed out: tile dimmed with a CASHED OUT wash. */
  dimmed?: boolean;
  /** Wrap celebration pose. */
  cheer?: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** One camera tile: a full solo scene scaled into `rect`, OB-style chrome. */
function CamTile({
  cam,
  rect,
  timeMs,
  width,
  height,
  tally,
  opacity,
}: {
  cam: CamSpec;
  rect: Rect;
  timeMs: number;
  width: number;
  height: number;
  tally: boolean;
  opacity: number;
}) {
  if (opacity <= 0) return null;
  const k = rect.w / width;
  const border = tally ? 5 : 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        overflow: 'hidden',
        opacity,
        boxSizing: 'border-box',
        border: `${border}px solid ${tally ? GOLD : 'rgba(242,244,248,.28)'}`,
        backgroundColor: INK,
      }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          transform: `scale(${k})`,
          transformOrigin: '0 0',
        }}>
        <StudioWall width={width} height={height} />
        <PuppetFigure
          slot={soloSlot(cam.character, cam.name, width, height)}
          timeMs={timeMs}
          env={{ amp: 0, bobAmp: 0, silenceMs: 10_000 }}
          airMs={0}
          fx={{ active: tally, cheer: cam.cheer ?? false, sad: false }}
        />
        {cam.dimmed ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(7,11,24,.72)',
            }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: height / 2 - 40,
                width,
                textAlign: 'center',
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 44,
                letterSpacing: 14,
                color: 'rgba(242,244,248,.6)',
              }}>
              CASHED OUT
            </div>
          </div>
        ) : null}
      </div>
      {/* OB-style cam label + tally chip. */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 12,
          padding: '4px 10px',
          backgroundColor: 'rgba(7,11,24,.82)',
          fontFamily: MONO,
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: 2,
          color: tally ? GOLD : 'rgba(242,244,248,.7)',
        }}>
        {cam.name.toUpperCase()}
      </div>
      {tally ? (
        <div
          style={{
            position: 'absolute',
            right: 14,
            top: 12,
            padding: '4px 10px',
            backgroundColor: RED,
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: 2,
            color: '#fff',
          }}>
          LIVE
        </div>
      ) : null}
    </div>
  );
}

/**
 * 2×2 multiviewer of all contestant cams. Tiles stagger in; from `punchAtS`
 * the active tile expands to full frame (the on-air "cut") over PUNCH_S while
 * the rest fade — at progress 1 its content matches the underlying solo
 * scene exactly, so the hand-off is seamless and the grid stops rendering.
 */
export const PUNCH_S = 0.7;

export function CamGrid({
  cams,
  activeIndex,
  tS,
  timeMs,
  punchAtS,
  width,
  height,
}: {
  cams: CamSpec[];
  /** −1: nobody on tally (wrap grid). */
  activeIndex: number;
  tS: number;
  timeMs: number;
  /** null: the grid never punches in (wrap). */
  punchAtS: number | null;
  width: number;
  height: number;
}) {
  const punch =
    punchAtS == null ? 0 : easeInOut(clamp01((tS - punchAtS) / PUNCH_S));
  if (punch >= 1) return null;
  const quadrant = (i: number): Rect => ({
    x: (i % 2) * (width / 2),
    y: Math.floor(i / 2) * (height / 2),
    w: width / 2,
    h: height / 2,
  });
  const full: Rect = { x: 0, y: 0, w: width, h: height };
  return (
    // zIndex: 0 makes the grid its own stacking context, so the tiles'
    // internal zIndex never outranks the HUD drawn after it in the scene.
    <AbsoluteFill style={{ backgroundColor: INK, zIndex: 0 }}>
      {cams.map((cam, i) => {
        const active = i === activeIndex;
        const q = quadrant(i);
        const rect = active
          ? {
              x: lerp(q.x, full.x, punch),
              y: lerp(q.y, full.y, punch),
              w: lerp(q.w, full.w, punch),
              h: lerp(q.h, full.h, punch),
            }
          : q;
        const enter = clamp01((tS - i * 0.12) / 0.35);
        const opacity = active ? enter : enter * (1 - punch);
        return (
          <div
            key={cam.name}
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateY(${(1 - enter) * 36}px)`,
              zIndex: active ? 2 : 1,
            }}>
            <CamTile
              cam={cam}
              rect={rect}
              timeMs={timeMs}
              width={width}
              height={height}
              tally={active && punch < 0.4}
              opacity={opacity}
            />
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

const CONFETTI_PIECES = 90;

export function Confetti({
  sinceMs,
  seed,
  width,
  height,
}: {
  sinceMs: number;
  seed: number;
  width: number;
  height: number;
}) {
  if (sinceMs < 0) return null;
  const pieces: React.ReactNode[] = [];
  for (let i = 0; i < CONFETTI_PIECES; i++) {
    const p = confettiPiece(i, seed, sinceMs, width, height);
    if (p.y < -20 || p.y > height) continue;
    pieces.push(
      <div
        key={`c-${i}`}
        style={{
          position: 'absolute',
          left: Math.max(0, Math.min(width - p.w, p.x)),
          top: p.y,
          width: p.w,
          height: p.h,
          backgroundColor: p.color,
          borderRadius: 2,
        }}
      />,
    );
  }
  return <AbsoluteFill>{pieces}</AbsoluteFill>;
}
