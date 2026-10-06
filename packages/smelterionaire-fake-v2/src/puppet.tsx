/**
 * Smelterionaire v2 puppets — hand-drawn vector characters rendered as
 * inline SVG (no more boxy PNG sprites): soft rounded bodies, gradient
 * shading, per-character hair/accessories, six mouth visemes, a lit studio
 * backdrop with depth, and a rounded broadcast multiviewer.
 *
 * The animation maths (visemes, blinks, sway, envelopes) is the same
 * frame-pure port in ./anim — only the drawing changed, so the scenes and
 * the orchestrator timeline are untouched.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
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
  type PuppetViseme,
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
const INKLINE = '#241736';

// ── Character specs ────────────────────────────────────────────────────────

type CharacterSpec = {
  skin: string;
  skinDeep: string;
  iris: string;
  hair: 'teal-crop' | 'cap' | 'pink-long' | 'bald-prof';
  hairA: string;
  hairB: string;
  outfit: string;
  outfitDeep: string;
  shirt: string;
  glasses?: boolean;
  starEarrings?: boolean;
  hoopEarrings?: boolean;
  necklace?: boolean;
  bowTie?: boolean;
  beard?: boolean;
};

const SPECS: Record<string, CharacterSpec> = {
  nova: {
    skin: '#e9b382', skinDeep: '#d29a66', iris: '#17776b',
    hair: 'teal-crop', hairA: '#3ad0b4', hairB: '#1e9e86',
    outfit: '#4a8ae6', outfitDeep: '#2f63b8', shirt: '#f4efe4',
    starEarrings: true,
  },
  bit: {
    skin: '#f4d7ba', skinDeep: '#e0b996', iris: '#5a7bd0',
    hair: 'cap', hairA: '#f07042', hairB: '#c94f26',
    outfit: '#ef6a3e', outfitDeep: '#c44a22', shirt: '#2b2330',
    glasses: true,
  },
  lux: {
    skin: '#8a5a3b', skinDeep: '#6f4429', iris: '#55341f',
    hair: 'pink-long', hairA: '#ef4f9b', hairB: '#c22e77',
    outfit: '#262645', outfitDeep: '#17172e', shirt: '#121225',
    hoopEarrings: true, necklace: true,
  },
  prof: {
    skin: '#c99f78', skinDeep: '#ad8158', iris: '#4a4a52',
    hair: 'bald-prof', hairA: '#efe9e0', hairB: '#cfc6b8',
    outfit: '#6d5a44', outfitDeep: '#51402e', shirt: '#f1ead9',
    bowTie: true, beard: true,
  },
  host: {
    skin: '#e9c49a', skinDeep: '#d0a877', iris: '#3e5a8a',
    hair: 'bald-prof', hairA: '#d7d7de', hairB: '#b4b4bf',
    outfit: '#d9a62e', outfitDeep: '#a87c17', shirt: '#f4efe4',
  },
};

// ── Mouth visemes (around cx 450 / cy 620, scaled by mouthScale) ──────────

const MOUTH_FILL = '#5e2030';
const TEETH = '#fef7ef';
const TONGUE = '#d4596b';

function Mouth({ viseme }: { viseme: PuppetViseme }) {
  const outline = { stroke: INKLINE, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (viseme) {
    case 'rest':
      return (
        <path d='M 388 608 Q 450 652 512 608' fill='none' strokeWidth={13} {...outline} />
      );
    case 'm':
      return (
        <>
          <path d='M 396 622 Q 450 638 504 622' fill='none' strokeWidth={13} {...outline} />
          <path d='M 420 646 Q 450 652 480 646' fill='none' strokeWidth={6} stroke='#00000030' strokeLinecap='round' />
        </>
      );
    case 'e':
      return (
        <>
          <path
            d='M 396 602 Q 450 588 504 602 Q 516 620 504 636 Q 450 652 396 636 Q 384 620 396 602 Z'
            fill={MOUTH_FILL} strokeWidth={10} {...outline}
          />
          <path d='M 402 604 Q 450 592 498 604 L 494 616 Q 450 608 406 616 Z' fill={TEETH} />
        </>
      );
    case 'a':
      return (
        <>
          <path
            d='M 400 592 Q 450 578 500 592 Q 520 624 500 658 Q 450 676 400 658 Q 380 624 400 592 Z'
            fill={MOUTH_FILL} strokeWidth={10} {...outline}
          />
          <path d='M 406 594 Q 450 582 494 594 L 490 610 Q 450 601 410 610 Z' fill={TEETH} />
          <ellipse cx={450} cy={656} rx={30} ry={13} fill={TONGUE} />
        </>
      );
    case 'o':
      return (
        <>
          <ellipse cx={450} cy={622} rx={30} ry={34} fill={MOUTH_FILL} strokeWidth={10} {...outline} />
          <ellipse cx={450} cy={634} rx={16} ry={11} fill={TONGUE} />
        </>
      );
    case 's':
      return (
        <>
          <path
            d='M 376 600 Q 450 584 524 600 Q 538 622 524 642 Q 450 664 376 642 Q 362 622 376 600 Z'
            fill={MOUTH_FILL} strokeWidth={10} {...outline}
          />
          <path d='M 382 602 Q 450 588 518 602 L 514 618 Q 450 607 386 618 Z' fill={TEETH} />
          <path d='M 396 644 Q 450 652 504 644 L 500 636 Q 450 643 400 636 Z' fill={TEETH} opacity={0.9} />
        </>
      );
  }
}

// ── The character rig ──────────────────────────────────────────────────────

function Hair({ spec, pid }: { spec: CharacterSpec; pid: string }) {
  const outline = { stroke: INKLINE, strokeWidth: 9, strokeLinejoin: 'round' as const };
  switch (spec.hair) {
    case 'teal-crop':
      return (
        <>
          <path
            d='M 262 520 C 240 318 330 204 450 198 C 570 204 660 318 638 520 C 628 452 606 410 568 388 C 524 362 486 356 450 358 C 398 360 342 380 308 422 C 286 450 272 484 262 520 Z'
            fill={`url(#${pid}-hair)`} {...outline}
          />
          <path d='M 568 388 C 606 414 626 462 634 506 C 610 452 584 420 550 400 Z' fill={spec.hairB} opacity={0.9} />
          <path d='M 352 380 C 376 398 404 406 428 400 C 404 418 372 416 350 402 Z' fill={spec.hairB} opacity={0.7} />
        </>
      );
    case 'cap':
      return (
        <>
          <path
            d='M 266 418 C 266 288 342 206 450 206 C 558 206 634 288 634 418 Z'
            fill={`url(#${pid}-hair)`} {...outline}
          />
          <path d='M 266 418 L 634 418 L 634 388 C 572 372 328 372 266 388 Z' fill={spec.hairB} />
          <rect x={242} y={414} width={416} height={34} rx={17} fill={`url(#${pid}-hair)`} stroke={INKLINE} strokeWidth={9} />
        </>
      );
    case 'pink-long':
      return (
        <>
          <path
            d='M 254 452 C 246 288 336 206 450 206 C 564 206 654 288 646 452 C 602 330 544 288 450 288 C 356 288 298 330 254 452 Z'
            fill={`url(#${pid}-hair)`} {...outline}
          />
          <path d='M 262 436 C 250 560 256 664 284 752 C 302 648 300 520 312 440 Z' fill={`url(#${pid}-hair)`} {...outline} />
          <path d='M 638 436 C 650 560 644 664 616 752 C 598 648 600 520 588 440 Z' fill={`url(#${pid}-hair)`} {...outline} />
          <path d='M 418 214 C 452 236 468 268 470 300 C 436 272 408 252 376 246 Z' fill='#ff7fc0' opacity={0.5} />
        </>
      );
    case 'bald-prof':
      return (
        <>
          <path d='M 300 418 C 262 404 240 440 252 472 C 268 500 306 498 322 474 Z' fill={`url(#${pid}-hair)`} {...outline} />
          <path d='M 600 418 C 638 404 660 440 648 472 C 632 500 594 498 578 474 Z' fill={`url(#${pid}-hair)`} {...outline} />
          <path d='M 362 242 C 400 220 500 220 538 242 C 500 236 400 236 362 242 Z' fill={spec.hairB} opacity={0.5} />
        </>
      );
  }
}

/** Long hair back panels — drawn behind the body. */
function HairBack({ spec, pid }: { spec: CharacterSpec; pid: string }) {
  if (spec.hair !== 'pink-long') return null;
  return (
    <>
      <path
        d='M 272 400 C 240 640 248 880 296 1030 L 398 1030 C 356 840 352 600 368 430 Z'
        fill={`url(#${pid}-hairdeep)`} stroke={INKLINE} strokeWidth={9} strokeLinejoin='round'
      />
      <path
        d='M 628 400 C 660 640 652 880 604 1030 L 502 1030 C 544 840 548 600 532 430 Z'
        fill={`url(#${pid}-hairdeep)`} stroke={INKLINE} strokeWidth={9} strokeLinejoin='round'
      />
    </>
  );
}

function Face({
  spec,
  pid,
  viseme,
  eyesClosed,
  browsUp,
  mouthK,
}: {
  spec: CharacterSpec;
  pid: string;
  viseme: PuppetViseme;
  eyesClosed: boolean;
  browsUp: boolean;
  mouthK: number;
}) {
  const browShift = browsUp ? -16 : 0;
  const browColor = spec.hair === 'bald-prof' ? spec.hairA : spec.hairB;
  return (
    <>
      {/* Ears */}
      <ellipse cx={252} cy={488} rx={26} ry={38} fill={spec.skin} stroke={INKLINE} strokeWidth={9} />
      <ellipse cx={648} cy={488} rx={26} ry={38} fill={spec.skin} stroke={INKLINE} strokeWidth={9} />
      {/* Head */}
      <path
        d='M 450 230 C 322 230 254 330 250 456 C 246 576 306 700 450 708 C 594 700 654 576 650 456 C 646 330 578 230 450 230 Z'
        fill={`url(#${pid}-skin)`} stroke={INKLINE} strokeWidth={10} strokeLinejoin='round'
      />
      {/* Soft cheek shading + blush */}
      <path d='M 450 708 C 560 700 622 600 640 500 C 636 614 576 696 450 708 Z' fill={spec.skinDeep} opacity={0.35} />
      <ellipse cx={330} cy={560} rx={36} ry={22} fill='#e86a5e' opacity={0.28} />
      <ellipse cx={570} cy={560} rx={36} ry={22} fill='#e86a5e' opacity={0.28} />
      {/* Beard sits under the mouth */}
      {spec.beard ? (
        <>
          <path
            d='M 294 512 C 282 676 336 784 450 796 C 564 784 618 676 606 512 C 584 606 540 648 450 654 C 360 648 316 606 294 512 Z'
            fill={`url(#${pid}-hair)`} stroke={INKLINE} strokeWidth={9} strokeLinejoin='round'
          />
          <path d='M 376 596 Q 450 570 524 596 Q 492 582 450 584 Q 408 582 376 596 Z' fill={spec.hairA} stroke={INKLINE} strokeWidth={7} strokeLinejoin='round' />
        </>
      ) : null}
      {/* Nose */}
      <path d='M 452 500 C 470 530 474 556 458 572' fill='none' stroke={INKLINE} strokeWidth={11} strokeLinecap='round' />
      {/* Eyes */}
      {eyesClosed ? (
        <>
          <path d='M 342 462 Q 376 482 410 462' fill='none' stroke={INKLINE} strokeWidth={11} strokeLinecap='round' />
          <path d='M 490 462 Q 524 482 558 462' fill='none' stroke={INKLINE} strokeWidth={11} strokeLinecap='round' />
        </>
      ) : (
        <>
          {[376, 524].map((ex) => (
            <g key={ex}>
              <ellipse cx={ex} cy={456} rx={37} ry={31} fill='#ffffff' stroke={INKLINE} strokeWidth={9} />
              <circle cx={ex + 4} cy={460} r={15} fill={spec.iris} />
              <circle cx={ex + 4} cy={460} r={7} fill={INKLINE} />
              <circle cx={ex + 10} cy={452} r={4.5} fill='#ffffff' />
            </g>
          ))}
        </>
      )}
      {/* Brows */}
      <g transform={`translate(0 ${browShift})`}>
        <path d='M 332 404 Q 376 386 420 400' fill='none' stroke={browColor} strokeWidth={15} strokeLinecap='round' />
        <path d='M 480 400 Q 524 386 568 404' fill='none' stroke={browColor} strokeWidth={15} strokeLinecap='round' />
      </g>
      {/* Mouth (scales with loudness around its own centre) */}
      <g transform={`translate(450 622) scale(${mouthK}) translate(-450 -622)`}>
        <Mouth viseme={viseme} />
      </g>
      {/* Glasses on top */}
      {spec.glasses ? (
        <g>
          <rect x={330} y={424} width={94} height={70} rx={26} fill='#ffffff14' stroke={INKLINE} strokeWidth={10} />
          <rect x={476} y={424} width={94} height={70} rx={26} fill='#ffffff14' stroke={INKLINE} strokeWidth={10} />
          <path d='M 424 452 Q 450 442 476 452' fill='none' stroke={INKLINE} strokeWidth={10} />
          <path d='M 330 452 L 266 470 M 570 452 L 634 470' stroke={INKLINE} strokeWidth={10} strokeLinecap='round' />
        </g>
      ) : null}
      {/* Earrings */}
      {spec.starEarrings ? (
        <>
          <path d='M 252 522 l 7 14 15 2 -11 11 3 15 -14 -7 -14 7 3 -15 -11 -11 15 -2 Z' fill={GOLD} stroke={INKLINE} strokeWidth={4} />
          <path d='M 648 522 l 7 14 15 2 -11 11 3 15 -14 -7 -14 7 3 -15 -11 -11 15 -2 Z' fill={GOLD} stroke={INKLINE} strokeWidth={4} />
        </>
      ) : null}
      {spec.hoopEarrings ? (
        <>
          <circle cx={252} cy={540} r={17} fill='none' stroke={GOLD} strokeWidth={9} />
          <circle cx={648} cy={540} r={17} fill='none' stroke={GOLD} strokeWidth={9} />
        </>
      ) : null}
    </>
  );
}

function Body({ spec, pid, cheer }: { spec: CharacterSpec; pid: string; cheer: boolean }) {
  return (
    <>
      {/* Cheer arms behind the torso */}
      {cheer ? (
        <>
          {[
            'M 318 880 C 236 800 196 696 214 580',
            'M 582 880 C 664 800 704 696 686 580',
          ].map((d, i) => (
            <g key={i}>
              <path d={d} fill='none' stroke={INKLINE} strokeWidth={82} strokeLinecap='round' />
              <path d={d} fill='none' stroke={spec.outfit} strokeWidth={62} strokeLinecap='round' />
            </g>
          ))}
          <circle cx={214} cy={566} r={37} fill={spec.skin} stroke={INKLINE} strokeWidth={10} />
          <circle cx={686} cy={566} r={37} fill={spec.skin} stroke={INKLINE} strokeWidth={10} />
        </>
      ) : null}
      {/* Neck */}
      <path d='M 404 660 L 404 790 Q 450 812 496 790 L 496 660 Z' fill={spec.skinDeep} stroke={INKLINE} strokeWidth={10} strokeLinejoin='round' />
      {/* Torso with rounded shoulders */}
      <path
        d='M 238 1200 L 238 1012 C 238 894 306 826 396 810 L 450 802 L 504 810 C 594 826 662 894 662 1012 L 662 1200 Z'
        fill={`url(#${pid}-outfit)`} stroke={INKLINE} strokeWidth={10} strokeLinejoin='round'
      />
      {/* Rim light + fold shading */}
      <path d='M 258 1200 L 258 1016 C 258 924 300 862 366 836 C 320 884 300 948 300 1024 L 300 1200 Z' fill='#ffffff' opacity={0.08} />
      <path d='M 642 1200 L 642 1016 C 642 924 600 862 534 836 C 580 884 600 948 600 1024 L 600 1200 Z' fill='#000000' opacity={0.16} />
      {/* Shirt / collar */}
      <path d='M 396 812 L 450 902 L 504 812 C 486 830 414 830 396 812 Z' fill={spec.shirt} stroke={INKLINE} strokeWidth={9} strokeLinejoin='round' />
      {spec.bowTie ? (
        <g>
          <path d='M 450 874 L 394 846 L 394 902 Z' fill='#c22d2d' stroke={INKLINE} strokeWidth={8} strokeLinejoin='round' />
          <path d='M 450 874 L 506 846 L 506 902 Z' fill='#c22d2d' stroke={INKLINE} strokeWidth={8} strokeLinejoin='round' />
          <circle cx={450} cy={874} r={13} fill='#e04444' stroke={INKLINE} strokeWidth={8} />
        </g>
      ) : null}
      {spec.necklace ? (
        <g>
          <path d='M 404 800 Q 450 864 496 800' fill='none' stroke={GOLD} strokeWidth={8} />
          <path d='M 450 862 l 20 14 -8 26 -24 0 -8 -26 Z' fill={GOLD} stroke={INKLINE} strokeWidth={6} strokeLinejoin='round' />
        </g>
      ) : null}
    </>
  );
}

// ── Slots, speech, figure ─────────────────────────────────────────────────

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

/** The active speech cue (if any) for a character at scene time `tS`. */
export function speechAt(
  speech: SpeechCue[],
  character: PuppetCharacterId,
  tS: number,
): { env: FigureEnvelope; airMs: number } {
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
  const h = w * 0.3;
  const kd = w / 900;
  const originY = slot.feetY - PUPPET_CANVAS.h * slot.k;
  const topY = originY + 985 * slot.k;
  const fs = 68 * kd;
  const plateW = 470 * kd;
  const plateH = 104 * kd;
  const plateX = (w - plateW) / 2;
  const plateY = 36 * kd;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', left: slot.cx - w / 2, top: topY, overflow: 'visible' }}>
      <defs>
        <linearGradient id='desk-face' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#17204a' />
          <stop offset='0.5' stopColor='#0e1434' />
          <stop offset='1' stopColor='#080c20' />
        </linearGradient>
        <linearGradient id='desk-rim' x1='0' y1='0' x2='1' y2='0'>
          <stop offset='0' stopColor='#8a6a1a' />
          <stop offset='0.5' stopColor='#ffe9b0' />
          <stop offset='1' stopColor='#8a6a1a' />
        </linearGradient>
        <linearGradient id='plate-frame' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#ffe9b0' />
          <stop offset='0.55' stopColor='#ffd166' />
          <stop offset='1' stopColor='#a87c17' />
        </linearGradient>
      </defs>
      {/* Desk slab with perspective */}
      <path d={`M ${w * 0.05} 12 L ${w * 0.95} 12 L ${w} ${h} L 0 ${h} Z`} fill='url(#desk-face)' />
      {/* Luminous rim */}
      <rect x={w * 0.045} y={6} width={w * 0.91} height={10 * kd + 4} rx={5} fill='url(#desk-rim)' opacity={0.95} />
      <rect x={w * 0.045} y={6} width={w * 0.91} height={26 * kd} fill='#ffd166' opacity={0.12} />
      {/* Name plate */}
      <rect x={plateX} y={plateY} width={plateW} height={plateH} rx={16 * kd} fill='url(#plate-frame)' />
      <rect x={plateX + 5 * kd} y={plateY + 5 * kd} width={plateW - 10 * kd} height={plateH - 10 * kd} rx={12 * kd} fill='#0b1026' />
      <text
        x={w / 2}
        y={plateY + plateH / 2 + fs * 0.36}
        textAnchor='middle'
        fontFamily={DISPLAY}
        fontWeight={800}
        fontSize={fs}
        fill={GOLD}
        letterSpacing={2 * kd}>
        {slot.name.toUpperCase()}
      </text>
      {/* Glossy sheen */}
      <path
        d={`M ${plateX + plateW * 0.08} ${plateY} L ${plateX + plateW * 0.3} ${plateY} L ${plateX + plateW * 0.18} ${plateY + plateH} L ${plateX} ${plateY + plateH * 0.7} Z`}
        fill='#ffffff' opacity={0.1}
      />
    </svg>
  );
}

/** One vector puppet: glow, hair-back, body, head — then the desk in front. */
export function PuppetFigure({
  slot,
  timeMs,
  env,
  airMs,
  fx,
}: {
  slot: FigureSlot;
  timeMs: number;
  env: FigureEnvelope;
  airMs: number;
  fx: PuppetFx;
}) {
  const { character, k, cx, feetY } = slot;
  const spec = SPECS[character] ?? SPECS.prof;
  const pid = `pg-${character}`;
  const seed = puppetSeed(character);
  const originX = cx - 450 * k;
  const originY = feetY - PUPPET_CANVAS.h * k;
  const viseme = pickViseme(env.amp, airMs, seed, env.silenceMs);
  const eyesClosed = fx.sad || blinkClosed(timeMs, seed);
  const browsUp = (fx.active && env.bobAmp < 0.08) || fx.cheer;
  const sway = puppetSway(timeMs, seed, env.bobAmp);
  const glow = glowLevel(env.bobAmp);
  const mouthK = mouthScale(viseme, env.bobAmp);
  const glowSize = 950 * k;
  return (
    <>
      {glow > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: originX + 450 * k - glowSize / 2,
            top: originY + 440 * k - glowSize / 2,
            width: glowSize,
            height: glowSize,
            background: `radial-gradient(circle, rgba(255,209,102,${0.1 + glow * 0.07}) 0%, rgba(255,209,102,0) 62%)`,
          }}
        />
      ) : null}
      <svg
        width={PUPPET_CANVAS.w * k}
        height={PUPPET_CANVAS.h * k}
        viewBox={`0 0 ${PUPPET_CANVAS.w} ${PUPPET_CANVAS.h}`}
        style={{ position: 'absolute', left: originX, top: originY, overflow: 'visible' }}>
        <defs>
          <linearGradient id={`${pid}-skin`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stopColor={spec.skin} />
            <stop offset='1' stopColor={spec.skinDeep} />
          </linearGradient>
          <linearGradient id={`${pid}-hair`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stopColor={spec.hairA} />
            <stop offset='1' stopColor={spec.hairB} />
          </linearGradient>
          <linearGradient id={`${pid}-hairdeep`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stopColor={spec.hairB} />
            <stop offset='1' stopColor='#7e1c4c' />
          </linearGradient>
          <linearGradient id={`${pid}-outfit`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stopColor={spec.outfit} />
            <stop offset='1' stopColor={spec.outfitDeep} />
          </linearGradient>
        </defs>
        <g transform={`translate(${sway.bodyX + sway.headX} ${sway.headY})`}>
          <HairBack spec={spec} pid={pid} />
        </g>
        <g transform={`translate(${sway.bodyX} 0)`}>
          <Body spec={spec} pid={pid} cheer={fx.cheer} />
        </g>
        <g transform={`translate(${sway.bodyX + sway.headX} ${sway.headY})`}>
          <Face
            spec={spec}
            pid={pid}
            viseme={viseme}
            eyesClosed={eyesClosed}
            browsUp={browsUp}
            mouthK={mouthK}
          />
          <Hair spec={spec} pid={pid} />
        </g>
      </svg>
      <Desk slot={slot} />
    </>
  );
}

// ── Studio backdrop (replaces the flat wall PNG) ──────────────────────────

const HEX_PATTERN = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='222'>` +
    `<g fill='none' stroke='#d8b45c' stroke-opacity='0.1' stroke-width='2.5'>` +
    `<path d='M64 1 L126 37 L126 110 L64 147 L2 110 L2 37 Z'/>` +
    `<path d='M0 112 L62 148 L62 221 M128 112 L66 148 L66 221'/>` +
    `</g></svg>`,
);

export function StudioWall({
  width,
  height,
  timeMs = 0,
}: {
  width: number;
  height: number;
  timeMs?: number;
}) {
  const floorY = height * 0.775;
  const bokeh = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const sx = Math.sin(timeMs / 9000 + i * 1.7);
    const sy = Math.cos(timeMs / 11000 + i * 2.3);
    return {
      x: width * (0.08 + (i / 8) * 0.88) + sx * 40,
      y: height * (0.12 + ((i * 37) % 50) / 100) + sy * 26,
      r: 26 + (i % 3) * 18,
      c: i % 2 ? 'rgba(255,209,102,0.05)' : 'rgba(96,150,255,0.05)',
    };
  });
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill
        style={{ background: 'linear-gradient(180deg, #121a3d 0%, #0b1130 52%, #070b1d 100%)' }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${HEX_PATTERN}")`,
          backgroundSize: '128px 222px',
          opacity: 0.9,
        }}
      />
      {/* Key spotlight + warm fill */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(58% 48% at 50% 14%, rgba(120,160,255,0.26) 0%, rgba(120,160,255,0) 70%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(42% 40% at 50% 46%, rgba(255,209,102,0.1) 0%, rgba(255,209,102,0) 70%)',
        }}
      />
      {bokeh.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: b.x - b.r,
            top: b.y - b.r,
            width: b.r * 2,
            height: b.r * 2,
            borderRadius: '50%',
            background: b.c,
            filter: 'blur(6px)',
          }}
        />
      ))}
      {/* Stage floor */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: floorY,
          width,
          height: height - floorY,
          background: 'linear-gradient(180deg, #1a2452 0%, #0a0f26 60%, #060918 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: floorY - 3,
          width,
          height: 4,
          background: 'linear-gradient(90deg, #8a6a1a00, #ffd166cc 30%, #ffe9b0 50%, #ffd166cc 70%, #8a6a1a00)',
          boxShadow: '0 0 18px rgba(255,209,102,0.5)',
        }}
      />
      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(115% 95% at 50% 42%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </AbsoluteFill>
  );
}

// ── Multiviewer: rounded broadcast tiles with a punch-in cut ──────────────

export type CamSpec = {
  character: PuppetCharacterId;
  name: string;
  dimmed?: boolean;
  cheer?: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function CamTile({
  cam,
  rect,
  radius,
  timeMs,
  width,
  height,
  tally,
  opacity,
}: {
  cam: CamSpec;
  rect: Rect;
  radius: number;
  timeMs: number;
  width: number;
  height: number;
  tally: boolean;
  opacity: number;
}) {
  if (opacity <= 0) return null;
  const k = rect.w / width;
  const livePulse = 0.75 + 0.25 * Math.sin(timeMs / 350);
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
        borderRadius: radius,
        border: tally ? `4px solid ${GOLD}` : '2px solid rgba(242,244,248,.2)',
        boxShadow: tally
          ? '0 0 36px rgba(255,209,102,.35), 0 14px 34px rgba(0,0,0,.5)'
          : '0 14px 34px rgba(0,0,0,.5)',
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
        <StudioWall width={width} height={height} timeMs={timeMs} />
        <PuppetFigure
          slot={soloSlot(cam.character, cam.name, width, height)}
          timeMs={timeMs}
          env={{ amp: 0, bobAmp: 0, silenceMs: 10_000 }}
          airMs={0}
          fx={{ active: tally, cheer: cam.cheer ?? false, sad: false }}
        />
        {cam.dimmed ? (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(7,11,24,.74)' }}>
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
      {/* Legibility gradient + OB-style chrome */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: rect.w,
          height: 64,
          background: 'linear-gradient(180deg, rgba(5,8,18,.55), rgba(5,8,18,0))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 14,
          padding: '5px 14px',
          borderRadius: 999,
          backgroundColor: 'rgba(7,11,24,.8)',
          border: '1px solid rgba(255,209,102,.35)',
          fontFamily: MONO,
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: 2,
          color: tally ? GOLD : 'rgba(242,244,248,.72)',
        }}>
        {cam.name.toUpperCase()}
      </div>
      {tally ? (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 14,
            padding: '5px 14px',
            borderRadius: 999,
            backgroundColor: RED,
            boxShadow: `0 0 ${12 + livePulse * 10}px rgba(255,45,45,.8)`,
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

export const PUNCH_S = 0.7;
const TILE_GAP = 8;

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
  activeIndex: number;
  tS: number;
  timeMs: number;
  punchAtS: number | null;
  width: number;
  height: number;
}) {
  const punch =
    punchAtS == null ? 0 : easeInOut(clamp01((tS - punchAtS) / PUNCH_S));
  if (punch >= 1) return null;
  const quadrant = (i: number): Rect => ({
    x: (i % 2) * (width / 2) + TILE_GAP,
    y: Math.floor(i / 2) * (height / 2) + TILE_GAP,
    w: width / 2 - TILE_GAP * 2,
    h: height / 2 - TILE_GAP * 2,
  });
  const full: Rect = { x: 0, y: 0, w: width, h: height };
  return (
    // zIndex: 0 makes the grid its own stacking context, so the tiles'
    // internal zIndex never outranks the HUD drawn after it in the scene.
    <AbsoluteFill style={{ backgroundColor: '#05070f', zIndex: 0 }}>
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
              radius={active ? 18 * (1 - punch) : 18}
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

// ── Confetti ──────────────────────────────────────────────────────────────

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
          transform: `rotate(${(i * 47 + sinceMs / 14) % 360}deg)`,
        }}
      />,
    );
  }
  return <AbsoluteFill>{pieces}</AbsoluteFill>;
}
